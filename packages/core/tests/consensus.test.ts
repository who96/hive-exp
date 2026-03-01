import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

import { ConsensusDetector } from '../src/consensus.js';
import { EventWriter } from '../src/events/writer.js';
import type { ConsensusResult } from '../src/consensus.js';

interface ExperienceLike {
  id: string;
  signals: string[];
  strategy: { name: string };
  source_agent: string;
  confidence: number;
  last_confirmed?: string;
  decay_halflife_days?: number;
}

function createConsensusDetectorFixtures(): {
  provisionalDir: string;
  promotedDir: string;
  eventsDir: string;
  writeExperience: (dir: string, exp: ExperienceLike) => void;
} {
  const provisionalDir = mkdtempSync(path.join(tmpdir(), 'hive-consensus-prov-'));
  const promotedDir = mkdtempSync(path.join(tmpdir(), 'hive-consensus-prom-'));
  const eventsDir = mkdtempSync(path.join(tmpdir(), 'hive-consensus-events-'));

  function writeExperience(dir: string, exp: ExperienceLike): void {
    const fileName = `${exp.id}.json`;
    writeFileSync(path.join(dir, fileName), JSON.stringify(exp), 'utf8');
  }

  return { provisionalDir, promotedDir, eventsDir, writeExperience };
}

function baseExperience(overrides: Partial<ExperienceLike>): ExperienceLike {
  return {
    id: 'exp-default',
    signals: ['fallback'],
    strategy: { name: 'default_strategy' },
    source_agent: 'claude-code',
    confidence: 0.8,
    ...overrides,
  };
}

async function readEventsFromCurrentFile(eventsDir: string): Promise<string[]> {
  const reader = new EventWriter({ eventsDir });
  const filePath = reader.getCurrentFilePath();
  const content = readFileSync(filePath, 'utf8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

describe('ConsensusDetector', () => {
  let provisionalDir = '';
  let promotedDir = '';
  let eventsDir = '';
  let writeExperience: (dir: string, exp: ExperienceLike) => void;

  beforeEach(() => {
    const fixtures = createConsensusDetectorFixtures();
    provisionalDir = fixtures.provisionalDir;
    promotedDir = fixtures.promotedDir;
    eventsDir = fixtures.eventsDir;
    writeExperience = fixtures.writeExperience;
  });

  afterEach(() => {
    rmSync(provisionalDir, { recursive: true, force: true });
    rmSync(promotedDir, { recursive: true, force: true });
    rmSync(eventsDir, { recursive: true, force: true });
  });

  it('returns empty results when both directories are empty', () => {
    const detector = new ConsensusDetector({
      provisionalDir,
      promotedDir,
      eventWriter: new EventWriter({ eventsDir }),
    });

    expect(detector.detect()).toEqual([]);
  });

  it('does not create consensus when only one agent has evidence', () => {
    writeExperience(
      provisionalDir,
      baseExperience({
        id: 'exp-1',
        signals: ['error_spike'],
        strategy: { name: 'retry' },
        source_agent: 'codex',
      }),
    );
    writeExperience(
      provisionalDir,
      baseExperience({
        id: 'exp-2',
        signals: ['error_spike'],
        strategy: { name: 'retry' },
        source_agent: 'codex',
      }),
    );

    const detector = new ConsensusDetector({
      provisionalDir,
      promotedDir,
      eventWriter: new EventWriter({ eventsDir }),
    });

    expect(detector.detect()).toEqual([]);
  });

  it('detects consensus when two different agents confirm the same signal and strategy', () => {
    writeExperience(
      provisionalDir,
      baseExperience({ id: 'exp-1', signals: ['slow_api'], source_agent: 'codex' }),
    );
    writeExperience(
      promotedDir,
      baseExperience({ id: 'exp-2', signals: ['slow_api'], source_agent: 'cursor' }),
    );

    const detector = new ConsensusDetector({
      provisionalDir,
      promotedDir,
      eventWriter: new EventWriter({ eventsDir }),
    });

    const results = detector.detect();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      signal: 'slow_api',
      strategy_name: 'default_strategy',
      agents: ['codex', 'cursor'],
    });
  });

  it('does not count duplicated records from same source_agent as consensus', () => {
    writeExperience(
      provisionalDir,
      baseExperience({ id: 'exp-1', signals: ['timeout'], source_agent: 'cursor' }),
    );
    writeExperience(
      promotedDir,
      baseExperience({ id: 'exp-2', signals: ['timeout'], source_agent: 'cursor' }),
    );

    const detector = new ConsensusDetector({
      provisionalDir,
      promotedDir,
      eventWriter: new EventWriter({ eventsDir }),
    });

    expect(detector.detect()).toEqual([]);
  });

  it('does not cross-consensus across different strategy_name for the same signal', () => {
    writeExperience(
      provisionalDir,
      baseExperience({
        id: 'exp-1',
        signals: ['quota_hit'],
        strategy: { name: 'strategy_a' },
        source_agent: 'codex',
      }),
    );
    writeExperience(
      promotedDir,
      baseExperience({
        id: 'exp-2',
        signals: ['quota_hit'],
        strategy: { name: 'strategy_b' },
        source_agent: 'cursor',
      }),
    );

    const detector = new ConsensusDetector({
      provisionalDir,
      promotedDir,
      eventWriter: new EventWriter({ eventsDir }),
    });

    expect(detector.detect()).toEqual([]);
  });

  it('calculates consensus_strength as ratio of distinct agents to known agents', () => {
    writeExperience(
      provisionalDir,
      baseExperience({ id: 'exp-1', signals: ['retry_needed'], source_agent: 'codex' }),
    );
    writeExperience(
      promotedDir,
      baseExperience({ id: 'exp-2', signals: ['retry_needed'], source_agent: 'cursor' }),
    );

    const detector = new ConsensusDetector({
      provisionalDir,
      promotedDir,
      eventWriter: new EventWriter({ eventsDir }),
    });

    const results = detector.detect();
    expect(results[0]?.consensus_strength).toBeCloseTo(2 / 6, 6);
    expect(results[0]?.agents).toEqual(['codex', 'cursor']);
  });

  it('computes average confidence using effective confidence', () => {
    const nowFuture = new Date(Date.now() + 1000).toISOString();

    writeExperience(
      provisionalDir,
      baseExperience({
        id: 'exp-1',
        signals: ['cache_fail'],
        source_agent: 'codex',
        confidence: 0.6,
        last_confirmed: nowFuture,
        decay_halflife_days: 30,
      }),
    );
    writeExperience(
      promotedDir,
      baseExperience({
        id: 'exp-2',
        signals: ['cache_fail'],
        source_agent: 'cursor',
        confidence: 0.8,
        last_confirmed: nowFuture,
        decay_halflife_days: 30,
      }),
    );

    const detector = new ConsensusDetector({
      provisionalDir,
      promotedDir,
      eventWriter: new EventWriter({ eventsDir }),
    });

    const results = detector.detect();
    const avg = (0.6 + 0.8) / 2;

    expect(results).toHaveLength(1);
    expect(results[0]!.avg_confidence).toBeCloseTo(avg, 10);
  });

  it('detectAndEmit writes one experience.provisional event per exp id', async () => {
    writeExperience(
      provisionalDir,
      baseExperience({
        id: 'exp-1',
        signals: ['db_lock'],
        source_agent: 'codex',
      }),
    );
    writeExperience(
      promotedDir,
      baseExperience({
        id: 'exp-2',
        signals: ['db_lock'],
        source_agent: 'cursor',
      }),
    );

    const eventWriter = new EventWriter({ eventsDir });
    const detector = new ConsensusDetector({
      provisionalDir,
      promotedDir,
      eventWriter,
    });

    const output = await detector.detectAndEmit();
    const events = await readEventsFromCurrentFile(eventsDir);

    expect(output.eventsEmitted).toBe(2);
    expect(output.results).toHaveLength(1);
    expect(output.results[0]!.exp_ids).toEqual(['exp-1', 'exp-2']);
    expect(events).toHaveLength(2);
    events.forEach((line) => {
      const parsed = JSON.parse(line);
      expect(parsed.type).toBe('experience.provisional');
      expect(parsed.payload.exp_id).toMatch(/exp-(1|2)/);
    });
  });

  it('groups by both signal and strategy_name keys', () => {
    writeExperience(
      provisionalDir,
      baseExperience({
        id: 'exp-1',
        signals: ['token_limit'],
        strategy: { name: 'strategy-a' },
        source_agent: 'claude-code',
      }),
    );
    writeExperience(
      provisionalDir,
      baseExperience({
        id: 'exp-2',
        signals: ['token_limit'],
        strategy: { name: 'strategy-b' },
        source_agent: 'cursor',
      }),
    );
    writeExperience(
      promotedDir,
      baseExperience({
        id: 'exp-3',
        signals: ['token_limit', 'memory_pressure'],
        strategy: { name: 'strategy-a' },
        source_agent: 'cursor',
      }),
    );

    const detector = new ConsensusDetector({
      provisionalDir,
      promotedDir,
      eventWriter: new EventWriter({ eventsDir }),
    });

    const results = detector.detect();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      signal: 'token_limit',
      strategy_name: 'strategy-a',
      agents: ['claude-code', 'cursor'],
    } as ConsensusResult);
  });
});
