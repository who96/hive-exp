import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  StatsAggregator,
  type ExperienceStatsRow,
} from '../src/stats/aggregator.js';

const DDL = `
CREATE TABLE usage_log (
  event_id TEXT PRIMARY KEY,
  exp_id TEXT NOT NULL,
  source_agent TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  result TEXT,
  context_summary TEXT
);

CREATE TABLE experience_meta (
  exp_id TEXT PRIMARY KEY,
  strategy_name TEXT NOT NULL,
  strategy_category TEXT,
  promoted INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  archived_reason TEXT,
  superseded_by TEXT
);

CREATE TABLE banned_strategies (
  strategy_name TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  banned_by TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE VIEW experience_stats AS
SELECT
  exp_id,
  COUNT(*) AS ref_count,
  COUNT(CASE WHEN result = 'success' THEN 1 END) AS success_count,
  COUNT(CASE WHEN result = 'failed' THEN 1 END) AS fail_count,
  ROUND(CAST(COUNT(CASE WHEN result = 'success' THEN 1 END) AS REAL)
    / NULLIF(COUNT(CASE WHEN result IS NOT NULL THEN 1 END), 0), 4) AS success_rate,
  MAX(timestamp) AS last_used,
  json_group_array(DISTINCT source_agent) AS used_by_agents
FROM usage_log GROUP BY exp_id;

CREATE VIEW strategy_stats AS
SELECT
  em.strategy_name,
  em.strategy_category,
  COUNT(DISTINCT em.exp_id) AS total_experiences,
  COUNT(ul.event_id) AS total_refs,
  COUNT(CASE WHEN ul.result IS NOT NULL THEN 1 END) AS total_outcomes,
  ROUND(CAST(COUNT(CASE WHEN ul.result = 'success' THEN 1 END) AS REAL)
    / NULLIF(COUNT(CASE WHEN ul.result IS NOT NULL THEN 1 END), 0), 4) AS success_rate
FROM experience_meta em
LEFT JOIN usage_log ul ON em.exp_id = ul.exp_id
GROUP BY em.strategy_name;
`;

let tmpDir: string;
let dbPath: string;
let setupDb: Database.Database;
let aggregator: StatsAggregator;

function seedData(db: Database.Database): void {
  db.exec(DDL);

  // experience_meta
  const insertMeta = db.prepare(
    'INSERT INTO experience_meta (exp_id, strategy_name, strategy_category) VALUES (?, ?, ?)',
  );
  insertMeta.run('exp-1', 'retry', 'resilience');
  insertMeta.run('exp-2', 'retry', 'resilience');
  insertMeta.run('exp-3', 'cache', 'performance');

  // usage_log
  const insertLog = db.prepare(
    'INSERT INTO usage_log (event_id, exp_id, source_agent, timestamp, result) VALUES (?, ?, ?, ?, ?)',
  );
  insertLog.run('e1', 'exp-1', 'agent-a', '2026-03-01T10:00:00Z', 'success');
  insertLog.run('e2', 'exp-1', 'agent-b', '2026-03-01T11:00:00Z', 'success');
  insertLog.run('e3', 'exp-1', 'agent-a', '2026-03-01T12:00:00Z', 'failed');
  insertLog.run('e4', 'exp-2', 'agent-a', '2026-03-02T10:00:00Z', 'success');
  insertLog.run('e5', 'exp-3', 'agent-c', '2026-02-28T10:00:00Z', null);

  // banned_strategies
  const insertBan = db.prepare(
    'INSERT INTO banned_strategies (strategy_name, reason, banned_by, timestamp) VALUES (?, ?, ?, ?)',
  );
  insertBan.run('yolo-deploy', 'Too risky', 'admin', '2026-03-01T00:00:00Z');
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hive-agg-'));
  dbPath = join(tmpDir, 'test.db');
  setupDb = new Database(dbPath);
  seedData(setupDb);
  setupDb.close();
  aggregator = new StatsAggregator({ dbPath });
});

afterEach(() => {
  aggregator.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('StatsAggregator', () => {
  describe('getExperienceStats', () => {
    it('returns correct stats for an experience with refs and outcomes', () => {
      const stats = aggregator.getExperienceStats('exp-1');
      expect(stats).not.toBeNull();
      const s = stats as ExperienceStatsRow;
      expect(s.exp_id).toBe('exp-1');
      expect(s.ref_count).toBe(3);
      expect(s.success_count).toBe(2);
      expect(s.fail_count).toBe(1);
      expect(s.success_rate).toBeCloseTo(0.6667, 3);
      expect(s.last_used).toBe('2026-03-01T12:00:00Z');
    });

    it('returns null for non-existent experience', () => {
      expect(aggregator.getExperienceStats('does-not-exist')).toBeNull();
    });
  });

  describe('getAllExperienceStats', () => {
    it('returns sorted results by ref_count desc', () => {
      const all = aggregator.getAllExperienceStats({
        sortBy: 'ref_count',
        order: 'desc',
      });
      expect(all.length).toBeGreaterThanOrEqual(2);
      expect(all[0].ref_count).toBeGreaterThanOrEqual(all[1].ref_count);
    });

    it('returns sorted results by success_rate asc', () => {
      const all = aggregator.getAllExperienceStats({
        sortBy: 'success_rate',
        order: 'asc',
      });
      expect(all.length).toBeGreaterThanOrEqual(2);
      // First non-null rate should be <= second non-null rate
      const withRates = all.filter((r) => r.success_rate !== null);
      if (withRates.length >= 2) {
        expect(withRates[0].success_rate!).toBeLessThanOrEqual(
          withRates[1].success_rate!,
        );
      }
    });

    it('respects limit', () => {
      const limited = aggregator.getAllExperienceStats({ limit: 1 });
      expect(limited).toHaveLength(1);
    });
  });

  describe('getStrategyStats', () => {
    it('returns correct stats for a strategy', () => {
      const stats = aggregator.getStrategyStats('retry');
      expect(stats).not.toBeNull();
      expect(stats!.strategy_name).toBe('retry');
      expect(stats!.strategy_category).toBe('resilience');
      expect(stats!.total_experiences).toBe(2);
      expect(stats!.total_refs).toBe(4);
      expect(stats!.total_outcomes).toBe(4);
      expect(stats!.success_rate).toBeCloseTo(0.75, 3);
    });

    it('returns null for non-existent strategy', () => {
      expect(aggregator.getStrategyStats('nope')).toBeNull();
    });
  });

  describe('getAllStrategyStats', () => {
    it('returns sorted by success_rate desc', () => {
      const all = aggregator.getAllStrategyStats({
        sortBy: 'success_rate',
        order: 'desc',
      });
      expect(all.length).toBeGreaterThanOrEqual(1);
      const withRates = all.filter((r) => r.success_rate !== null);
      if (withRates.length >= 2) {
        expect(withRates[0].success_rate!).toBeGreaterThanOrEqual(
          withRates[1].success_rate!,
        );
      }
    });
  });

  describe('getBannedStrategies', () => {
    it('returns all banned strategies', () => {
      const banned = aggregator.getBannedStrategies();
      expect(banned).toHaveLength(1);
      expect(banned[0].strategy_name).toBe('yolo-deploy');
      expect(banned[0].reason).toBe('Too risky');
      expect(banned[0].banned_by).toBe('admin');
    });
  });

  describe('isStrategyBanned', () => {
    it('returns true for banned strategy', () => {
      expect(aggregator.isStrategyBanned('yolo-deploy')).toBe(true);
    });

    it('returns false for non-banned strategy', () => {
      expect(aggregator.isStrategyBanned('retry')).toBe(false);
    });
  });

  describe('used_by_agents parsing', () => {
    it('is correctly parsed as array', () => {
      const stats = aggregator.getExperienceStats('exp-1');
      expect(stats).not.toBeNull();
      expect(Array.isArray(stats!.used_by_agents)).toBe(true);
      expect(stats!.used_by_agents).toContain('agent-a');
      expect(stats!.used_by_agents).toContain('agent-b');
      // DISTINCT so no duplicates despite agent-a appearing twice
      const unique = new Set(stats!.used_by_agents);
      expect(unique.size).toBe(stats!.used_by_agents.length);
    });
  });

  describe('empty database', () => {
    it('returns empty arrays when views have no data', () => {
      // Create a DB with schema but no data
      const emptyDir = mkdtempSync(join(tmpdir(), 'hive-agg-empty-'));
      const emptyPath = join(emptyDir, 'empty.db');
      const emptyDb = new Database(emptyPath);
      emptyDb.exec(DDL);
      emptyDb.close();

      const emptyAgg = new StatsAggregator({ dbPath: emptyPath });
      try {
        expect(emptyAgg.getAllExperienceStats()).toEqual([]);
        expect(emptyAgg.getAllStrategyStats()).toEqual([]);
        expect(emptyAgg.getBannedStrategies()).toEqual([]);
        expect(emptyAgg.isStrategyBanned('anything')).toBe(false);
      } finally {
        emptyAgg.close();
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it('returns empty arrays when views do not exist', () => {
      // Create a DB with no schema at all
      const bareDir = mkdtempSync(join(tmpdir(), 'hive-agg-bare-'));
      const barePath = join(bareDir, 'bare.db');
      const bareDb = new Database(barePath);
      bareDb.close();

      const bareAgg = new StatsAggregator({ dbPath: barePath });
      try {
        expect(bareAgg.getExperienceStats('x')).toBeNull();
        expect(bareAgg.getAllExperienceStats()).toEqual([]);
        expect(bareAgg.getStrategyStats('x')).toBeNull();
        expect(bareAgg.getAllStrategyStats()).toEqual([]);
        expect(bareAgg.getBannedStrategies()).toEqual([]);
        expect(bareAgg.isStrategyBanned('x')).toBe(false);
      } finally {
        bareAgg.close();
        rmSync(bareDir, { recursive: true, force: true });
      }
    });
  });
});
