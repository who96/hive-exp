import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import {
  LifecycleManager,
  type LifecycleOptions,
  type LifecycleResult,
} from '../src/lifecycle.js';
import { LifecycleCron } from '../src/cron.js';
import type { ExperienceRecord, HiveEvent } from '../src/types/index.js';

// --- Helpers ---

function tmpDir(): string {
  return path.join(os.tmpdir(), `hive-lifecycle-test-${crypto.randomUUID()}`);
}

function setupDataDir(baseDir: string): void {
  const directories = [
    path.join(baseDir, 'experiences', 'provisional'),
    path.join(baseDir, 'experiences', 'promoted'),
    path.join(baseDir, 'experiences', 'archived'),
    path.join(baseDir, 'events'),
  ];
  for (const dir of directories) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function buildExperience(overrides: Partial<ExperienceRecord> = {}): ExperienceRecord {
  return {
    id: `exp_${crypto.randomUUID()}`,
    type: 'experience',
    schema_version: '1.1.0',
    signals: ['build:fail'],
    scope: 'project',
    strategy: {
      name: 'retry_with_backoff',
      description: 'Retry with exponential backoff',
      category: 'repair',
    },
    outcome: {
      status: 'success',
    },
    confidence: 0.8,
    source_agent: 'test-agent',
    signature: 'hmac-sha256:test',
    validated_by: null,
    promoted: false,
    provisional: true,
    provisional_deadline: null,
    supersedes: null,
    superseded_by: null,
    created: new Date('2026-03-01T00:00:00Z').toISOString(),
    last_confirmed: new Date('2026-03-01T00:00:00Z').toISOString(),
    decay_halflife_days: 30,
    archived: false,
    archived_reason: null,
    ...overrides,
  };
}

function buildEvent(overrides: Partial<HiveEvent> = {}): HiveEvent {
  return {
    event_id: `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    type: 'experience.created',
    timestamp: new Date('2026-03-01T00:00:00Z').toISOString(),
    source_agent: 'test-agent',
    signature: 'hmac-sha256:test',
    payload: { exp_id: 'exp_test', initial_confidence: 0.5 },
    ...overrides,
  };
}

function writeExperience(dir: string, record: ExperienceRecord): void {
  fs.writeFileSync(path.join(dir, `${record.id}.json`), JSON.stringify(record, null, 2) + '\n', 'utf8');
}

function writeEventsFile(eventsDir: string, fileName: string, events: HiveEvent[]): void {
  fs.mkdirSync(eventsDir, { recursive: true });
  const content = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
  fs.writeFileSync(path.join(eventsDir, fileName), content, 'utf8');
}

function readEvents(eventsDir: string): HiveEvent[] {
  const entries = fs.readdirSync(eventsDir);
  const files = entries
    .filter((name) => /^events-(\d{4})-(\d{2})\.jsonl$/.test(name))
    .sort()
    .map((name) => path.join(eventsDir, name));

  const out: HiveEvent[] = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        out.push(JSON.parse(trimmed) as HiveEvent);
      } catch {
        // skip malformed lines
      }
    }
  }

  return out;
}

function readExperience(filePath: string): ExperienceRecord {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ExperienceRecord;
}

function runLifecycle(
  dataDir: string,
  now: Date,
  options: Omit<LifecycleOptions, 'dataDir' | 'now'> = {},
): LifecycleResult {
  const manager = new LifecycleManager({
    dataDir,
    now,
    ...options,
  });
  return manager.run();
}

describe('LifecycleManager', () => {
  let testDir = '';

  afterEach(() => {
    if (testDir) {
      fs.rmSync(testDir, { recursive: true, force: true });
      testDir = '';
    }
  });

  it('decay: experience with old last_confirmed gets lower effective confidence', () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const now = new Date('2026-03-01T00:00:00Z');
    const oldConfirmed = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();

    const exp = buildExperience({
      id: 'exp_old_confidence',
      confidence: 0.8,
      last_confirmed: oldConfirmed,
    });

    writeExperience(path.join(baseDir, 'experiences', 'provisional'), exp);

    const result = runLifecycle(baseDir, now);

    const updated = readExperience(path.join(baseDir, 'experiences', 'provisional', `${exp.id}.json`));
    expect(updated.confidence).toBeLessThan(0.5);
    expect(result.decayed).toBeGreaterThanOrEqual(1);
  });

  it('decay: recently confirmed experience stays high', () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const now = new Date('2026-03-01T00:00:00Z');
    const exp = buildExperience({
      id: 'exp_recent_confidence',
      confidence: 0.8,
      last_confirmed: now.toISOString(),
    });

    writeExperience(path.join(baseDir, 'experiences', 'provisional'), exp);

    const result = runLifecycle(baseDir, now);

    const updated = readExperience(path.join(baseDir, 'experiences', 'provisional', `${exp.id}.json`));
    expect(updated.confidence).toBeGreaterThan(0.799);
    expect(updated.confidence).toBeLessThan(0.801);
    expect(result.decayed).toBe(0);
  });

  it('archive rule 1: low confidence triggers archive', () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const now = new Date('2026-03-01T00:00:00Z');
    const exp = buildExperience({
      id: 'exp_low_confidence',
      confidence: 0.05,
      last_confirmed: now.toISOString(),
    });
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), exp);

    const result = runLifecycle(baseDir, now, { archiveThreshold: 0.1 });

    const provisionalPath = path.join(baseDir, 'experiences', 'provisional', `${exp.id}.json`);
    const archivedPath = path.join(baseDir, 'experiences', 'archived', `${exp.id}.json`);

    expect(fs.existsSync(provisionalPath)).toBe(false);
    expect(fs.existsSync(archivedPath)).toBe(true);
    expect(result.reasons).toContainEqual({ exp_id: exp.id, reason: 'low_confidence' });
  });

  it('archive rule 2: zero references for 30+ days triggers archive', () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const now = new Date('2026-03-01T00:00:00Z');
    const oldCreated = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const exp = buildExperience({
      id: 'exp_zero_ref',
      confidence: 0.9,
      created: oldCreated,
      last_confirmed: now.toISOString(),
    });
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), exp);

    const result = runLifecycle(baseDir, now, { zeroRefDays: 30 });

    const archivedPath = path.join(baseDir, 'experiences', 'archived', `${exp.id}.json`);
    const provisionalPath = path.join(baseDir, 'experiences', 'provisional', `${exp.id}.json`);

    expect(fs.existsSync(archivedPath)).toBe(true);
    expect(fs.existsSync(provisionalPath)).toBe(false);
    expect(result.reasons).toContainEqual({ exp_id: exp.id, reason: 'zero_ref' });
  });

  it('archive rule 3: 3 consecutive failures triggers archive', () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const now = new Date('2026-03-01T00:00:00Z');
    const exp = buildExperience({
      id: 'exp_fail_streak',
      confidence: 0.9,
      last_confirmed: now.toISOString(),
      created: now.toISOString(),
    });
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), exp);

    const refEvents = [
      buildEvent({
        event_id: 'evt_ref_a',
        type: 'experience.referenced',
        payload: { exp_id: exp.id, context_summary: 'context-a' },
      }),
      buildEvent({
        event_id: 'evt_ref_b',
        type: 'experience.referenced',
        payload: { exp_id: exp.id, context_summary: 'context-b' },
      }),
      buildEvent({
        event_id: 'evt_ref_c',
        type: 'experience.referenced',
        payload: { exp_id: exp.id, context_summary: 'context-c' },
      }),
    ];
    const outcomes = [
      buildEvent({
        type: 'experience.outcome_recorded',
        event_id: 'evt_out_a',
        payload: { exp_id: exp.id, ref_event_id: 'evt_ref_a', result: 'failed' },
      }),
      buildEvent({
        type: 'experience.outcome_recorded',
        event_id: 'evt_out_b',
        payload: { exp_id: exp.id, ref_event_id: 'evt_ref_b', result: 'failed' },
      }),
      buildEvent({
        type: 'experience.outcome_recorded',
        event_id: 'evt_out_c',
        payload: { exp_id: exp.id, ref_event_id: 'evt_ref_c', result: 'failed' },
      }),
    ];

    writeEventsFile(path.join(baseDir, 'events'), 'events-2026-03.jsonl', [...refEvents, ...outcomes]);

    const result = runLifecycle(baseDir, now, { consecutiveFailLimit: 3 });

    const archivedPath = path.join(baseDir, 'experiences', 'archived', `${exp.id}.json`);
    expect(fs.existsSync(archivedPath)).toBe(true);
    expect(result.reasons).toContainEqual({ exp_id: exp.id, reason: 'consecutive_fail' });
  });

  it('combined: run lifecycle, verify correct experiences archived', () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const now = new Date('2026-03-01T00:00:00Z');
    const healthyExp = buildExperience({
      id: 'exp_healthy',
      confidence: 0.9,
      created: now.toISOString(),
      last_confirmed: now.toISOString(),
    });
    const lowExp = buildExperience({
      id: 'exp_low',
      confidence: 0.05,
      created: now.toISOString(),
      last_confirmed: now.toISOString(),
    });
    const zeroRefExp = buildExperience({
      id: 'exp_zero_ref',
      confidence: 0.9,
      created: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      last_confirmed: now.toISOString(),
    });

    writeExperience(path.join(baseDir, 'experiences', 'provisional'), healthyExp);
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), lowExp);
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), zeroRefExp);

    // keep healthy experience in usage as referenced experience
    const healthyRef = buildEvent({
      event_id: 'evt_healthy_ref',
      type: 'experience.referenced',
      payload: { exp_id: healthyExp.id, context_summary: 'healthy run' },
    });
    const healthyOutcome = buildEvent({
      event_id: 'evt_healthy_out',
      type: 'experience.outcome_recorded',
      payload: { exp_id: healthyExp.id, ref_event_id: 'evt_healthy_ref', result: 'success' },
    });
    writeEventsFile(path.join(baseDir, 'events'), 'events-2026-03.jsonl', [healthyRef, healthyOutcome]);

    const result = runLifecycle(baseDir, now);

    const archivedReasonValues = new Set(result.reasons.map((r) => r.reason));
    expect(result.archived).toBe(2);
    expect(archivedReasonValues.has('low_confidence')).toBe(true);
    expect(archivedReasonValues.has('zero_ref')).toBe(true);

    expect(fs.existsSync(path.join(baseDir, 'experiences', 'archived', `${healthyExp.id}.json`))).toBe(false);
    expect(fs.existsSync(path.join(baseDir, 'experiences', 'provisional', `${healthyExp.id}.json`))).toBe(true);
    expect(fs.existsSync(path.join(baseDir, 'experiences', 'archived', `${lowExp.id}.json`))).toBe(true);
    expect(fs.existsSync(path.join(baseDir, 'experiences', 'archived', `${zeroRefExp.id}.json`))).toBe(true);
  });

  it('file movement: archived files move from provisional/ to archived/', () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const now = new Date('2026-03-01T00:00:00Z');
    const exp = buildExperience({
      id: 'exp_movement',
      confidence: 0.05,
      last_confirmed: now.toISOString(),
    });
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), exp);

    const result = runLifecycle(baseDir, now, { archiveThreshold: 0.1 });

    const provisionalPath = path.join(baseDir, 'experiences', 'provisional', `${exp.id}.json`);
    const archivedPath = path.join(baseDir, 'experiences', 'archived', `${exp.id}.json`);

    expect(fs.existsSync(provisionalPath)).toBe(false);
    expect(fs.existsSync(archivedPath)).toBe(true);

    const archived = readExperience(archivedPath);
    expect(archived.archived).toBe(true);
    expect(archived.archived_reason).toBe('low_confidence');
    expect(result.archived).toBe(1);
  });

  it('events: verify confidence.decayed and experience.archived events written', () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const now = new Date('2026-03-01T00:00:00Z');
    const oldDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const exp = buildExperience({
      id: 'exp_decay_archive',
      confidence: 0.2,
      last_confirmed: oldDate,
      created: now.toISOString(),
    });
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), exp);

    const result = runLifecycle(baseDir, now);

    const events = readEvents(path.join(baseDir, 'events'));
    const hasDecay = events.some((event) => event.type === 'confidence.decayed');
    const archivedEvent = events.find((event) => event.type === 'experience.archived');

    expect(result.archived).toBe(1);
    expect(hasDecay).toBe(true);
    expect(archivedEvent?.payload).toMatchObject({ exp_id: exp.id, reason: 'low_confidence' });
  });

  it('dedup: supersedes lower-confidence duplicate strategy before archive rules', () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const now = new Date('2026-03-01T00:00:00Z');
    const winner = buildExperience({
      id: 'exp_dedup_winner',
      strategy: {
        name: 'same_strategy',
        description: 'winner',
        category: 'repair',
      },
      confidence: 0.9,
      created: now.toISOString(),
      last_confirmed: now.toISOString(),
    });
    const loser = buildExperience({
      id: 'exp_dedup_loser',
      strategy: {
        name: 'same_strategy',
        description: 'loser',
        category: 'repair',
      },
      confidence: 0.3,
      created: now.toISOString(),
      last_confirmed: now.toISOString(),
    });

    const provisionalDir = path.join(baseDir, 'experiences', 'provisional');
    writeExperience(provisionalDir, winner);
    writeExperience(provisionalDir, loser);

    const result = runLifecycle(baseDir, now);

    expect(result.superseded).toBe(1);
    expect(fs.existsSync(path.join(baseDir, 'experiences', 'provisional', `${loser.id}.json`))).toBe(false);
    expect(fs.existsSync(path.join(baseDir, 'experiences', 'superseded', `${loser.id}.json`))).toBe(true);

    const winnerUpdated = readExperience(path.join(baseDir, 'experiences', 'provisional', `${winner.id}.json`));
    expect(winnerUpdated.supersedes).toBe(loser.id);

    const loserSuperseded = readExperience(path.join(baseDir, 'experiences', 'superseded', `${loser.id}.json`));
    expect(loserSuperseded.archived).toBe(true);
    expect(loserSuperseded.archived_reason).toBe('superseded');
  });

  it('idempotency: running lifecycle twice doesn\'t double-archive', () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const now = new Date('2026-03-01T00:00:00Z');
    const exp = buildExperience({
      id: 'exp_idempotent',
      confidence: 0.05,
      last_confirmed: now.toISOString(),
    });
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), exp);

    const first = runLifecycle(baseDir, now, { archiveThreshold: 0.1 });
    expect(first.archived).toBe(1);

    const second = runLifecycle(baseDir, now, { archiveThreshold: 0.1 });
    expect(second.archived).toBe(0);
  });
});

describe('LifecycleCron', () => {
  let testDir = '';

  afterEach(() => {
    if (testDir) {
      fs.rmSync(testDir, { recursive: true, force: true });
      testDir = '';
    }
  });

  it('runOnce executes lifecycle and returns result', () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const now = new Date('2026-03-01T00:00:00Z');
    const exp = buildExperience({
      id: 'exp_cron_once',
      confidence: 0.2,
      last_confirmed: now.toISOString(),
      created: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    });
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), exp);

    const manager = new LifecycleManager({ dataDir: baseDir, now });
    const cron = new LifecycleCron({ lifecycle: manager });

    const result = cron.runOnce();

    expect(typeof result).toBe('object');
    expect(result).toHaveProperty('decayed');
    expect(result).toHaveProperty('archived');
    expect(result).toHaveProperty('reasons');
  });

  it('start/stop controls the timer', async () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const manager = new LifecycleManager({ dataDir: baseDir, now: new Date('2026-03-01T00:00:00Z') });
    let cycles = 0;

    const cron = new LifecycleCron({
      lifecycle: manager,
      intervalMs: 50,
      onCycle: () => {
        cycles += 1;
      },
    });

    cron.start();
    await new Promise((resolve) => {
      setTimeout(resolve, 180);
    });
    cron.stop();

    expect(cycles).toBeGreaterThanOrEqual(3);
  });
});
