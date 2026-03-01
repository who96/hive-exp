import type { Command } from 'commander';

export function registerPromote(program: Command): void {
  program
    .command('promote <exp_id>')
    .description('Promote an experience to the trusted zone (requires confirmation)')
    .option('--confirm', 'confirm promotion (required for actual promotion)')
    .action(() => {
      console.log('[stub] promote — will promote experience (requires --confirm)');
    });
}
