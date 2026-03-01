import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createApp } from '../src/server.js';

let app: ReturnType<typeof createApp>;
let tmpDir: string;

const makeExp = (
  id: string,
  status: 'provisional' | 'promoted' | 'archived',
  agent: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  type: 'experience',
  schema_version: '1.1.0',
  signals: ['tsc_error'],
  scope: 'universal',
  strategy: { name: 'fix_imports', description: 'Fix import paths', category: 'repair' },
  outcome: { status: 'success' },
  confidence: 0.8,
  source_agent: agent,
  signature: 'hmac-sha256:test',
  validated_by: null,
  promoted: status === 'promoted',
  provisional: status === 'provisional',
  provisional_deadline: null,
  supersedes: null,
  superseded_by: null,
  created: new Date().toISOString(),
  last_confirmed: new Date().toISOString(),
  decay_halflife_days: 30,
  archived: status === 'archived',
  archived_reason: status === 'archived' ? 'consecutive_fail' : null,
  ...extra,
});

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-test-'));
  const dirs = ['experiences/provisional', 'experiences/promoted', 'experiences/archived', 'events', 'db'];
  for (const d of dirs) fs.mkdirSync(path.join(tmpDir, d), { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, 'experiences/provisional/exp_001.json'),
    JSON.stringify(makeExp('exp_001', 'provisional', 'agent-a')),
  );
  fs.writeFileSync(
    path.join(tmpDir, 'experiences/provisional/exp_002.json'),
    JSON.stringify(makeExp('exp_002', 'provisional', 'agent-b', { pending_promotion: true })),
  );
  fs.writeFileSync(
    path.join(tmpDir, 'experiences/promoted/exp_003.json'),
    JSON.stringify(makeExp('exp_003', 'promoted', 'agent-a')),
  );
  fs.writeFileSync(
    path.join(tmpDir, 'experiences/archived/exp_004.json'),
    JSON.stringify(makeExp('exp_004', 'archived', 'agent-c')),
  );

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const eventLine =
    JSON.stringify({
      event_id: 'evt_001',
      type: 'experience.created',
      timestamp: new Date().toISOString(),
      source_agent: 'agent-a',
      signature: 'hmac-sha256:test',
      payload: { exp_id: 'exp_001', initial_confidence: 0.8 },
    }) + '\n';
  fs.writeFileSync(path.join(tmpDir, `events/events-${yyyy}-${mm}.jsonl`), eventLine);

  app = createApp(tmpDir);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Health', () => {
  it('returns version', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBeDefined();
  });
});

describe('Overview', () => {
  it('returns correct counts', async () => {
    const res = await request(app).get('/api/overview');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    const d = res.body.data;
    expect(d.provisional_count).toBe(2);
    expect(d.promoted_count).toBe(1);
    expect(d.archived_count).toBe(1);
    expect(d.total_experiences).toBe(4);
  });

  it('returns pending_review count', async () => {
    const res = await request(app).get('/api/overview');
    expect(res.body.data.pending_review).toBe(1);
  });

  it('returns agents', async () => {
    const res = await request(app).get('/api/overview');
    const agents = res.body.data.agents;
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThan(0);
  });
});

describe('Experiences', () => {
  it('list returns all', async () => {
    const res = await request(app).get('/api/experiences');
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(4);
  });

  it('filter by status=provisional', async () => {
    const res = await request(app).get('/api/experiences?status=provisional');
    expect(res.body.data.items.length).toBe(2);
    expect(res.body.data.items.every((r: { _status: string }) => r._status === 'provisional')).toBe(true);
  });

  it('filter by agent', async () => {
    const res = await request(app).get('/api/experiences?agent=agent-a');
    expect(res.body.data.items.every((r: { source_agent: string }) => r.source_agent === 'agent-a')).toBe(true);
  });

  it('get by id returns detail', async () => {
    const res = await request(app).get('/api/experience/exp_001');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('exp_001');
  });

  it('get by id 404 for missing', async () => {
    const res = await request(app).get('/api/experience/nonexistent_id');
    expect(res.status).toBe(404);
  });

  it('promote sets pending_promotion', async () => {
    const res = await request(app).post('/api/experience/exp_001/promote');
    expect(res.status).toBe(200);
    expect(res.body.data.pending_promotion).toBe(true);
    const raw = fs.readFileSync(path.join(tmpDir, 'experiences/provisional/exp_001.json'), 'utf-8');
    const rec = JSON.parse(raw);
    expect(rec.pending_promotion).toBe(true);
  });

  it('quarantine moves file and writes event', async () => {
    const res = await request(app).post('/api/experience/exp_003/quarantine');
    expect(res.status).toBe(200);
    expect(res.body.data.archived).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'experiences/archived/exp_003.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'experiences/promoted/exp_003.json'))).toBe(false);
  });
});

describe('Events', () => {
  it('list returns events', async () => {
    const res = await request(app).get('/api/events');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it('filter by type returns only matching events', async () => {
    const res = await request(app).get('/api/events?type=experience.created');
    expect(res.status).toBe(200);
    const items = res.body.data.items;
    expect(items.every((e: { type: string }) => e.type === 'experience.created')).toBe(true);
  });
});
