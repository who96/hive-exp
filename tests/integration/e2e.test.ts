import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as crypto from 'node:crypto';

import { createContext, createToolHandlers } from '@hive-exp/mcp';
import type { HiveExpContext } from '@hive-exp/mcp';
import { EventProjector, StatsAggregator } from '@hive-exp/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `hive-e2e-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function parseResult(response: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(response.content[0]!.text);
}

function makeRecordArgs(overrides: Record<string, unknown> = {}) {
  return {
    signals: ['tsc_error', 'build_failed'],
    strategy: {
      name: 'clear_cache_rebuild',
      description: 'Clear build cache and rebuild the project',
      category: 'repair',
    },
    outcome: {
      status: 'success',
      evidence: 'Build succeeded after cache clear',
      blast_radius: { files: 3, lines: 42 },
    },
    scope: 'universal',
    preconditions: ['node >= 18'],
    risk_level: 'low',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  cleanupDirs.length = 0;
});

function setupContext(): { ctx: HiveExpContext; handlers: ReturnType<typeof createToolHandlers>; tmpDir: string } {
  const tmpDir = makeTempDir();
  cleanupDirs.push(tmpDir);
  const ctx = createContext(tmpDir);
  const handlers = createToolHandlers(ctx);
  return { ctx, handlers, tmpDir };
}

// ---------------------------------------------------------------------------
// 1. MCP Full Lifecycle
// ---------------------------------------------------------------------------

describe('MCP Full Lifecycle', () => {
  it('record -> query -> outcome -> stats (overview + strategy_ranking) -> promote', async () => {
    const { ctx, handlers } = setupContext();

    // --- Record ---
    const recordResult = parseResult(
      await handlers.hive_exp_record(makeRecordArgs()),
    ) as { exp_id: string; status: string; provisional: boolean };

    expect(recordResult.status).toBe('created');
    expect(recordResult.provisional).toBe(true);
    expect(recordResult.exp_id).toMatch(/^exp_/);

    const expId = recordResult.exp_id;

    // Verify file was created in provisional/
    const provisionalFile = path.join(ctx.provisionalDir, `${expId}.json`);
    expect(fs.existsSync(provisionalFile)).toBe(true);

    // --- Query ---
    const queryResult = parseResult(
      await handlers.hive_exp_query({ signals: ['tsc_error'] }),
    ) as { matches: Array<{ exp_id: string }>; total_available: number };

    expect(queryResult.total_available).toBeGreaterThanOrEqual(1);
    const matched = queryResult.matches.find((m) => m.exp_id === expId);
    expect(matched).toBeDefined();

    // --- Outcome ---
    const outcomeResult = parseResult(
      await handlers.hive_exp_outcome({ exp_id: expId, result: 'success' }),
    ) as { status: string; exp_id: string; result: string };

    expect(outcomeResult.status).toBe('recorded');
    expect(outcomeResult.exp_id).toBe(expId);
    expect(outcomeResult.result).toBe('success');

    // --- Stats (overview) ---
    const overviewResult = parseResult(
      await handlers.hive_exp_stats({ type: 'overview' }),
    ) as { type: string; counts: { total: number; provisional: number } };

    expect(overviewResult.type).toBe('overview');
    expect(overviewResult.counts.total).toBeGreaterThanOrEqual(1);
    expect(overviewResult.counts.provisional).toBeGreaterThanOrEqual(1);

    // --- Stats (strategy_ranking) ---
    const rankingResult = parseResult(
      await handlers.hive_exp_stats({ type: 'strategy_ranking' }),
    ) as { type: string; rankings: Array<{ strategy_name: string }> };

    expect(rankingResult.type).toBe('strategy_ranking');
    // The strategy might or might not appear in rankings depending on
    // how experience.created event populates experience_meta.
    // At minimum, the call should succeed without error.

    // --- Promote ---
    const promoteResult = parseResult(
      await handlers.hive_exp_promote({ exp_id: expId, reason: 'Well tested' }),
    ) as { status: string; exp_id: string };

    expect(promoteResult.status).toBe('pending_promotion');
    expect(promoteResult.exp_id).toBe(expId);

    // Verify the file still has pending_promotion set
    const updatedRecord = JSON.parse(fs.readFileSync(provisionalFile, 'utf-8'));
    expect(updatedRecord.pending_promotion).toBe(true);

    // Cleanup
    ctx.projector.close();
    ctx.aggregator.close();
  });
});

// ---------------------------------------------------------------------------
// 2. Record -> Query Signal Matching
// ---------------------------------------------------------------------------

describe('Record -> Query Signal Matching', () => {
  it('queries return only matching experiences, sorted by score', async () => {
    const { ctx, handlers } = setupContext();

    // Record 3 experiences with different signals
    const r1 = parseResult(
      await handlers.hive_exp_record(makeRecordArgs({
        signals: ['tsc_error'],
        strategy: { name: 'fix_types', description: 'Fix type annotations', category: 'repair' },
      })),
    ) as { exp_id: string };

    const r2 = parseResult(
      await handlers.hive_exp_record(makeRecordArgs({
        signals: ['tsc_error', 'module_not_found'],
        strategy: { name: 'fix_imports', description: 'Fix broken imports', category: 'repair' },
      })),
    ) as { exp_id: string };

    const r3 = parseResult(
      await handlers.hive_exp_record(makeRecordArgs({
        signals: ['test_failed'],
        strategy: { name: 'fix_tests', description: 'Fix failing tests', category: 'repair' },
      })),
    ) as { exp_id: string };

    // Query for tsc_error -> should match r1 and r2, NOT r3
    const q1 = parseResult(
      await handlers.hive_exp_query({ signals: ['tsc_error'] }),
    ) as { matches: Array<{ exp_id: string }>; total_available: number };

    expect(q1.total_available).toBe(2);
    const matchedIds = q1.matches.map((m) => m.exp_id);
    expect(matchedIds).toContain(r1.exp_id);
    expect(matchedIds).toContain(r2.exp_id);
    expect(matchedIds).not.toContain(r3.exp_id);

    // Query for module_not_found -> should match only r2
    const q2 = parseResult(
      await handlers.hive_exp_query({ signals: ['module_not_found'] }),
    ) as { matches: Array<{ exp_id: string }>; total_available: number };

    expect(q2.total_available).toBe(1);
    expect(q2.matches[0]!.exp_id).toBe(r2.exp_id);

    // Query for a non-matching signal -> empty
    const q3 = parseResult(
      await handlers.hive_exp_query({ signals: ['dependency_vulnerability'] }),
    ) as { matches: Array<{ exp_id: string }>; total_available: number };

    expect(q3.total_available).toBe(0);
    expect(q3.matches).toEqual([]);

    // Cleanup
    ctx.projector.close();
    ctx.aggregator.close();
  });

  it('signal normalization works end-to-end (aliases resolve to canonical)', async () => {
    const { ctx, handlers } = setupContext();

    // Record with alias
    const r = parseResult(
      await handlers.hive_exp_record(makeRecordArgs({
        signals: ['typescript_compilation_failed'],
        strategy: { name: 'ts_fix', description: 'Fix TS compilation', category: 'repair' },
      })),
    ) as { exp_id: string };

    // Query using canonical name
    const q = parseResult(
      await handlers.hive_exp_query({ signals: ['tsc_error'] }),
    ) as { matches: Array<{ exp_id: string }>; total_available: number };

    expect(q.total_available).toBe(1);
    expect(q.matches[0]!.exp_id).toBe(r.exp_id);

    // Cleanup
    ctx.projector.close();
    ctx.aggregator.close();
  });
});

// ---------------------------------------------------------------------------
// 3. Outcome Tracking
// ---------------------------------------------------------------------------

describe('Outcome Tracking', () => {
  it('success and failure outcomes are tracked and reflected in stats', async () => {
    const { ctx, handlers } = setupContext();

    // Record two experiences
    const r1 = parseResult(
      await handlers.hive_exp_record(makeRecordArgs({
        signals: ['tsc_error'],
        strategy: { name: 'strategy_a', description: 'Strategy A', category: 'repair' },
      })),
    ) as { exp_id: string };

    const r2 = parseResult(
      await handlers.hive_exp_record(makeRecordArgs({
        signals: ['test_failed'],
        strategy: { name: 'strategy_b', description: 'Strategy B', category: 'optimize' },
      })),
    ) as { exp_id: string };

    // Record success outcome for r1
    await handlers.hive_exp_outcome({ exp_id: r1.exp_id, result: 'success' });

    // Record failure outcome for r2
    await handlers.hive_exp_outcome({ exp_id: r2.exp_id, result: 'failed' });

    // Check stats for r1
    const stats1 = ctx.aggregator.getExperienceStats(r1.exp_id);
    expect(stats1).not.toBeNull();
    expect(stats1!.ref_count).toBe(1);
    expect(stats1!.success_count).toBe(1);
    expect(stats1!.fail_count).toBe(0);
    expect(stats1!.success_rate).toBe(1.0);

    // Check stats for r2
    const stats2 = ctx.aggregator.getExperienceStats(r2.exp_id);
    expect(stats2).not.toBeNull();
    expect(stats2!.ref_count).toBe(1);
    expect(stats2!.success_count).toBe(0);
    expect(stats2!.fail_count).toBe(1);
    expect(stats2!.success_rate).toBe(0.0);

    // Cleanup
    ctx.projector.close();
    ctx.aggregator.close();
  });

  it('outcome for non-existent experience returns error', async () => {
    const { ctx, handlers } = setupContext();

    const result = parseResult(
      await handlers.hive_exp_outcome({ exp_id: 'exp_nonexistent_123', result: 'success' }),
    ) as { status: string; message: string };

    expect(result.status).toBe('error');
    expect(result.message).toContain('Experience not found');

    // Cleanup
    ctx.projector.close();
    ctx.aggregator.close();
  });
});

// ---------------------------------------------------------------------------
// 4. Promote Security
// ---------------------------------------------------------------------------

describe('Promote Security', () => {
  it('MCP promote sets pending_promotion but does NOT actually move the file', async () => {
    const { ctx, handlers } = setupContext();

    // Record an experience
    const r = parseResult(
      await handlers.hive_exp_record(makeRecordArgs()),
    ) as { exp_id: string };

    const expId = r.exp_id;

    // Call promote via MCP
    const promoteResult = parseResult(
      await handlers.hive_exp_promote({ exp_id: expId, reason: 'Proven by team' }),
    ) as { status: string; exp_id: string; message: string };

    expect(promoteResult.status).toBe('pending_promotion');
    expect(promoteResult.exp_id).toBe(expId);
    expect(promoteResult.message).toContain('human confirmation');

    // Verify file is still in provisional/ (NOT moved to promoted/)
    const provisionalFile = path.join(ctx.provisionalDir, `${expId}.json`);
    const promotedFile = path.join(ctx.promotedDir, `${expId}.json`);

    expect(fs.existsSync(provisionalFile)).toBe(true);
    expect(fs.existsSync(promotedFile)).toBe(false);

    // Verify the JSON has pending_promotion: true
    const record = JSON.parse(fs.readFileSync(provisionalFile, 'utf-8'));
    expect(record.pending_promotion).toBe(true);
    expect(record.promotion_reason).toBe('Proven by team');

    // Verify promoted flag is still false
    expect(record.promoted).toBe(false);

    // Cleanup
    ctx.projector.close();
    ctx.aggregator.close();
  });

  it('promote on already-promoted experience returns already_promoted', async () => {
    const { ctx, handlers } = setupContext();

    // Record an experience
    const r = parseResult(
      await handlers.hive_exp_record(makeRecordArgs()),
    ) as { exp_id: string };

    const expId = r.exp_id;

    // Manually mark it as promoted by editing the JSON file
    const provisionalFile = path.join(ctx.provisionalDir, `${expId}.json`);
    const record = JSON.parse(fs.readFileSync(provisionalFile, 'utf-8'));
    record.promoted = true;
    fs.writeFileSync(provisionalFile, JSON.stringify(record, null, 2));

    // Try promoting via MCP
    const promoteResult = parseResult(
      await handlers.hive_exp_promote({ exp_id: expId }),
    ) as { status: string; exp_id: string };

    expect(promoteResult.status).toBe('already_promoted');
    expect(promoteResult.exp_id).toBe(expId);

    // Cleanup
    ctx.projector.close();
    ctx.aggregator.close();
  });

  it('promote on non-existent experience returns error', async () => {
    const { ctx, handlers } = setupContext();

    const result = parseResult(
      await handlers.hive_exp_promote({ exp_id: 'exp_does_not_exist' }),
    ) as { status: string; message: string };

    expect(result.status).toBe('error');
    expect(result.message).toContain('Experience not found');

    // Cleanup
    ctx.projector.close();
    ctx.aggregator.close();
  });
});

// ---------------------------------------------------------------------------
// 5. Projector Idempotency
// ---------------------------------------------------------------------------

describe('Projector Idempotency', () => {
  it('rebuild from scratch produces identical stats', async () => {
    const { ctx, handlers, tmpDir } = setupContext();

    // Record experiences and outcomes
    const r1 = parseResult(
      await handlers.hive_exp_record(makeRecordArgs({
        signals: ['tsc_error'],
        strategy: { name: 'strat_idem_a', description: 'A', category: 'repair' },
      })),
    ) as { exp_id: string };

    const r2 = parseResult(
      await handlers.hive_exp_record(makeRecordArgs({
        signals: ['test_failed'],
        strategy: { name: 'strat_idem_b', description: 'B', category: 'optimize' },
      })),
    ) as { exp_id: string };

    // Outcomes
    await handlers.hive_exp_outcome({ exp_id: r1.exp_id, result: 'success' });
    await handlers.hive_exp_outcome({ exp_id: r2.exp_id, result: 'failed' });

    // Capture stats before rebuild
    const stats1Before = ctx.aggregator.getExperienceStats(r1.exp_id);
    const stats2Before = ctx.aggregator.getExperienceStats(r2.exp_id);

    // Close projector and aggregator
    ctx.projector.close();
    ctx.aggregator.close();

    // Delete the DB
    fs.unlinkSync(ctx.dbPath);
    expect(fs.existsSync(ctx.dbPath)).toBe(false);

    // Create new projector and rebuild from events
    const projector2 = new EventProjector({ dbPath: ctx.dbPath, eventsDir: ctx.eventsDir });
    projector2.initialize();
    projector2.rebuild();

    // Create new aggregator and check stats
    const aggregator2 = new StatsAggregator({ dbPath: ctx.dbPath });

    const stats1After = aggregator2.getExperienceStats(r1.exp_id);
    const stats2After = aggregator2.getExperienceStats(r2.exp_id);

    // Stats should match
    expect(stats1After).not.toBeNull();
    expect(stats1After!.ref_count).toBe(stats1Before!.ref_count);
    expect(stats1After!.success_count).toBe(stats1Before!.success_count);
    expect(stats1After!.fail_count).toBe(stats1Before!.fail_count);
    expect(stats1After!.success_rate).toBe(stats1Before!.success_rate);

    expect(stats2After).not.toBeNull();
    expect(stats2After!.ref_count).toBe(stats2Before!.ref_count);
    expect(stats2After!.success_count).toBe(stats2Before!.success_count);
    expect(stats2After!.fail_count).toBe(stats2Before!.fail_count);
    expect(stats2After!.success_rate).toBe(stats2Before!.success_rate);

    // Cleanup
    projector2.close();
    aggregator2.close();
  });
});

// ---------------------------------------------------------------------------
// 6. Data Persistence
// ---------------------------------------------------------------------------

describe('Data Persistence', () => {
  it('data recorded with one context is visible from a new context instance', async () => {
    const tmpDir = makeTempDir();
    cleanupDirs.push(tmpDir);

    // First context: record an experience
    const ctx1 = createContext(tmpDir);
    const handlers1 = createToolHandlers(ctx1);

    const r = parseResult(
      await handlers1.hive_exp_record(makeRecordArgs({
        signals: ['lint_error'],
        strategy: { name: 'fix_lint', description: 'Fix lint issues', category: 'repair' },
      })),
    ) as { exp_id: string };

    const expId = r.exp_id;

    // Also record an outcome so projector data is written
    await handlers1.hive_exp_outcome({ exp_id: expId, result: 'success' });

    // Close the first context's resources
    ctx1.projector.close();
    ctx1.aggregator.close();

    // Second context: same directory, completely new instances
    const ctx2 = createContext(tmpDir);
    const handlers2 = createToolHandlers(ctx2);

    // Query should find the experience
    const queryResult = parseResult(
      await handlers2.hive_exp_query({ signals: ['lint_error'] }),
    ) as { matches: Array<{ exp_id: string }>; total_available: number };

    expect(queryResult.total_available).toBe(1);
    expect(queryResult.matches[0]!.exp_id).toBe(expId);

    // Stats should reflect the outcome (need to sync projector first)
    await ctx2.projector.incrementalSync();
    const stats = ctx2.aggregator.getExperienceStats(expId);
    expect(stats).not.toBeNull();
    expect(stats!.ref_count).toBe(1);
    expect(stats!.success_count).toBe(1);

    // Cleanup
    ctx2.projector.close();
    ctx2.aggregator.close();
  });

  it('experience files persist on disk between context instances', async () => {
    const tmpDir = makeTempDir();
    cleanupDirs.push(tmpDir);

    // Record with first context
    const ctx1 = createContext(tmpDir);
    const handlers1 = createToolHandlers(ctx1);

    const r = parseResult(
      await handlers1.hive_exp_record(makeRecordArgs()),
    ) as { exp_id: string };

    ctx1.projector.close();
    ctx1.aggregator.close();

    // Verify file exists on disk
    const filePath = path.join(tmpDir, 'experiences', 'provisional', `${r.exp_id}.json`);
    expect(fs.existsSync(filePath)).toBe(true);

    // Read the file directly and verify structure
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(raw.id).toBe(r.exp_id);
    expect(raw.type).toBe('experience');
    expect(raw.schema_version).toBe('1.1.0');
    expect(raw.provisional).toBe(true);
    expect(raw.promoted).toBe(false);
    expect(raw.signals).toEqual(['tsc_error', 'build_failed']);
    expect(raw.strategy.name).toBe('clear_cache_rebuild');
    expect(raw.outcome.status).toBe('success');
    expect(raw.signature).toMatch(/^hmac-sha256:/);
  });
});
