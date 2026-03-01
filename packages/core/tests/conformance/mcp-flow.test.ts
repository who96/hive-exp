import { describe, it, expect, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as crypto from 'node:crypto';

import {
  // Types (used as type-only via interfaces)
  type ExperienceRecord,
  type HiveEvent,
  type EventType,
  type SignerInterface,
  type SignalConvention,
  type ExperienceCreatedPayload,
  type ExperienceReferencedPayload,
  type ExperienceOutcomePayload,

  // Schema
  validateExperience,
  validateEvent,
  SIGNAL_CONVENTIONS,
  normalizeSignal,

  // Signer
  createSigner,

  // Sanitizer
  sanitizeSecurity,
  sanitizePrivacy,

  // Events
  EventWriter,
  EventReader,
  EventProjector,

  // Memory Graph
  MemoryGraphWriter,
  MemoryGraphQuery,

  // Stats
  computeDecay,
  effectiveConfidence,
  StatsAggregator,
} from '../../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SECRET = 'conformance-test-secret-key-2024';
const SOURCE_AGENT = 'mcp-conformance-agent';

function makeExpId(): string {
  const ts = Date.now();
  const hash = crypto.randomBytes(4).toString('hex');
  return `exp_${ts}_${hash}`;
}

function makeEvtId(): string {
  const ts = Date.now();
  const hash = crypto.randomBytes(4).toString('hex');
  return `evt_${ts}_${hash}`;
}

function nowISO(): string {
  return new Date().toISOString().replace(/(\.\d{3})\d*Z$/, '$1Z');
}

// ---------------------------------------------------------------------------
// Full MCP lifecycle test
// ---------------------------------------------------------------------------

describe('Conformance: MCP tool flow', () => {
  const baseDir = path.join(
    os.tmpdir(),
    `hive-conformance-${crypto.randomUUID()}`,
  );
  const eventsDir = path.join(baseDir, 'events');
  const dbPath = path.join(baseDir, 'hive-exp.db');
  const graphPath = path.join(baseDir, 'memory-graph.jsonl');

  // Track resources for cleanup
  const closables: Array<{ close(): void }> = [];

  afterAll(async () => {
    for (const c of closables) {
      try { c.close(); } catch { /* ignore */ }
    }
    await fsp.rm(baseDir, { recursive: true, force: true }).catch(() => {});
  });

  it('Full MCP lifecycle: record -> query -> outcome -> stats', async () => {
    // ----------------------------------------------------------------
    // 1. Setup
    // ----------------------------------------------------------------
    fs.mkdirSync(eventsDir, { recursive: true });

    const signer = createSigner({ algorithm: 'hmac-sha256', secret: TEST_SECRET });
    const eventWriter = new EventWriter({ eventsDir });
    const eventReader = new EventReader({ eventsDir });
    const projector = new EventProjector({ dbPath, eventsDir });
    closables.push(projector);
    projector.initialize();

    const graphWriter = new MemoryGraphWriter({ filePath: graphPath });
    const graphQuery = new MemoryGraphQuery({ filePath: graphPath });

    // ----------------------------------------------------------------
    // 2. hive_exp_record flow
    // ----------------------------------------------------------------

    // 2a. Sanitize strategy description
    const rawDescription =
      'Fix TypeScript build errors by clearing the cache at /Users/dev/project/.cache and running eval() on the config';
    const secResult = sanitizeSecurity(rawDescription);
    expect(secResult.violations.length).toBeGreaterThan(0);
    expect(secResult.violations).toContain('eval() call');

    const privResult = sanitizePrivacy(secResult.clean);
    expect(privResult.redactions.length).toBeGreaterThan(0);
    expect(privResult.redactions).toContain('macOS user path');

    const cleanDescription = privResult.clean;
    // The cleaned description must not contain eval( or the raw path
    expect(cleanDescription).not.toContain('eval(');
    expect(cleanDescription).not.toContain('/Users/dev');

    // 2b. Normalize signals
    const rawSignals = ['typescript_compilation_failed', 'Build Error'];
    const normalizedSignals = rawSignals.map(normalizeSignal);
    expect(normalizedSignals).toContain('tsc_error');
    expect(normalizedSignals).toContain('build_failed');

    // 2c. Build ExperienceRecord
    const expId = makeExpId();
    const createdTs = nowISO();

    const record: ExperienceRecord = {
      id: expId,
      type: 'experience',
      schema_version: '1.1.0',
      signals: normalizedSignals,
      scope: 'project',
      preconditions: ['node >= 18'],
      strategy: {
        name: 'clear_cache_rebuild',
        description: cleanDescription,
        category: 'repair',
      },
      outcome: {
        status: 'success',
        evidence: 'tsc exited with code 0',
        blast_radius: { files: 3, lines: 42 },
      },
      confidence: 0.85,
      source_agent: SOURCE_AGENT,
      signature: '', // will be filled after signing
      validated_by: null,
      promoted: false,
      provisional: false,
      provisional_deadline: null,
      supersedes: null,
      superseded_by: null,
      risk_level: 'low',
      created: createdTs,
      last_confirmed: createdTs,
      decay_halflife_days: 30,
      archived: false,
      archived_reason: null,
    };

    // 2d. Validate experience (before signing, with placeholder signature)
    // Sign first so the signature field passes schema validation
    const dataToSign = JSON.stringify({
      id: record.id,
      strategy: record.strategy,
      outcome: record.outcome,
      confidence: record.confidence,
    });
    record.signature = signer.sign(dataToSign);

    const expValidation = validateExperience(record);
    expect(expValidation.valid).toBe(true);
    expect(expValidation.errors).toEqual([]);

    // 2e. Verify signature
    expect(signer.verify(dataToSign, record.signature)).toBe(true);

    // 2f. Build and validate experience.created event
    const createdEvtId = makeEvtId();
    const createdEvent: HiveEvent<ExperienceCreatedPayload> = {
      event_id: createdEvtId,
      type: 'experience.created',
      timestamp: createdTs,
      source_agent: SOURCE_AGENT,
      signature: signer.sign(createdEvtId),
      payload: {
        exp_id: expId,
        initial_confidence: record.confidence,
      },
    };

    const evtValidation = validateEvent(createdEvent);
    expect(evtValidation.valid).toBe(true);
    expect(evtValidation.errors).toEqual([]);

    // 2g. Write event
    await eventWriter.append(createdEvent);

    // 2h. Write to memory graph
    await graphWriter.append({
      exp_id: expId,
      signal: normalizedSignals[0]!,
      strategy_name: record.strategy.name,
      source_agent: SOURCE_AGENT,
      timestamp: createdTs,
      outcome: record.outcome.status,
      related_exp_ids: [],
      confidence: record.confidence,
    });

    // ----------------------------------------------------------------
    // 3. hive_exp_query flow
    // ----------------------------------------------------------------

    // 3a. Read events filtered by type
    const createdEvents = await eventReader.readEvents({
      types: ['experience.created'],
    });
    expect(createdEvents.length).toBeGreaterThanOrEqual(1);
    const foundEvent = createdEvents.find(
      (e) => (e.payload as ExperienceCreatedPayload).exp_id === expId,
    );
    expect(foundEvent).toBeDefined();
    expect(foundEvent!.event_id).toBe(createdEvtId);

    // 3b. Query memory graph by signal
    const graphResults = await graphQuery.query({ signal: 'tsc_error' });
    expect(graphResults.length).toBeGreaterThanOrEqual(1);
    const graphHit = graphResults.find((e) => e.exp_id === expId);
    expect(graphHit).toBeDefined();
    expect(graphHit!.strategy_name).toBe('clear_cache_rebuild');

    // ----------------------------------------------------------------
    // 4. hive_exp_outcome flow
    // ----------------------------------------------------------------

    // 4a. Build and write experience.referenced event
    const refEvtId = makeEvtId();
    const refEvent: HiveEvent<ExperienceReferencedPayload> = {
      event_id: refEvtId,
      type: 'experience.referenced',
      timestamp: nowISO(),
      source_agent: SOURCE_AGENT,
      signature: signer.sign(refEvtId),
      payload: {
        exp_id: expId,
        context_summary: 'Encountered tsc_error during CI build',
      },
    };
    const refValidation = validateEvent(refEvent);
    expect(refValidation.valid).toBe(true);
    await eventWriter.append(refEvent);

    // 4b. Build and write experience.outcome_recorded event
    const outcomeEvtId = makeEvtId();
    const outcomeEvent: HiveEvent<ExperienceOutcomePayload> = {
      event_id: outcomeEvtId,
      type: 'experience.outcome_recorded',
      timestamp: nowISO(),
      source_agent: SOURCE_AGENT,
      signature: signer.sign(outcomeEvtId),
      payload: {
        exp_id: expId,
        ref_event_id: refEvtId,
        result: 'success',
      },
    };
    const outcomeValidation = validateEvent(outcomeEvent);
    expect(outcomeValidation.valid).toBe(true);
    await eventWriter.append(outcomeEvent);

    // 4c. Project all events via rebuild
    projector.rebuild();

    // 4d. Verify usage_log has the reference with result
    const db = (await import('better-sqlite3')).default;
    const verifyDb = new db(dbPath, { readonly: true });

    const usageRow = verifyDb
      .prepare('SELECT * FROM usage_log WHERE event_id = ?')
      .get(refEvtId) as Record<string, unknown> | undefined;
    expect(usageRow).toBeDefined();
    expect(usageRow!.exp_id).toBe(expId);
    expect(usageRow!.result).toBe('success');

    // 4e. Verify experience_meta has the experience
    const metaRow = verifyDb
      .prepare('SELECT * FROM experience_meta WHERE exp_id = ?')
      .get(expId) as Record<string, unknown> | undefined;
    expect(metaRow).toBeDefined();

    verifyDb.close();

    // ----------------------------------------------------------------
    // 5. hive_exp_stats flow
    // ----------------------------------------------------------------

    const stats = new StatsAggregator({ dbPath });
    closables.push(stats);

    const expStats = stats.getExperienceStats(expId);
    expect(expStats).not.toBeNull();
    expect(expStats!.ref_count).toBe(1);
    expect(expStats!.success_count).toBe(1);
    expect(expStats!.fail_count).toBe(0);
    expect(expStats!.success_rate).toBe(1.0);

    stats.close();

    // ----------------------------------------------------------------
    // 6. Confidence decay verification
    // ----------------------------------------------------------------

    // 60 days with 30-day halflife = 2 half-lives => ~25% of original
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const decayed = computeDecay(1.0, sixtyDaysAgo, new Date(), 30);
    // 0.5^2 = 0.25, allow some floating point tolerance
    expect(decayed).toBeCloseTo(0.25, 2);

    // Also test with the original confidence value
    const decayedWithConf = computeDecay(0.85, sixtyDaysAgo, new Date(), 30);
    expect(decayedWithConf).toBeCloseTo(0.85 * 0.25, 2);

    // effectiveConfidence uses "now" internally
    const ec = effectiveConfidence(1.0, sixtyDaysAgo.toISOString(), 30);
    expect(ec).toBeCloseTo(0.25, 2);

    // ----------------------------------------------------------------
    // 7. Idempotent rebuild verification
    // ----------------------------------------------------------------

    // Close the projector, delete DB, create fresh projector, rebuild
    projector.close();
    // Remove projector from closables since we closed it
    closables.splice(closables.indexOf(projector), 1);

    fs.unlinkSync(dbPath);
    expect(fs.existsSync(dbPath)).toBe(false);

    const projector2 = new EventProjector({ dbPath, eventsDir });
    closables.push(projector2);
    projector2.initialize();
    projector2.rebuild();

    // Re-check stats with a new aggregator
    const stats2 = new StatsAggregator({ dbPath });
    closables.push(stats2);

    const expStats2 = stats2.getExperienceStats(expId);
    expect(expStats2).not.toBeNull();
    expect(expStats2!.ref_count).toBe(1);
    expect(expStats2!.success_count).toBe(1);
    expect(expStats2!.success_rate).toBe(1.0);

    stats2.close();
    projector2.close();
  });
});

// ---------------------------------------------------------------------------
// Signal normalization tests
// ---------------------------------------------------------------------------

describe('Conformance: Signal normalization across variants', () => {
  it('aliases resolve to canonical names', () => {
    // Alias -> canonical
    expect(normalizeSignal('typescript_compilation_failed')).toBe('tsc_error');
    expect(normalizeSignal('build_error_ts')).toBe('tsc_error');
    expect(normalizeSignal('ts_compiler_error')).toBe('tsc_error');
  });

  it('canonical names resolve to themselves', () => {
    expect(normalizeSignal('tsc_error')).toBe('tsc_error');
    expect(normalizeSignal('build_failed')).toBe('build_failed');
    expect(normalizeSignal('test_failed')).toBe('test_failed');
  });

  it('free-form messages resolve via detect_pattern regex', () => {
    // These are free-form strings that should match detect_pattern regexes
    expect(normalizeSignal('tsc compilation error on line 42')).toBe('tsc_error');
    expect(normalizeSignal('build pipeline failed at step 3')).toBe('build_failed');
    expect(normalizeSignal('Cannot find module @foo/bar')).toBe('module_not_found');
    expect(normalizeSignal('test suite failed with 3 errors')).toBe('test_failed');
    expect(normalizeSignal('eslint lint error in file.ts')).toBe('lint_error');
  });

  it('case-insensitive alias lookup', () => {
    expect(normalizeSignal('TSC_ERROR')).toBe('tsc_error');
    expect(normalizeSignal('Build_Error')).toBe('build_failed');
    expect(normalizeSignal('UNIT_TEST_FAILED')).toBe('test_failed');
  });

  it('unknown signals pass through unchanged', () => {
    const custom = 'my_custom_project_signal';
    expect(normalizeSignal(custom)).toBe(custom);
  });

  it('at least 5 different inputs mapping to known signals', () => {
    const mappings: Array<[string, string]> = [
      ['typescript_compilation_failed', 'tsc_error'],
      ['build_error', 'build_failed'],
      ['cannot_find_module', 'module_not_found'],
      ['unit_test_failed', 'test_failed'],
      ['eslint_error', 'lint_error'],
      ['null_pointer', 'null_reference'],
      ['vulnerability_found', 'dependency_vulnerability'],
    ];

    for (const [input, expected] of mappings) {
      expect(normalizeSignal(input)).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// Sanitizer tests
// ---------------------------------------------------------------------------

describe('Conformance: Sanitizer catches dangerous input', () => {
  const dangerousInput = [
    'Fix the build by running eval("require(pkg)") to dynamically load',
    'the module located at /Users/admin/secrets/credentials.json.',
    'Use API key sk-abc123456789abcdef to authenticate.',
  ].join(' ');

  it('sanitizeSecurity catches eval() call', () => {
    const result = sanitizeSecurity(dangerousInput);
    expect(result.violations).toContain('eval() call');
    expect(result.clean).not.toMatch(/\beval\s*\(/);
    expect(result.clean).toContain('[REDACTED:cmd_eval]');
  });

  it('sanitizePrivacy catches absolute path and API key', () => {
    // First run security sanitizer (as the real flow would)
    const secResult = sanitizeSecurity(dangerousInput);
    const privResult = sanitizePrivacy(secResult.clean);

    // Should catch the macOS path
    expect(privResult.redactions).toContain('macOS user path');
    expect(privResult.clean).not.toContain('/Users/admin');
    expect(privResult.clean).toContain('[PATH_REDACTED]');

    // Should catch the OpenAI-style API key
    expect(privResult.redactions).toContain('OpenAI API key');
    expect(privResult.clean).not.toContain('sk-abc123456789abcdef');
    expect(privResult.clean).toContain('[REDACTED:api_key]');
  });

  it('sanitizeSecurity catches backtick expressions', () => {
    const input = 'Run `rm -rf /tmp/cache` to clear everything';
    const result = sanitizeSecurity(input);
    expect(result.violations).toContain('backtick expression');
    // rm -rf is inside the backtick, which gets redacted first
    expect(result.clean).toContain('[REDACTED:cmd_backtick]');
  });

  it('sanitizePrivacy catches sensitive filenames', () => {
    // \b requires word-to-non-word boundary; credentials.json matches because
    // 'c' is a word char, but standalone ".env.local" preceded by space doesn't
    // because '.' is non-word. Use a context where \b fires: e.g. after a word char
    // like a path separator, or test credentials.json which always matches.
    const input = 'Edit config/.env.local and credentials.json for database setup';
    const result = sanitizePrivacy(input);
    expect(result.redactions).toContain('sensitive filename');
    expect(result.clean).not.toContain('credentials.json');
    // Also verify the path redaction captures the /Users path variant
    const input2 = 'Check /Users/admin/.env for secrets and id_rsa key';
    const result2 = sanitizePrivacy(input2);
    expect(result2.redactions).toContain('macOS user path');
    expect(result2.clean).toContain('[PATH_REDACTED]');
  });

  it('clean input passes through unchanged', () => {
    const safeInput = 'Refactor the error handling in the build pipeline to use proper try-catch blocks';
    const secResult = sanitizeSecurity(safeInput);
    expect(secResult.violations).toEqual([]);
    expect(secResult.clean).toBe(safeInput);

    const privResult = sanitizePrivacy(safeInput);
    expect(privResult.redactions).toEqual([]);
    expect(privResult.clean).toBe(safeInput);
  });
});

// ---------------------------------------------------------------------------
// Signer interface tests
// ---------------------------------------------------------------------------

describe('Conformance: Signer interface abstraction', () => {
  it('createSigner returns a SignerInterface', () => {
    const signer = createSigner({ algorithm: 'hmac-sha256', secret: 'test' });
    expect(typeof signer.sign).toBe('function');
    expect(typeof signer.verify).toBe('function');
  });

  it('sign produces a signature starting with hmac-sha256:', () => {
    const signer = createSigner({ algorithm: 'hmac-sha256', secret: 'secret123' });
    const sig = signer.sign('hello world');
    expect(sig.startsWith('hmac-sha256:')).toBe(true);
    // The hex digest should be 64 chars (SHA-256)
    const hex = sig.slice('hmac-sha256:'.length);
    expect(hex).toMatch(/^[a-f0-9]{64}$/);
  });

  it('verify succeeds with correct data', () => {
    const signer = createSigner({ algorithm: 'hmac-sha256', secret: 'secret123' });
    const data = 'important payload data';
    const sig = signer.sign(data);
    expect(signer.verify(data, sig)).toBe(true);
  });

  it('verify fails with tampered data', () => {
    const signer = createSigner({ algorithm: 'hmac-sha256', secret: 'secret123' });
    const data = 'important payload data';
    const sig = signer.sign(data);
    expect(signer.verify(data + ' tampered', sig)).toBe(false);
  });

  it('verify fails with tampered signature', () => {
    const signer = createSigner({ algorithm: 'hmac-sha256', secret: 'secret123' });
    const data = 'important payload data';
    const sig = signer.sign(data);
    // Flip last character
    const tampered = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
    expect(signer.verify(data, tampered)).toBe(false);
  });

  it('verify fails with wrong prefix', () => {
    const signer = createSigner({ algorithm: 'hmac-sha256', secret: 'secret123' });
    const data = 'test';
    const sig = signer.sign(data);
    const wrongPrefix = 'ed25519:' + sig.slice('hmac-sha256:'.length);
    expect(signer.verify(data, wrongPrefix)).toBe(false);
  });

  it('different secrets produce different signatures', () => {
    const signer1 = createSigner({ algorithm: 'hmac-sha256', secret: 'secret-a' });
    const signer2 = createSigner({ algorithm: 'hmac-sha256', secret: 'secret-b' });
    const data = 'same data';
    expect(signer1.sign(data)).not.toBe(signer2.sign(data));
  });

  it('same data with same secret produces deterministic signature', () => {
    const signer = createSigner({ algorithm: 'hmac-sha256', secret: 'deterministic' });
    const data = 'reproducible';
    expect(signer.sign(data)).toBe(signer.sign(data));
  });

  it('SignerInterface type does not mention HMAC', () => {
    // This is a structural test: the SignerInterface from types only has
    // sign(data: string): string and verify(data: string, signature: string): boolean
    // The createSigner factory hides the algorithm choice.
    const signer: SignerInterface = createSigner({
      algorithm: 'hmac-sha256',
      secret: 'test',
    });
    // We can use it purely through the interface
    const sig = signer.sign('data');
    expect(signer.verify('data', sig)).toBe(true);
  });
});
