import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { createContext } from '../src/context.js';
import { registerInit } from '../src/commands/init.js';
import { registerAdd } from '../src/commands/add.js';
import { registerValidate } from '../src/commands/validate.js';
import { registerSign } from '../src/commands/sign.js';
import { registerQuery } from '../src/commands/query.js';
import { registerPromote } from '../src/commands/promote.js';
import { registerArchive } from '../src/commands/archive.js';
import { registerStats } from '../src/commands/stats.js';
import { registerReplay } from '../src/commands/replay.js';
import { registerExport } from '../src/commands/export.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function createTestProgram(): {
  program: Command;
  stdout: string[];
  stderr: string[];
} {
  const program = new Command();
  program
    .name('hive-exp')
    .description('AI Agent Experience Management System')
    .version('0.1.0');

  const stdout: string[] = [];
  const stderr: string[] = [];
  program.configureOutput({
    writeOut: (str) => {
      stdout.push(str);
    },
    writeErr: (str) => {
      stderr.push(str);
    },
  });

  program.exitOverride();
  registerInit(program);
  registerAdd(program);
  registerValidate(program);
  registerSign(program);
  registerQuery(program);
  registerPromote(program);
  registerArchive(program);
  registerStats(program);
  registerReplay(program);
  registerExport(program);

  return { program, stdout, stderr };
}

async function runCommand(args: string[]): Promise<{
  output: string;
  error: string;
  program: Command;
}> {
  const { program, stdout, stderr } = createTestProgram();
  const captured: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...a: unknown[]) => {
    captured.push(a.map(String).join(' '));
  };
  console.error = (...a: unknown[]) => {
    errors.push(a.map(String).join(' '));
  };
  try {
    await program.parseAsync(['node', 'hive-exp', ...args], { from: 'node' });
  } catch (err) {
    errors.push(String(err));
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return {
    output: [...stdout, ...captured].filter(Boolean).join('\n'),
    error: [...stderr, ...errors].filter(Boolean).join('\n'),
    program,
  };
}

const EXPECTED_COMMANDS = [
  'init',
  'add',
  'validate',
  'sign',
  'query',
  'promote',
  'archive',
  'stats',
  'replay',
  'export',
];

describe('hive-exp CLI', () => {
  let originalHome: string | undefined;
  let testHome: string;

  beforeEach(() => {
    originalHome = process.env.HIVE_EXP_HOME;
    testHome = mkdtempSync(join(tmpdir(), 'hive-exp-test-'));
    process.env.HIVE_EXP_HOME = testHome;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HIVE_EXP_HOME;
    } else {
      process.env.HIVE_EXP_HOME = originalHome;
    }

    if (testHome) {
      rmSync(testHome, { recursive: true, force: true });
    }
  });

  it('should create program with name hive-exp', () => {
    const { program } = createTestProgram();
    expect(program.name()).toBe('hive-exp');
  });

  it('should register all 10 commands', () => {
    const { program } = createTestProgram();
    const commandNames = program.commands.map((cmd) => cmd.name());
    expect(commandNames).toHaveLength(10);
    for (const name of EXPECTED_COMMANDS) {
      expect(commandNames).toContain(name);
    }
  });

  it('should have a description for every command', () => {
    const { program } = createTestProgram();
    for (const cmd of program.commands) {
      expect(cmd.description()).toBeTruthy();
    }
  });

  it('should output version 0.1.0 on --version', () => {
    const { program } = createTestProgram();
    expect(program.version()).toBe('0.1.0');
  });

  it('should include all command names in help output', () => {
    const { program } = createTestProgram();
    const helpText = program.helpInformation();
    for (const name of EXPECTED_COMMANDS) {
      expect(helpText).toContain(name);
    }
  });

  it('add should create experience file in provisional', async () => {
    const { output } = await runCommand(['add', '--signals', 'tsc_error', '--strategy', 'retry_logic']);
    const match = output.match(/exp_\d+_[a-f0-9]{8}/);
    expect(match).toBeTruthy();
    const expId = match![0];
    const ctx = createContext();
    expect(readFileSync(join(ctx.provisionalDir, `${expId}.json`), 'utf-8')).toContain(expId);
  });

  it('validate should pass on a valid file', async () => {
    const addResult = await runCommand(['add', '--signals', 'build_failed', '--strategy', 'retry_build']);
    const match = addResult.output.match(/exp_\d+_[a-f0-9]{8}/);
    expect(match).toBeTruthy();
    const expId = match![0];
    const ctx = createContext();
    const filePath = join(ctx.provisionalDir, `${expId}.json`);

    const validation = await runCommand(['validate', filePath]);
    expect(validation.output).toContain('PASS');
  });

  it('query should return added experiences', async () => {
    const addResult = await runCommand(['add', '--signals', 'lint_error', '--strategy', 'clean_logs']);
    const match = addResult.output.match(/exp_\d+_[a-f0-9]{8}/);
    expect(match).toBeTruthy();
    const expId = match![0];

    const query = await runCommand([
      'query',
      '--signal',
      'lint_error',
      '--format',
      'json',
    ]);
    const parsed = JSON.parse(query.output) as Array<{ id: string }>;
    expect(parsed.some((entry) => entry.id === expId)).toBe(true);
  });

  it('promote --confirm should move record to promoted', async () => {
    const addResult = await runCommand(['add', '--signals', 'test_failed', '--strategy', 'rerun_tests']);
    const match = addResult.output.match(/exp_\d+_[a-f0-9]{8}/);
    expect(match).toBeTruthy();
    const expId = match![0];

    const before = createContext();
    expect(readFileSync(join(before.provisionalDir, `${expId}.json`), 'utf-8')).toBeTruthy();
    const confirm = await runCommand(['promote', expId, '--confirm']);
    expect(confirm.output).toContain(`Promoted ${expId}`);

    const after = createContext();
    expect(readFileSync(join(after.promotedDir, `${expId}.json`), 'utf-8')).toBeTruthy();
    expect(() => readFileSync(join(after.provisionalDir, `${expId}.json`), 'utf-8')).toThrow();
  });

  it('stats overview should show correct counts', async () => {
    await runCommand(['add', '--signals', 'signal_a', '--strategy', 'strat_a']);
    await runCommand(['add', '--signals', 'signal_b', '--strategy', 'strat_b']);

    const stats = await runCommand(['stats', '--type', 'overview', '--format', 'json']);
    const overview = JSON.parse(stats.output) as { provisional: number; promoted: number; archived: number };
    expect(overview.provisional).toBe(2);
    expect(overview.promoted).toBe(0);
    expect(overview.archived).toBe(0);
  });

  it('replay should rebuild projection from events', async () => {
    await runCommand(['add', '--signals', 'signal_r', '--strategy', 'strat_r']);
    const output = await runCommand(['replay']);
    expect(output.output).toContain('Replayed ');
  });

  it('export should filter by min-confidence', async () => {
    const first = await runCommand(['add', '--signals', 's_low', '--strategy', 'strat_low']);
    const second = await runCommand(['add', '--signals', 's_high', '--strategy', 'strat_high']);
    const firstId = first.output.match(/exp_\d+_[a-f0-9]{8}/)?.[0];
    const secondId = second.output.match(/exp_\d+_[a-f0-9]{8}/)?.[0];
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();

    const ctx = createContext();
    const secondFile = `${secondId!}.json`;
    const oldRecord = JSON.parse(readFileSync(join(ctx.provisionalDir, secondFile), 'utf-8')) as {
      confidence: number;
      last_confirmed: string;
    };
    oldRecord.confidence = 0.95;
    oldRecord.last_confirmed = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(join(ctx.provisionalDir, secondFile), `${JSON.stringify(oldRecord, null, 2)}\n`);

    const out = await runCommand(['export', '--min-confidence', '0.4']);
    const parsed = JSON.parse(out.output) as { experiences: Array<{ id: string }> };
    expect(parsed.experiences.every((item) => item.id !== secondId!)).toBe(true);
    expect(parsed.experiences.some((item) => item.id === firstId!)).toBe(true);
  });

  it('export --format json produces valid JSON with envelope', async () => {
    await runCommand(['add', '--signals', 'env_signal', '--strategy', 'env_strat']);
    const out = await runCommand(['export', '--format', 'json']);
    const parsed = JSON.parse(out.output) as {
      exported_at: string;
      filter: object;
      count: number;
      experiences: unknown[];
    };
    expect(typeof parsed.exported_at).toBe('string');
    expect(typeof parsed.filter).toBe('object');
    expect(typeof parsed.count).toBe('number');
    expect(Array.isArray(parsed.experiences)).toBe(true);
    expect(parsed.count).toBe(parsed.experiences.length);
  });

  it('export --promoted-only only includes promoted experiences', async () => {
    const addResult = await runCommand(['add', '--signals', 'promo_sig', '--strategy', 'promo_strat']);
    const expId = addResult.output.match(/exp_\d+_[a-f0-9]{8}/)?.[0];
    expect(expId).toBeTruthy();

    // Before promotion: promoted-only export should be empty
    const beforeOut = await runCommand(['export', '--promoted-only']);
    const before = JSON.parse(beforeOut.output) as { experiences: Array<{ id: string }> };
    expect(before.experiences.every((item) => item.id !== expId!)).toBe(true);

    // Promote the experience
    await runCommand(['promote', expId!, '--confirm']);

    // After promotion: promoted-only export should include it
    const afterOut = await runCommand(['export', '--promoted-only']);
    const after = JSON.parse(afterOut.output) as { experiences: Array<{ id: string }> };
    expect(after.experiences.some((item) => item.id === expId!)).toBe(true);
  });

  it('export --scope filters by scope', async () => {
    // Default scope from add is 'universal'
    await runCommand(['add', '--signals', 'scope_sig', '--strategy', 'scope_strat']);

    const universalOut = await runCommand(['export', '--scope', 'universal']);
    const universalParsed = JSON.parse(universalOut.output) as {
      experiences: Array<{ id: string; scope: string }>;
    };
    expect(universalParsed.experiences.every((item) => item.scope === 'universal')).toBe(true);
    expect(universalParsed.experiences.length).toBeGreaterThan(0);

    const projectOut = await runCommand(['export', '--scope', 'project']);
    const projectParsed = JSON.parse(projectOut.output) as {
      experiences: Array<{ scope: string }>;
    };
    expect(projectParsed.experiences.length).toBe(0);
  });

  it('export includes stats enrichment fields', async () => {
    await runCommand(['add', '--signals', 'stats_sig', '--strategy', 'stats_strat']);
    const out = await runCommand(['export']);
    const parsed = JSON.parse(out.output) as {
      experiences: Array<{
        id: string;
        signals: string[];
        strategy: { name: string; description: string };
        confidence: number;
        source_agent: string;
        scope: string;
        risk_level: string;
        stats: { ref_count: number; success_rate: number | null };
      }>;
    };
    expect(parsed.experiences.length).toBeGreaterThan(0);
    const exp = parsed.experiences[0]!;
    expect(Array.isArray(exp.signals)).toBe(true);
    expect(typeof exp.strategy.name).toBe('string');
    expect(typeof exp.confidence).toBe('number');
    expect(typeof exp.source_agent).toBe('string');
    expect(typeof exp.scope).toBe('string');
    expect(typeof exp.risk_level).toBe('string');
    expect(typeof exp.stats.ref_count).toBe('number');
    // success_rate is null when no outcomes recorded yet
    expect(exp.stats.success_rate === null || typeof exp.stats.success_rate === 'number').toBe(true);
  });
});
