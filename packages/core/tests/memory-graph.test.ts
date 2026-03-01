import { describe, expect, it, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { MemoryGraphWriter } from '../src/memory-graph/writer.js';
import type { MemoryGraphEntry } from '../src/memory-graph/writer.js';
import { MemoryGraphQuery } from '../src/memory-graph/query.js';

function testDir(): string {
  return join(tmpdir(), `memory-graph-test-${randomUUID()}`);
}

function makeEntry(overrides: Partial<MemoryGraphEntry> = {}): MemoryGraphEntry {
  return {
    exp_id: `exp_${randomUUID()}`,
    signal: 'tsc_error',
    strategy_name: 'add_missing_import',
    source_agent: 'codex',
    timestamp: '2026-03-01T10:00:00Z',
    outcome: 'success',
    related_exp_ids: [],
    confidence: 0.8,
    ...overrides,
  };
}

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  cleanupDirs.length = 0;
});

describe('MemoryGraphWriter', () => {
  it('creates file if not exists', async () => {
    const dir = testDir();
    cleanupDirs.push(dir);
    const filePath = join(dir, 'subdir', 'memory-graph.jsonl');
    const writer = new MemoryGraphWriter({ filePath });

    await writer.append(makeEntry());

    const content = await readFile(filePath, 'utf-8');
    expect(content.trim().length).toBeGreaterThan(0);
  });

  it('appends entries as valid JSONL', async () => {
    const dir = testDir();
    cleanupDirs.push(dir);
    const filePath = join(dir, 'memory-graph.jsonl');
    const writer = new MemoryGraphWriter({ filePath });

    const entry1 = makeEntry({ exp_id: 'exp_001' });
    const entry2 = makeEntry({ exp_id: 'exp_002' });

    await writer.append(entry1);
    await writer.append(entry2);

    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);

    const parsed1 = JSON.parse(lines[0]);
    const parsed2 = JSON.parse(lines[1]);
    expect(parsed1.exp_id).toBe('exp_001');
    expect(parsed2.exp_id).toBe('exp_002');
  });

  it('validates required fields before writing', async () => {
    const dir = testDir();
    cleanupDirs.push(dir);
    const filePath = join(dir, 'memory-graph.jsonl');
    const writer = new MemoryGraphWriter({ filePath });

    const invalid = { exp_id: 'exp_001' } as MemoryGraphEntry;
    await expect(writer.append(invalid)).rejects.toThrow('Missing required field');
  });

  it('rejects invalid outcome', async () => {
    const dir = testDir();
    cleanupDirs.push(dir);
    const filePath = join(dir, 'memory-graph.jsonl');
    const writer = new MemoryGraphWriter({ filePath });

    const invalid = makeEntry({ outcome: 'invalid' as 'success' });
    await expect(writer.append(invalid)).rejects.toThrow('outcome');
  });

  it('rejects confidence outside 0-1', async () => {
    const dir = testDir();
    cleanupDirs.push(dir);
    const filePath = join(dir, 'memory-graph.jsonl');
    const writer = new MemoryGraphWriter({ filePath });

    const invalid = makeEntry({ confidence: 1.5 });
    await expect(writer.append(invalid)).rejects.toThrow('confidence');
  });
});

describe('MemoryGraphQuery', () => {
  async function setupGraph(entries: MemoryGraphEntry[]): Promise<{ filePath: string }> {
    const dir = testDir();
    cleanupDirs.push(dir);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, 'memory-graph.jsonl');
    const writer = new MemoryGraphWriter({ filePath });

    for (const entry of entries) {
      await writer.append(entry);
    }

    return { filePath };
  }

  it('returns all entries when no filter', async () => {
    const entries = [
      makeEntry({ exp_id: 'exp_a' }),
      makeEntry({ exp_id: 'exp_b' }),
      makeEntry({ exp_id: 'exp_c' }),
    ];
    const { filePath } = await setupGraph(entries);
    const query = new MemoryGraphQuery({ filePath });

    const results = await query.query({});
    expect(results).toHaveLength(3);
  });

  it('filters by signal', async () => {
    const entries = [
      makeEntry({ exp_id: 'exp_a', signal: 'tsc_error' }),
      makeEntry({ exp_id: 'exp_b', signal: 'lint_warning' }),
      makeEntry({ exp_id: 'exp_c', signal: 'tsc_error' }),
    ];
    const { filePath } = await setupGraph(entries);
    const query = new MemoryGraphQuery({ filePath });

    const results = await query.query({ signal: 'tsc_error' });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.signal === 'tsc_error')).toBe(true);
  });

  it('filters by strategy_name', async () => {
    const entries = [
      makeEntry({ exp_id: 'exp_a', strategy_name: 'add_missing_import' }),
      makeEntry({ exp_id: 'exp_b', strategy_name: 'retry_build' }),
    ];
    const { filePath } = await setupGraph(entries);
    const query = new MemoryGraphQuery({ filePath });

    const results = await query.query({ strategy_name: 'retry_build' });
    expect(results).toHaveLength(1);
    expect(results[0].strategy_name).toBe('retry_build');
  });

  it('filters by source_agent', async () => {
    const entries = [
      makeEntry({ exp_id: 'exp_a', source_agent: 'codex' }),
      makeEntry({ exp_id: 'exp_b', source_agent: 'claude-code' }),
      makeEntry({ exp_id: 'exp_c', source_agent: 'codex' }),
    ];
    const { filePath } = await setupGraph(entries);
    const query = new MemoryGraphQuery({ filePath });

    const results = await query.query({ source_agent: 'claude-code' });
    expect(results).toHaveLength(1);
    expect(results[0].source_agent).toBe('claude-code');
  });

  it('filters by outcome', async () => {
    const entries = [
      makeEntry({ exp_id: 'exp_a', outcome: 'success' }),
      makeEntry({ exp_id: 'exp_b', outcome: 'failed' }),
      makeEntry({ exp_id: 'exp_c', outcome: 'partial' }),
    ];
    const { filePath } = await setupGraph(entries);
    const query = new MemoryGraphQuery({ filePath });

    const results = await query.query({ outcome: 'failed' });
    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe('failed');
  });

  it('respects limit', async () => {
    const entries = [
      makeEntry({ exp_id: 'exp_a', timestamp: '2026-03-01T10:00:00Z' }),
      makeEntry({ exp_id: 'exp_b', timestamp: '2026-03-01T11:00:00Z' }),
      makeEntry({ exp_id: 'exp_c', timestamp: '2026-03-01T12:00:00Z' }),
    ];
    const { filePath } = await setupGraph(entries);
    const query = new MemoryGraphQuery({ filePath });

    const results = await query.query({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('getCausalChain follows related_exp_ids', async () => {
    const entries = [
      makeEntry({
        exp_id: 'exp_root',
        timestamp: '2026-03-01T08:00:00Z',
        related_exp_ids: [],
      }),
      makeEntry({
        exp_id: 'exp_mid',
        timestamp: '2026-03-01T09:00:00Z',
        related_exp_ids: ['exp_root'],
      }),
      makeEntry({
        exp_id: 'exp_leaf',
        timestamp: '2026-03-01T10:00:00Z',
        related_exp_ids: ['exp_mid'],
      }),
    ];
    const { filePath } = await setupGraph(entries);
    const query = new MemoryGraphQuery({ filePath });

    const chain = await query.getCausalChain('exp_leaf');
    expect(chain).toHaveLength(3);
    // Chronological order
    expect(chain[0].exp_id).toBe('exp_root');
    expect(chain[1].exp_id).toBe('exp_mid');
    expect(chain[2].exp_id).toBe('exp_leaf');
  });

  it('getCausalChain handles cycles (dedup)', async () => {
    const entries = [
      makeEntry({
        exp_id: 'exp_a',
        timestamp: '2026-03-01T08:00:00Z',
        related_exp_ids: ['exp_b'],
      }),
      makeEntry({
        exp_id: 'exp_b',
        timestamp: '2026-03-01T09:00:00Z',
        related_exp_ids: ['exp_a'],
      }),
    ];
    const { filePath } = await setupGraph(entries);
    const query = new MemoryGraphQuery({ filePath });

    const chain = await query.getCausalChain('exp_a');
    expect(chain).toHaveLength(2);
    // Should not loop infinitely
    const ids = chain.map((e) => e.exp_id);
    expect(ids).toContain('exp_a');
    expect(ids).toContain('exp_b');
  });

  it('getCausalChain respects max depth 10', async () => {
    // Create a chain of 15 entries
    const entries: MemoryGraphEntry[] = [];
    for (let i = 0; i < 15; i++) {
      entries.push(
        makeEntry({
          exp_id: `exp_${i}`,
          timestamp: new Date(Date.UTC(2026, 2, 1, i)).toISOString(),
          related_exp_ids: i > 0 ? [`exp_${i - 1}`] : [],
        }),
      );
    }
    const { filePath } = await setupGraph(entries);
    const query = new MemoryGraphQuery({ filePath });

    // Start from the end of the chain (exp_14)
    const chain = await query.getCausalChain('exp_14');
    // depth 0 = exp_14, depth 1 = exp_13, ... depth 10 = exp_4
    // So we get entries 4 through 14 = 11 entries
    expect(chain.length).toBeLessThanOrEqual(11);
    expect(chain.length).toBeGreaterThan(0);
  });

  it('returns empty array for missing file', async () => {
    const dir = testDir();
    cleanupDirs.push(dir);
    const filePath = join(dir, 'nonexistent.jsonl');
    const query = new MemoryGraphQuery({ filePath });

    const results = await query.query({});
    expect(results).toEqual([]);
  });

  it('returns empty array for getCausalChain on missing file', async () => {
    const dir = testDir();
    cleanupDirs.push(dir);
    const filePath = join(dir, 'nonexistent.jsonl');
    const query = new MemoryGraphQuery({ filePath });

    const chain = await query.getCausalChain('exp_nonexistent');
    expect(chain).toEqual([]);
  });
});
