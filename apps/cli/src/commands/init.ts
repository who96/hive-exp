import type { Command } from 'commander';

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
    .action(() => {
      console.log('[stub] init — will auto-detect agents and generate MCP config');
    });
}
