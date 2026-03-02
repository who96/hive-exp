import { describe, expect, it } from 'vitest';

import { detectDuplicates } from '../src/dedup.js';
import type { ExperienceRecord } from '../src/types/index.js';

function buildExperience(overrides: Partial<ExperienceRecord> = {}): ExperienceRecord {
  return {
    id: 'exp_1709280000_a1b2c3d4',
    type: 'experience',
    schema_version: '1.1.0',
    signals: ['tsc_error'],
    scope: 'project',
    strategy: {
      name: 'retry_with_backoff',
      description: 'Retry with backoff',
      category: 'repair',
    },
    outcome: {
      status: 'success',
    },
    confidence: 0.5,
    source_agent: 'agent-a',
    signature: 'hmac-sha256:test',
    validated_by: null,
    promoted: false,
    provisional: true,
    provisional_deadline: null,
    supersedes: null,
    superseded_by: null,
    created: '2026-03-01T00:00:00Z',
    last_confirmed: '2026-03-01T00:00:00Z',
    decay_halflife_days: 30,
    archived: false,
    archived_reason: null,
    ...overrides,
  };
}

describe('detectDuplicates', () => {
  it('returns empty array when no strategy duplicates exist', () => {
    const experiences = [
      buildExperience({
        id: 'exp_1709280001_aaaaaaaa',
        strategy: { name: 'retry_a', description: 'A', category: 'repair' },
      }),
      buildExperience({
        id: 'exp_1709280002_bbbbbbbb',
        strategy: { name: 'retry_b', description: 'B', category: 'repair' },
      }),
    ];

    expect(detectDuplicates(experiences)).toEqual([]);
  });

  it('prefers higher confidence for same strategy across different agents', () => {
    const experiences = [
      buildExperience({
        id: 'exp_1709280010_aaaaaaaa',
        source_agent: 'agent-a',
        confidence: 0.9,
      }),
      buildExperience({
        id: 'exp_1709280011_bbbbbbbb',
        source_agent: 'agent-b',
        confidence: 0.4,
      }),
    ];

    const actions = detectDuplicates(experiences);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      winner_id: 'exp_1709280010_aaaaaaaa',
      loser_id: 'exp_1709280011_bbbbbbbb',
    });
  });

  it('prefers higher confidence for same strategy from same agent', () => {
    const experiences = [
      buildExperience({
        id: 'exp_1709280020_aaaaaaaa',
        source_agent: 'agent-a',
        confidence: 0.7,
      }),
      buildExperience({
        id: 'exp_1709280021_bbbbbbbb',
        source_agent: 'agent-a',
        confidence: 0.3,
      }),
    ];

    const actions = detectDuplicates(experiences);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.winner_id).toBe('exp_1709280020_aaaaaaaa');
    expect(actions[0]?.loser_id).toBe('exp_1709280021_bbbbbbbb');
  });

  it('uses newer last_confirmed as tie-breaker when confidence is equal', () => {
    const experiences = [
      buildExperience({
        id: 'exp_1709280030_aaaaaaaa',
        confidence: 0.6,
        last_confirmed: '2026-03-02T10:00:00Z',
      }),
      buildExperience({
        id: 'exp_1709280031_bbbbbbbb',
        confidence: 0.6,
        last_confirmed: '2026-03-01T10:00:00Z',
      }),
    ];

    const actions = detectDuplicates(experiences);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.winner_id).toBe('exp_1709280030_aaaaaaaa');
    expect(actions[0]?.loser_id).toBe('exp_1709280031_bbbbbbbb');
  });

  it('keeps one winner and supersedes remaining duplicates in a group of three', () => {
    const experiences = [
      buildExperience({ id: 'exp_1709280040_aaaaaaaa', confidence: 0.95 }),
      buildExperience({ id: 'exp_1709280041_bbbbbbbb', confidence: 0.6 }),
      buildExperience({ id: 'exp_1709280042_cccccccc', confidence: 0.2 }),
    ];

    const actions = detectDuplicates(experiences);
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.winner_id)).toEqual([
      'exp_1709280040_aaaaaaaa',
      'exp_1709280040_aaaaaaaa',
    ]);
    expect(actions.map((a) => a.loser_id).sort()).toEqual([
      'exp_1709280041_bbbbbbbb',
      'exp_1709280042_cccccccc',
    ]);
  });

  it('skips archived experiences', () => {
    const experiences = [
      buildExperience({ id: 'exp_1709280050_aaaaaaaa', confidence: 0.9 }),
      buildExperience({
        id: 'exp_1709280051_bbbbbbbb',
        confidence: 0.1,
        archived: true,
        archived_reason: 'low_confidence',
      }),
    ];

    expect(detectDuplicates(experiences)).toEqual([]);
  });

  it('skips already superseded experiences', () => {
    const experiences = [
      buildExperience({ id: 'exp_1709280060_aaaaaaaa', confidence: 0.9 }),
      buildExperience({
        id: 'exp_1709280061_bbbbbbbb',
        confidence: 0.2,
        superseded_by: 'exp_1709280000_deadbeef',
      }),
    ];

    expect(detectDuplicates(experiences)).toEqual([]);
  });

  it('processes multiple strategy groups independently', () => {
    const experiences = [
      buildExperience({
        id: 'exp_1709280070_aaaaaaaa',
        strategy: { name: 'group_a', description: 'A', category: 'repair' },
        confidence: 0.9,
      }),
      buildExperience({
        id: 'exp_1709280071_bbbbbbbb',
        strategy: { name: 'group_a', description: 'A', category: 'repair' },
        confidence: 0.1,
      }),
      buildExperience({
        id: 'exp_1709280072_cccccccc',
        strategy: { name: 'group_b', description: 'B', category: 'repair' },
        confidence: 0.8,
      }),
      buildExperience({
        id: 'exp_1709280073_dddddddd',
        strategy: { name: 'group_b', description: 'B', category: 'repair' },
        confidence: 0.3,
      }),
    ];

    const actions = detectDuplicates(experiences);
    expect(actions).toHaveLength(2);
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          winner_id: 'exp_1709280070_aaaaaaaa',
          loser_id: 'exp_1709280071_bbbbbbbb',
        }),
        expect.objectContaining({
          winner_id: 'exp_1709280072_cccccccc',
          loser_id: 'exp_1709280073_dddddddd',
        }),
      ]),
    );
  });
});
