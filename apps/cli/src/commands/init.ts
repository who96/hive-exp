import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Command } from 'commander';
import { ensureDataDir, resolveDataDir } from '../context.js';

interface AgentConfigTarget {
  key: string;
  name: string;
  path: string;
  type: 'json' | 'toml';
}

const MCP_PAYLOAD = { command: 'npx', args: ['-y', '@hive-exp/mcp'] };

function normalizeTomlMessage(name: string, configPath: string): void {
  console.log(`[TOML] ${name} at ${configPath}`);
  console.log('Add the following MCP server entry manually:');
  console.log('  [mcpServers.hive-exp]');
  console.log('  command = "npx"');
  console.log('  args = ["-y", "@hive-exp/mcp"]');
}

function loadJsonConfig(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) return {};
  try {
    const raw = readFileSync(configPath, 'utf-8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function buildConfigText(configPath: string): string {
  const raw = loadJsonConfig(configPath);
  const next: Record<string, unknown> = { ...raw };
  const servers = typeof next.mcpServers === 'object' && next.mcpServers !== null
    ? { ...(next.mcpServers as Record<string, unknown>) }
    : {};
  servers['hive-exp'] = MCP_PAYLOAD;
  next.mcpServers = servers;
  return JSON.stringify(next, null, 2);
}

function configureAgent(target: AgentConfigTarget, force: boolean): void {
  if (target.type === 'toml') {
    if (!force) {
      normalizeTomlMessage(target.name, target.path);
      return;
    }
    console.log(`TOML config detected at ${target.path}.`);
    normalizeTomlMessage(target.name, target.path);
    console.log('Manual update required in TOML file.');
    return;
  }

  const text = buildConfigText(target.path);
  console.log(`[MCP JSON] ${target.name} (${target.path})`);
  console.log(text);

  if (force) {
    mkdirSync(dirname(target.path), { recursive: true });
    writeFileSync(target.path, `${text}\n`);
    console.log(`Updated ${target.path}`);
  }
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description(
      'Initialize hive-exp in the current project. Auto-detects AI agents and generates MCP configuration.',
    )
    .option(
      '--agent <type>',
      'agent type (claude-code|codex|gemini-cli|antigravity|cursor)',
    )
    .option('--force', 'overwrite existing configuration')
    .action((options) => {
      const dataDir = resolveDataDir();
      ensureDataDir(dataDir);

      const targets: AgentConfigTarget[] = [
        {
          key: 'claude-code',
          name: 'Claude Code',
          path: join(homedir(), '.mcp.json'),
          type: 'json',
        },
        {
          key: 'codex',
          name: 'Codex',
          path: join(homedir(), '.codex', 'config.toml'),
          type: 'toml',
        },
        {
          key: 'gemini-cli',
          name: 'Gemini CLI',
          path: join(homedir(), '.gemini', 'mcp.json'),
          type: 'json',
        },
        {
          key: 'antigravity',
          name: 'Antigravity',
          path: join(homedir(), '.gemini', 'antigravity', 'mcp_config.json'),
          type: 'json',
        },
      ];

      const selected = options.agent
        ? targets.filter((target) => target.key === options.agent)
        : targets.filter((target) => existsSync(target.path));

      if (options.agent && selected.length === 0) {
        console.log(`No detected config for agent "${options.agent}"`);
        return;
      }

      if (selected.length === 0) {
        console.log('No agent config detected.');
        return;
      }

      if (!options.force) {
        console.log('The following MCP configuration will be applied:');
      }

      for (const target of selected) {
        configureAgent(target, options.force === true);
      }

      if (!options.force) {
        console.log('Run with --force to apply');
        return;
      }

      const fingerprint = createHash('sha256')
        .update(selected.map((target) => target.key).join(','))
        .digest('hex')
        .slice(0, 8);
      console.log(`Done (${fingerprint})`);
    });
}
