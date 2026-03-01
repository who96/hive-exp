import { describe, expect, it } from 'vitest';

import type { EventType, ExperienceRecord } from '../src/types/index.js';
import { normalizeSignal } from '../src/schema/signal-conventions.js';
import { validateEvent, validateExperience } from '../src/schema/validator.js';

function buildValidExperience(): ExperienceRecord {
  return {
    id: 'exp_1709280000_f3a7b2c1',
    type: 'experience',
    schema_version: '1.1.0',
    signals: ['tsc_error', 'module_not_found'],
    scope: 'universal',
    preconditions: ['TypeScript >= 5.0', 'Node.js >= 18'],
    strategy: {
      name: 'add_missing_import',
      description: 'Check and add missing import statements.',
      category: 'repair'
    },
    outcome: {
      status: 'success',
      evidence: '.artifacts/agent_runs/RUN_ID/verify.log',
      evidence_digest: 'sha256:a1b2c3d4',
      blast_radius: {
        files: 2,
        lines: 15
      }
    },
    confidence: 0.65,
    source_agent: 'codex',
    signature: 'hmac-sha256:e3b0c44298fc1c149afbf4c8996fb924',
    validated_by: null,
    promoted: false,
    provisional: false,
    provisional_deadline: null,
    supersedes: null,
    superseded_by: null,
    risk_level: 'low',
    created: '2026-03-01T10:00:00Z',
    last_confirmed: '2026-03-01T10:00:00Z',
    decay_halflife_days: 30,
    archived: false,
    archived_reason: null
  };
}

function buildEvent(type: EventType, payload: Record<string, unknown>) {
  return {
    event_id: 'evt_1709280300_a1b2c3d4',
    type,
    timestamp: '2026-03-01T10:05:00Z',
    source_agent: 'codex',
    signature: 'hmac-sha256:e3b0c44298fc1c149afbf4c8996fb924',
    payload
  };
}

describe('validateExperience', () => {
  it('passes for a valid experience record', () => {
    const result = validateExperience(buildValidExperience());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails when required fields are missing', () => {
    const invalid = { ...buildValidExperience() } as Partial<ExperienceRecord>;
    delete invalid.strategy;

    const result = validateExperience(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes('strategy'))).toBe(true);
  });

  it('fails when id format is invalid', () => {
    const invalid = {
      ...buildValidExperience(),
      id: 'experience_bad_id'
    };

    const result = validateExperience(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes('$/id'))).toBe(true);
  });

  it('fails when confidence is outside 0-1 range', () => {
    const invalid = {
      ...buildValidExperience(),
      confidence: 1.5
    };

    const result = validateExperience(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes('confidence'))).toBe(true);
  });

  it('fails when date fields are not ISO 8601 strings', () => {
    const invalid = {
      ...buildValidExperience(),
      created: 'not-a-date-time'
    };

    const result = validateExperience(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes('created'))).toBe(true);
  });

  it('fails when provisional is false but deadline is not null', () => {
    const invalid = {
      ...buildValidExperience(),
      provisional: false,
      provisional_deadline: '2026-03-08T10:05:00Z'
    };

    const result = validateExperience(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes('provisional_deadline'))).toBe(true);
  });

  it('fails when archived is false but archived_reason is set', () => {
    const invalid = {
      ...buildValidExperience(),
      archived: false,
      archived_reason: 'zero_ref'
    };

    const result = validateExperience(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes('archived_reason'))).toBe(true);
  });
});

describe('validateEvent', () => {
  const cases: Array<{ type: EventType; payload: Record<string, unknown> }> = [
    {
      type: 'experience.created',
      payload: {
        exp_id: 'exp_1709280000_f3a7b2c1',
        initial_confidence: 0.5
      }
    },
    {
      type: 'experience.referenced',
      payload: {
        exp_id: 'exp_1709280000_f3a7b2c1',
        context_summary: 'Injected advisory context for tsc_error.'
      }
    },
    {
      type: 'experience.outcome_recorded',
      payload: {
        exp_id: 'exp_1709280000_f3a7b2c1',
        ref_event_id: 'evt_1709280300_a1b2c3d4',
        result: 'success'
      }
    },
    {
      type: 'experience.promoted',
      payload: {
        exp_id: 'exp_1709280000_f3a7b2c1',
        promoted_by: 'human'
      }
    },
    {
      type: 'experience.provisional',
      payload: {
        exp_id: 'exp_1709280000_f3a7b2c1',
        consensus_agents: ['codex', 'claude-code'],
        deadline: '2026-03-08T10:05:00Z'
      }
    },
    {
      type: 'experience.provisional_expired',
      payload: {
        exp_id: 'exp_1709280000_f3a7b2c1'
      }
    },
    {
      type: 'experience.archived',
      payload: {
        exp_id: 'exp_1709280000_f3a7b2c1',
        reason: 'zero_ref'
      }
    },
    {
      type: 'experience.quarantined',
      payload: {
        exp_id: 'exp_1709280000_f3a7b2c1',
        reason: 'Potential toxic strategy detected.'
      }
    },
    {
      type: 'experience.superseded',
      payload: {
        old_exp_id: 'exp_1709280000_f3a7b2c1',
        new_exp_id: 'exp_1709280600_d4e5f6a7',
        reason: 'New strategy has broader coverage.'
      }
    },
    {
      type: 'confidence.decayed',
      payload: {
        affected_exp_ids: ['exp_1709280000_f3a7b2c1', 'exp_1709280600_d4e5f6a7'],
        decay_factor: 0.95
      }
    },
    {
      type: 'strategy.banned',
      payload: {
        strategy_name: 'blind_retry',
        reason: 'Creates infinite loop risk.',
        banned_by: 'safety-reviewer'
      }
    }
  ];

  it.each(cases)('passes for %s payload shape', ({ type, payload }) => {
    const result = validateEvent(buildEvent(type, payload));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails for unknown event type', () => {
    const invalid = {
      ...buildEvent('experience.created', {
        exp_id: 'exp_1709280000_f3a7b2c1',
        initial_confidence: 0.5
      }),
      type: 'experience.deleted'
    };

    const result = validateEvent(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('fails for invalid event_id format', () => {
    const invalid = {
      ...buildEvent('experience.referenced', {
        exp_id: 'exp_1709280000_f3a7b2c1',
        context_summary: 'Injected advisory context for tsc_error.'
      }),
      event_id: 'bad_event_id'
    };

    const result = validateEvent(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes('$/event_id'))).toBe(true);
  });

  it('fails for invalid ISO 8601 event timestamp', () => {
    const invalid = {
      ...buildEvent('experience.created', {
        exp_id: 'exp_1709280000_f3a7b2c1',
        initial_confidence: 0.5
      }),
      timestamp: 'bad-timestamp'
    };

    const result = validateEvent(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes('timestamp'))).toBe(true);
  });

  it('fails for weak signature format', () => {
    const invalid = {
      ...buildEvent('experience.created', {
        exp_id: 'exp_1709280000_f3a7b2c1',
        initial_confidence: 0.5
      }),
      signature: 'plain-text-signature'
    };

    const result = validateEvent(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes('signature'))).toBe(true);
  });

  it('fails when type and payload do not match', () => {
    const invalid = buildEvent('experience.created', {
      exp_id: 'exp_1709280000_f3a7b2c1',
      context_summary: 'Wrong payload for created event'
    });

    const result = validateEvent(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('normalizeSignal', () => {
  it('returns canonical signals unchanged', () => {
    expect(normalizeSignal('tsc_error')).toBe('tsc_error');
    expect(normalizeSignal('module_not_found')).toBe('module_not_found');
  });

  it('maps aliases to canonical names', () => {
    expect(normalizeSignal('typescript_compilation_failed')).toBe('tsc_error');
    expect(normalizeSignal('eslint_warning')).toBe('lint_warning');
  });

  it('maps free-form messages by regex conventions', () => {
    expect(normalizeSignal('Cannot find module "./utils"')).toBe('module_not_found');
    expect(normalizeSignal('UnhandledPromiseRejectionWarning: boom')).toBe('unhandled_rejection');
  });

  it('passes unknown signal through as-is', () => {
    expect(normalizeSignal('my_custom_signal')).toBe('my_custom_signal');
  });
});
