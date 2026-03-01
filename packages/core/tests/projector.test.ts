import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import Database from 'better-sqlite3';
import type { HiveEvent } from '../src/types/index.js';
import { EventProjector } from '../src/events/projector.js';

// --- Helpers ---

function tmpDir(): string {
  return path.join(os.tmpdir(), `hive-projector-test-${crypto.randomUUID()}`);
}

function buildEvent(overrides: Partial<HiveEvent> = {}): HiveEvent {
  return {
    event_id: `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    type: 'experience.created',
    timestamp: new Date().toISOString(),
    source_agent: 'test-agent',
    signature: 'hmac-sha256:test',
    payload: { exp_id: 'exp_test', initial_confidence: 0.5 },
    ...overrides,
  };
}

function writeEventsFile(dir: string, filename: string, events: HiveEvent[]): void {
  fs.mkdirSync(dir, { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, filename), lines, 'utf8');
}

function makeProjector(opts: { base?: string } = {}): {
  projector: EventProjector;
  dbPath: string;
  eventsDir: string;
  base: string;
} {
  const base = opts.base ?? tmpDir();
  fs.mkdirSync(base, { recursive: true });
  const dbPath = path.join(base, 'hive-exp.db');
  const eventsDir = path.join(base, 'events');
  fs.mkdirSync(eventsDir, { recursive: true });
  const projector = new EventProjector({ dbPath, eventsDir });
  return { projector, dbPath, eventsDir, base };
}

// --- Tests ---

describe('EventProjector', () => {
  const cleanups: string[] = [];

  afterEach(async () => {
    for (const dir of cleanups) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    cleanups.length = 0;
  });

  function tracked(base: string): string {
    cleanups.push(base);
    return base;
  }

  // ---- initialize() ----

  it('initialize() creates all tables and views', () => {
    const { projector, dbPath, base } = makeProjector();
    tracked(base);
    projector.initialize();

    const db = new Database(dbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const views = db
      .prepare("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name")
      .all() as { name: string }[];
    db.close();
    projector.close();

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('usage_log');
    expect(tableNames).toContain('experience_meta');
    expect(tableNames).toContain('banned_strategies');
    expect(tableNames).toContain('_projection_meta');

    const viewNames = views.map((v) => v.name);
    expect(viewNames).toContain('experience_stats');
    expect(viewNames).toContain('strategy_stats');
  });

  // ---- experience.created ----

  it('projects experience.created → row in experience_meta', () => {
    const { projector, dbPath, base } = makeProjector();
    tracked(base);
    projector.initialize();

    const event = buildEvent({
      type: 'experience.created',
      payload: {
        exp_id: 'exp_001',
        initial_confidence: 0.8,
        strategy_name: 'retry_with_backoff',
        strategy_category: 'repair',
      },
    });
    projector.projectEvent(event);

    const db = new Database(dbPath);
    const row = db.prepare('SELECT * FROM experience_meta WHERE exp_id = ?').get('exp_001') as Record<string, unknown>;
    db.close();
    projector.close();

    expect(row).toBeDefined();
    expect(row.strategy_name).toBe('retry_with_backoff');
    expect(row.strategy_category).toBe('repair');
    expect(row.promoted).toBe(0);
    expect(row.archived).toBe(0);
  });

  it('projects experience.created with missing strategy info → empty strategy_name', () => {
    const { projector, dbPath, base } = makeProjector();
    tracked(base);
    projector.initialize();

    const event = buildEvent({
      type: 'experience.created',
      payload: { exp_id: 'exp_002', initial_confidence: 0.5 },
    });
    projector.projectEvent(event);

    const db = new Database(dbPath);
    const row = db.prepare('SELECT * FROM experience_meta WHERE exp_id = ?').get('exp_002') as Record<string, unknown>;
    db.close();
    projector.close();

    expect(row).toBeDefined();
    expect(row.strategy_name).toBe('');
    expect(row.strategy_category).toBeNull();
  });

  // ---- experience.referenced ----

  it('projects experience.referenced → row in usage_log with NULL result', () => {
    const { projector, dbPath, base } = makeProjector();
    tracked(base);
    projector.initialize();

    const refEvent = buildEvent({
      event_id: 'evt_ref_001',
      type: 'experience.referenced',
      source_agent: 'agent-alpha',
      payload: { exp_id: 'exp_001', context_summary: 'build failed on CI' },
    });
    projector.projectEvent(refEvent);

    const db = new Database(dbPath);
    const row = db.prepare('SELECT * FROM usage_log WHERE event_id = ?').get('evt_ref_001') as Record<string, unknown>;
    db.close();
    projector.close();

    expect(row).toBeDefined();
    expect(row.exp_id).toBe('exp_001');
    expect(row.source_agent).toBe('agent-alpha');
    expect(row.result).toBeNull();
    expect(row.context_summary).toBe('build failed on CI');
  });

  // ---- experience.outcome_recorded ----

  it('projects experience.outcome_recorded → updates usage_log result', () => {
    const { projector, dbPath, base } = makeProjector();
    tracked(base);
    projector.initialize();

    // First, create the reference event
    projector.projectEvent(
      buildEvent({
        event_id: 'evt_ref_002',
        type: 'experience.referenced',
        payload: { exp_id: 'exp_001', context_summary: 'test' },
      })
    );

    // Then record the outcome
    projector.projectEvent(
      buildEvent({
        type: 'experience.outcome_recorded',
        payload: { exp_id: 'exp_001', ref_event_id: 'evt_ref_002', result: 'success' },
      })
    );

    const db = new Database(dbPath);
    const row = db.prepare('SELECT result FROM usage_log WHERE event_id = ?').get('evt_ref_002') as Record<string, unknown>;
    db.close();
    projector.close();

    expect(row.result).toBe('success');
  });

  // ---- experience.promoted ----

  it('projects experience.promoted → updates experience_meta promoted=1', () => {
    const { projector, dbPath, base } = makeProjector();
    tracked(base);
    projector.initialize();

    projector.projectEvent(
      buildEvent({
        type: 'experience.created',
        payload: { exp_id: 'exp_promo', initial_confidence: 0.7, strategy_name: 'x', strategy_category: 'repair' },
      })
    );
    projector.projectEvent(
      buildEvent({
        type: 'experience.promoted',
        payload: { exp_id: 'exp_promo', promoted_by: 'human' },
      })
    );

    const db = new Database(dbPath);
    const row = db.prepare('SELECT promoted FROM experience_meta WHERE exp_id = ?').get('exp_promo') as Record<string, unknown>;
    db.close();
    projector.close();

    expect(row.promoted).toBe(1);
  });

  // ---- experience.archived ----

  it('projects experience.archived → updates experience_meta archived=1', () => {
    const { projector, dbPath, base } = makeProjector();
    tracked(base);
    projector.initialize();

    projector.projectEvent(
      buildEvent({
        type: 'experience.created',
        payload: { exp_id: 'exp_arch', initial_confidence: 0.3, strategy_name: 'y', strategy_category: 'optimize' },
      })
    );
    projector.projectEvent(
      buildEvent({
        type: 'experience.archived',
        payload: { exp_id: 'exp_arch', reason: 'low_confidence' },
      })
    );

    const db = new Database(dbPath);
    const row = db.prepare('SELECT archived, archived_reason FROM experience_meta WHERE exp_id = ?').get('exp_arch') as Record<string, unknown>;
    db.close();
    projector.close();

    expect(row.archived).toBe(1);
    expect(row.archived_reason).toBe('low_confidence');
  });

  // ---- experience.superseded ----

  it('projects experience.superseded → updates experience_meta superseded_by', () => {
    const { projector, dbPath, base } = makeProjector();
    tracked(base);
    projector.initialize();

    projector.projectEvent(
      buildEvent({
        type: 'experience.created',
        payload: { exp_id: 'exp_old', initial_confidence: 0.5, strategy_name: 'z', strategy_category: 'innovate' },
      })
    );
    projector.projectEvent(
      buildEvent({
        type: 'experience.superseded',
        payload: { old_exp_id: 'exp_old', new_exp_id: 'exp_new', reason: 'better approach' },
      })
    );

    const db = new Database(dbPath);
    const row = db.prepare('SELECT superseded_by FROM experience_meta WHERE exp_id = ?').get('exp_old') as Record<string, unknown>;
    db.close();
    projector.close();

    expect(row.superseded_by).toBe('exp_new');
  });

  // ---- strategy.banned ----

  it('projects strategy.banned → row in banned_strategies', () => {
    const { projector, dbPath, base } = makeProjector();
    tracked(base);
    projector.initialize();

    const ts = '2025-06-01T12:00:00Z';
    projector.projectEvent(
      buildEvent({
        type: 'strategy.banned',
        timestamp: ts,
        payload: { strategy_name: 'rm_rf_fix', reason: 'too dangerous', banned_by: 'linus' },
      })
    );

    const db = new Database(dbPath);
    const row = db.prepare('SELECT * FROM banned_strategies WHERE strategy_name = ?').get('rm_rf_fix') as Record<string, unknown>;
    db.close();
    projector.close();

    expect(row).toBeDefined();
    expect(row.reason).toBe('too dangerous');
    expect(row.banned_by).toBe('linus');
    expect(row.timestamp).toBe(ts);
  });

  // ---- confidence.decayed ----

  it('projects confidence.decayed → no SQL side effects', () => {
    const { projector, dbPath, base } = makeProjector();
    tracked(base);
    projector.initialize();

    // Should not throw
    projector.projectEvent(
      buildEvent({
        type: 'confidence.decayed',
        payload: { affected_exp_ids: ['exp_001'], decay_factor: 0.95 },
      })
    );

    const db = new Database(dbPath);
    const count = db.prepare('SELECT COUNT(*) as c FROM usage_log').get() as { c: number };
    db.close();
    projector.close();

    expect(count.c).toBe(0);
  });

  // ---- Idempotency ----

  it('projecting same event twice does not create duplicates', () => {
    const { projector, dbPath, base } = makeProjector();
    tracked(base);
    projector.initialize();

    const event = buildEvent({
      event_id: 'evt_idem_001',
      type: 'experience.referenced',
      payload: { exp_id: 'exp_001', context_summary: 'test idempotency' },
    });

    projector.projectEvent(event);
    projector.projectEvent(event); // duplicate

    const db = new Database(dbPath);
    const count = db.prepare('SELECT COUNT(*) as c FROM usage_log WHERE event_id = ?').get('evt_idem_001') as { c: number };
    db.close();
    projector.close();

    expect(count.c).toBe(1);
  });

  it('projecting same experience.created twice does not create duplicates', () => {
    const { projector, dbPath, base } = makeProjector();
    tracked(base);
    projector.initialize();

    const event = buildEvent({
      type: 'experience.created',
      payload: { exp_id: 'exp_idem', initial_confidence: 0.5, strategy_name: 'a' },
    });

    projector.projectEvent(event);
    projector.projectEvent(event);

    const db = new Database(dbPath);
    const count = db.prepare('SELECT COUNT(*) as c FROM experience_meta WHERE exp_id = ?').get('exp_idem') as { c: number };
    db.close();
    projector.close();

    expect(count.c).toBe(1);
  });

  // ---- rebuild() ----

  it('rebuild() produces same result as sequential projection', () => {
    const base = tracked(tmpDir());
    const eventsDir = path.join(base, 'events');

    const events: HiveEvent[] = [
      buildEvent({
        event_id: 'evt_r_001',
        type: 'experience.created',
        timestamp: '2025-01-10T00:00:00Z',
        payload: { exp_id: 'exp_r1', initial_confidence: 0.8, strategy_name: 'strat_a', strategy_category: 'repair' },
      }),
      buildEvent({
        event_id: 'evt_r_002',
        type: 'experience.referenced',
        timestamp: '2025-01-11T00:00:00Z',
        source_agent: 'agent-1',
        payload: { exp_id: 'exp_r1', context_summary: 'build error' },
      }),
      buildEvent({
        event_id: 'evt_r_003',
        type: 'experience.outcome_recorded',
        timestamp: '2025-01-11T01:00:00Z',
        payload: { exp_id: 'exp_r1', ref_event_id: 'evt_r_002', result: 'success' },
      }),
      buildEvent({
        event_id: 'evt_r_004',
        type: 'experience.promoted',
        timestamp: '2025-01-12T00:00:00Z',
        payload: { exp_id: 'exp_r1', promoted_by: 'human' },
      }),
    ];

    writeEventsFile(eventsDir, 'events-2025-01.jsonl', events);

    // Method 1: sequential projection
    const dbPath1 = path.join(base, 'db1.db');
    const p1 = new EventProjector({ dbPath: dbPath1, eventsDir });
    p1.initialize();
    for (const event of events) {
      p1.projectEvent(event);
    }

    // Method 2: rebuild
    const dbPath2 = path.join(base, 'db2.db');
    const p2 = new EventProjector({ dbPath: dbPath2, eventsDir });
    p2.initialize();
    p2.rebuild();

    // Compare
    const db1 = new Database(dbPath1);
    const db2 = new Database(dbPath2);

    const meta1 = db1.prepare('SELECT * FROM experience_meta').all();
    const meta2 = db2.prepare('SELECT * FROM experience_meta').all();
    expect(meta2).toEqual(meta1);

    const log1 = db1.prepare('SELECT * FROM usage_log').all();
    const log2 = db2.prepare('SELECT * FROM usage_log').all();
    expect(log2).toEqual(log1);

    db1.close();
    db2.close();
    p1.close();
    p2.close();
  });

  // ---- incrementalSync() ----

  it('incrementalSync() only processes events after the last projected one', async () => {
    const base = tracked(tmpDir());
    const eventsDir = path.join(base, 'events');
    const dbPath = path.join(base, 'hive-exp.db');

    const batch1: HiveEvent[] = [
      buildEvent({
        event_id: 'evt_inc_001',
        type: 'experience.created',
        timestamp: '2025-01-10T00:00:00Z',
        payload: { exp_id: 'exp_inc_1', initial_confidence: 0.5, strategy_name: 's1' },
      }),
    ];

    const batch2: HiveEvent[] = [
      buildEvent({
        event_id: 'evt_inc_002',
        type: 'experience.created',
        timestamp: '2025-01-11T00:00:00Z',
        payload: { exp_id: 'exp_inc_2', initial_confidence: 0.6, strategy_name: 's2' },
      }),
    ];

    // Write batch1, project it
    writeEventsFile(eventsDir, 'events-2025-01.jsonl', batch1);
    const projector = new EventProjector({ dbPath, eventsDir });
    projector.initialize();
    for (const e of batch1) {
      projector.projectEvent(e);
    }

    // Add batch2 to the same file
    const allEvents = [...batch1, ...batch2];
    writeEventsFile(eventsDir, 'events-2025-01.jsonl', allEvents);

    // Incremental sync should only pick up batch2
    await projector.incrementalSync();

    const db = new Database(dbPath);
    const rows = db.prepare('SELECT exp_id FROM experience_meta ORDER BY exp_id').all() as { exp_id: string }[];
    db.close();
    projector.close();

    expect(rows.map((r) => r.exp_id)).toEqual(['exp_inc_1', 'exp_inc_2']);
  });

  // ---- Views ----

  it('experience_stats view returns correct aggregated stats', () => {
    const { projector, dbPath, base } = makeProjector();
    tracked(base);
    projector.initialize();

    // Create experience
    projector.projectEvent(
      buildEvent({
        type: 'experience.created',
        payload: { exp_id: 'exp_stats', initial_confidence: 0.8, strategy_name: 'strat_v' },
      })
    );

    // Two references
    projector.projectEvent(
      buildEvent({
        event_id: 'evt_s_ref1',
        type: 'experience.referenced',
        timestamp: '2025-03-01T10:00:00Z',
        source_agent: 'agent-a',
        payload: { exp_id: 'exp_stats', context_summary: 'ctx1' },
      })
    );
    projector.projectEvent(
      buildEvent({
        event_id: 'evt_s_ref2',
        type: 'experience.referenced',
        timestamp: '2025-03-02T10:00:00Z',
        source_agent: 'agent-b',
        payload: { exp_id: 'exp_stats', context_summary: 'ctx2' },
      })
    );

    // One success, one failure
    projector.projectEvent(
      buildEvent({
        type: 'experience.outcome_recorded',
        payload: { exp_id: 'exp_stats', ref_event_id: 'evt_s_ref1', result: 'success' },
      })
    );
    projector.projectEvent(
      buildEvent({
        type: 'experience.outcome_recorded',
        payload: { exp_id: 'exp_stats', ref_event_id: 'evt_s_ref2', result: 'failed' },
      })
    );

    const db = new Database(dbPath);
    const stats = db.prepare('SELECT * FROM experience_stats WHERE exp_id = ?').get('exp_stats') as Record<string, unknown>;
    db.close();
    projector.close();

    expect(stats.ref_count).toBe(2);
    expect(stats.success_count).toBe(1);
    expect(stats.fail_count).toBe(1);
    expect(stats.success_rate).toBe(0.5);
    expect(stats.last_used).toBe('2025-03-02T10:00:00Z');

    const agents = JSON.parse(stats.used_by_agents as string) as string[];
    expect(agents.sort()).toEqual(['agent-a', 'agent-b']);
  });

  it('strategy_stats view returns correct aggregated stats', () => {
    const { projector, dbPath, base } = makeProjector();
    tracked(base);
    projector.initialize();

    // Two experiences under same strategy
    projector.projectEvent(
      buildEvent({
        type: 'experience.created',
        payload: { exp_id: 'exp_ss_1', initial_confidence: 0.8, strategy_name: 'cache_fix', strategy_category: 'repair' },
      })
    );
    projector.projectEvent(
      buildEvent({
        type: 'experience.created',
        payload: { exp_id: 'exp_ss_2', initial_confidence: 0.6, strategy_name: 'cache_fix', strategy_category: 'repair' },
      })
    );

    // Reference + outcome for first
    projector.projectEvent(
      buildEvent({
        event_id: 'evt_ss_ref1',
        type: 'experience.referenced',
        source_agent: 'a',
        payload: { exp_id: 'exp_ss_1', context_summary: 'c' },
      })
    );
    projector.projectEvent(
      buildEvent({
        type: 'experience.outcome_recorded',
        payload: { exp_id: 'exp_ss_1', ref_event_id: 'evt_ss_ref1', result: 'success' },
      })
    );

    const db = new Database(dbPath);
    const stats = db.prepare("SELECT * FROM strategy_stats WHERE strategy_name = ?").get('cache_fix') as Record<string, unknown>;
    db.close();
    projector.close();

    expect(stats.total_experiences).toBe(2);
    expect(stats.total_refs).toBe(1);
    expect(stats.total_outcomes).toBe(1);
    expect(stats.success_rate).toBe(1.0);
  });
});
