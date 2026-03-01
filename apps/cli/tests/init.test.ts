import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let mockedHome = '';
let mockedDataDir = '';

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => mockedHome };
});

vi.mock('../src/context.js', () => ({
  resolveDataDir: () => mockedDataDir,
  ensureDataDir: (root: string) => {
    const dirs = [
      join(root, 'experiences', 'provisional'),
      join(root, 'experiences', 'promoted'),
      join(root, 'experiences', 'archived'),
      join(root, 'events'),
      join(root, 'db'),
      join(root, 'graph'),
    ];
    for (const d of dirs) {
      mkdirSync(d, { recursive: true });
    }
  },
}));

interface RunResult {
  output: string;
}

async function runInit(
  args: string[],
  home: string,
  cwd: string,
  dataDir: string,
): Promise<RunResult> {
  const originalCwd = process.cwd();
  const originalLog = console.log;
  const output: string[] = [];

  process.chdir(cwd);
  mockedHome = home;
  mockedDataDir = dataDir;

  const { registerInit } = await import('../src/commands/init.js');
  const program = new Command();
  registerInit(program);
  program.exitOverride();

  console.log = (...items: unknown[]) => {
    output.push(items.map(String).join(' '));
  };

  try {
    await program.parseAsync(['node', 'hive-exp', 'init', ...args], { from: 'node' });
  } catch (error) {
    output.push(String(error));
  } finally {
    console.log = originalLog;
    process.chdir(originalCwd);
  }

  return { output: output.join('\n') };
}

describe('init command', () => {
  let tempRoot: string;
  let homeDir: string;
  let cwdDir: string;
  let dataDir: string;
  let originalHiveHome: string | undefined;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'hive-exp-init-'));
    homeDir = join(tempRoot, 'home');
    cwdDir = join(tempRoot, 'project');
    dataDir = join(tempRoot, 'data');
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(cwdDir, { recursive: true });
    originalHiveHome = process.env.HIVE_EXP_HOME;
    process.env.HIVE_EXP_HOME = dataDir;
  });

  afterEach(() => {
    if (originalHiveHome === undefined) {
      delete process.env.HIVE_EXP_HOME;
    } else {
      process.env.HIVE_EXP_HOME = originalHiveHome;
    }
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('should detect claude-code when ~/.mcp.json exists', async () => {
    writeFileSync(join(homeDir, '.mcp.json'), '{}');
    const { output } = await runInit([], homeDir, cwdDir, dataDir);
    expect(output).toContain('Claude Code');
    expect(output).toContain('would configure');
  });

  it('should detect codex when ~/.codex/ directory exists', async () => {
    mkdirSync(join(homeDir, '.codex'), { recursive: true });
    const { output } = await runInit([], homeDir, cwdDir, dataDir);
    expect(output).toContain('Codex');
    expect(output).toContain('would configure');
  });

  it('should detect gemini-cli when ~/.gemini/mcp.json exists', async () => {
    mkdirSync(join(homeDir, '.gemini'), { recursive: true });
    writeFileSync(join(homeDir, '.gemini', 'mcp.json'), '{}');
    const { output } = await runInit([], homeDir, cwdDir, dataDir);
    expect(output).toContain('Gemini CLI');
    expect(output).toContain('would configure');
  });

  it('should detect cursor when .cursor/ exists in CWD', async () => {
    mkdirSync(join(cwdDir, '.cursor'), { recursive: true });
    const { output } = await runInit([], homeDir, cwdDir, dataDir);
    expect(output).toContain('Cursor');
    expect(output).toContain('would configure');
  });

  it('should report no agents when none detected', async () => {
    const { output } = await runInit([], homeDir, cwdDir, dataDir);
    expect(output).toContain('No agent configurations detected.');
  });

  it('should filter to single agent with --agent flag', async () => {
    writeFileSync(join(homeDir, '.mcp.json'), '{}');
    mkdirSync(join(homeDir, '.codex'), { recursive: true });
    const { output } = await runInit(['--agent', 'claude-code'], homeDir, cwdDir, dataDir);
    expect(output).toContain('Claude Code');
    expect(output).not.toContain('Codex');
  });

  it('should merge JSON config without overwriting existing keys with --force', async () => {
    const target = join(homeDir, '.mcp.json');
    const initial = {
      mcpServers: {
        existing: { command: 'node', args: ['-v'] },
      },
    };
    writeFileSync(target, `${JSON.stringify(initial, null, 2)}\n`);

    const { output } = await runInit(['--force', '--agent', 'claude-code'], homeDir, cwdDir, dataDir);
    const merged = JSON.parse(readFileSync(target, 'utf-8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };

    expect(output).toContain('Claude Code: configured');
    expect(merged.mcpServers).toHaveProperty('existing');
    expect(merged.mcpServers).toHaveProperty('hive-exp');
    expect(merged.mcpServers['hive-exp']).toEqual({
      command: 'npx',
      args: ['-y', '@hive-exp/mcp'],
    });
  });

  it('should not overwrite existing hive-exp entry', async () => {
    const target = join(homeDir, '.mcp.json');
    const initial = {
      mcpServers: {
        'hive-exp': { command: 'existing', args: ['legacy'] },
      },
    };
    writeFileSync(target, `${JSON.stringify(initial, null, 2)}\n`);

    const { output } = await runInit(['--force', '--agent', 'claude-code'], homeDir, cwdDir, dataDir);
    const after = JSON.parse(readFileSync(target, 'utf-8')) as {
      mcpServers: Record<string, { command: string }>;
    };

    expect(output).toContain('already configured');
    expect(after.mcpServers['hive-exp'].command).toBe('existing');
  });

  it('should append TOML section for codex with --force', async () => {
    mkdirSync(join(homeDir, '.codex'), { recursive: true });
    const target = join(homeDir, '.codex', 'config.toml');
    writeFileSync(target, 'existing = true\n');

    const { output } = await runInit(['--force', '--agent', 'codex'], homeDir, cwdDir, dataDir);
    const content = readFileSync(target, 'utf-8');

    expect(output).toContain('Codex: configured');
    expect(content).toContain('[mcp_servers.hive-exp]');
    expect(content).toContain('command = "npx"');
  });

  it('should not duplicate TOML section if already present', async () => {
    mkdirSync(join(homeDir, '.codex'), { recursive: true });
    const target = join(homeDir, '.codex', 'config.toml');
    const existing = '[mcp_servers.hive-exp]\ntype = "stdio"\ncommand = "npx"\nargs = ["-y", "@hive-exp/mcp"]\n';
    writeFileSync(target, existing);

    const { output } = await runInit(['--force', '--agent', 'codex'], homeDir, cwdDir, dataDir);
    const content = readFileSync(target, 'utf-8');

    expect(output).toContain('already configured');
    expect(content.match(/\[mcp_servers\.hive-exp\]/g)?.length).toBe(1);
  });

  it('should create hive-exp data directory', async () => {
    const customDataDir = join(tempRoot, 'hive-data');
    await runInit(['--agent', 'claude-code'], homeDir, cwdDir, customDataDir);
    expect(existsSync(join(customDataDir, 'experiences', 'provisional'))).toBe(true);
    expect(existsSync(join(customDataDir, 'experiences', 'promoted'))).toBe(true);
  });
});
