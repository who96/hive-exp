import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Command } from 'commander';
import { ensureDataDir, resolveDataDir } from '../context.js';

interface AgentConfigTarget {
  key: string;
  name: string;
  configPath: string;
  detectPath: string;
  type: 'json' | 'json-flat' | 'toml';
}

const MCP_PAYLOAD = { command: 'npx', args: ['-y', '@hive-exp/mcp'] };
const MCP_PAYLOAD_GEMINI = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@hive-exp/mcp'],
  env: {},
};
const TOML_BLOCK = `\n[mcp_servers.hive-exp]\ntype = "stdio"\ncommand = "npx"\nargs = ["-y", "@hive-exp/mcp"]\n`;

const color = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

function buildTargets(home: string, cwd: string): AgentConfigTarget[] {
  return [
    {
      key: 'claude-code',
      name: 'Claude Code',
      configPath: join(home, '.mcp.json'),
      detectPath: join(home, '.mcp.json'),
      type: 'json',
    },
    {
      key: 'codex',
      name: 'Codex',
      configPath: join(home, '.codex', 'config.toml'),
      detectPath: join(home, '.codex'),
      type: 'toml',
    },
    {
      key: 'gemini-cli',
      name: 'Gemini CLI',
      configPath: join(home, '.gemini', 'mcp.json'),
      detectPath: join(home, '.gemini', 'mcp.json'),
      type: 'json',
    },
    {
      key: 'antigravity',
      name: 'Antigravity',
      configPath: join(home, '.gemini', 'antigravity', 'mcp_config.json'),
      detectPath: join(home, '.gemini', 'antigravity'),
      type: 'json',
    },
    {
      key: 'cursor',
      name: 'Cursor',
      configPath: join(cwd, '.cursor', 'mcp.json'),
      detectPath: join(cwd, '.cursor'),
      type: 'json-flat',
    },
    {
      key: 'windsurf',
      name: 'Windsurf',
      configPath: join(cwd, '.windsurf', 'mcp.json'),
      detectPath: join(cwd, '.windsurf'),
      type: 'json-flat',
    },
  ];
}

type JsonValue = Record<string, unknown>;

function loadJsonConfig(configPath: string): JsonValue {
  if (!existsSync(configPath)) return {};
  try {
    const raw = readFileSync(configPath, 'utf-8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as JsonValue) : {};
  } catch {
    return {};
  }
}

function hasExistingHiveExp(config: JsonValue, type: 'json' | 'json-flat'): boolean {
  if (type === 'json') {
    return (
      typeof config.mcpServers === 'object' &&
      config.mcpServers !== null &&
      typeof (config.mcpServers as JsonValue)['hive-exp'] === 'object'
    );
  }

  return typeof config['hive-exp'] === 'object';
}

function hasTomlSection(content: string): boolean {
  return /^\[mcp_servers\.hive-exp\]/m.test(content);
}

function appendTomlConfig(configPath: string): void {
  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '';
  if (hasTomlSection(existing)) return;

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${existing}${TOML_BLOCK}`);
}

function getMcpPayload(type: string): Record<string, unknown> {
  return type === 'gemini-cli' ? MCP_PAYLOAD_GEMINI : MCP_PAYLOAD;
}

function configureAgent(target: AgentConfigTarget, force: boolean): { configured: boolean; alreadyConfigured: boolean } {
  if (target.type === 'toml') {
    const existing = existsSync(target.configPath) ? readFileSync(target.configPath, 'utf-8') : '';
    const alreadyConfigured = hasTomlSection(existing);
    if (alreadyConfigured) {
      console.log(color.yellow(`\u2298 ${target.name}: already configured`));
      return { configured: false, alreadyConfigured: true };
    }

    if (force) {
      appendTomlConfig(target.configPath);
      console.log(color.green(`\u2713 ${target.name}: configured (${target.configPath})`));
      return { configured: true, alreadyConfigured: false };
    }

    console.log(color.cyan(`\u2192 ${target.name}: would configure (${target.configPath})`));
    return { configured: false, alreadyConfigured: false };
  }

  const config = loadJsonConfig(target.configPath);
  const alreadyConfigured = hasExistingHiveExp(config, target.type);
  if (alreadyConfigured) {
    console.log(color.yellow(`\u2298 ${target.name}: already configured`));
    return { configured: false, alreadyConfigured: true };
  }

  if (!force) {
    console.log(color.cyan(`\u2192 ${target.name}: would configure (${target.configPath})`));
    return { configured: false, alreadyConfigured: false };
  }

  const next = { ...(config ?? {}) } as JsonValue;
  if (target.type === 'json') {
    const servers =
      typeof config.mcpServers === 'object' && config.mcpServers !== null
        ? { ...(config.mcpServers as JsonValue) }
        : {};
    servers['hive-exp'] = getMcpPayload(target.key);
    next.mcpServers = servers;
  } else {
    next['hive-exp'] = getMcpPayload(target.key);
  }

  mkdirSync(dirname(target.configPath), { recursive: true });
  writeFileSync(target.configPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(color.green(`\u2713 ${target.name}: configured (${target.configPath})`));
  return { configured: true, alreadyConfigured: false };
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description(
      'Initialize hive-exp in the current project. Auto-detects AI agents and generates MCP configuration.',
    )
    .option(
      '--agent <type>',
      'agent type (claude-code|codex|gemini-cli|antigravity|cursor|windsurf)',
    )
    .option('--force', 'overwrite existing configuration')
    .action((options) => {
      const dataDir = resolveDataDir();
      ensureDataDir(dataDir);
      console.log(color.bold('hive-exp init — configuring AI agent integrations'));

      const targets = buildTargets(homedir(), process.cwd());
      const allKeys = targets.map((target) => target.key);
      if (options.agent && !allKeys.includes(options.agent)) {
        console.log(color.yellow(`Unknown agent "${options.agent}"`));
        return;
      }

      const selected = options.agent
        ? targets.filter((target) => target.key === options.agent)
        : targets.filter((target) => existsSync(target.detectPath));

      if (selected.length === 0) {
        console.log('No agent configurations detected.');
        console.log(color.dim('Run with --force to apply changes'));
        return;
      }

      let configuredCount = 0;
      for (const target of selected) {
        const { configured } = configureAgent(target, options.force === true);
        if (configured) {
          configuredCount += 1;
        }
      }

      if (!options.force) {
        console.log(color.dim('Run with --force to apply changes'));
        return;
      }

      console.log(color.green(`Done. ${configuredCount} agent(s) configured.`));
      const fingerprint = createHash('sha256')
        .update(selected.map((target) => target.key).join(','))
        .digest('hex');
      console.log(color.dim(`Fingerprint: ${fingerprint}`));
    });
}
