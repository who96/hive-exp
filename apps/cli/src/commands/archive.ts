import type { Command } from 'commander';

export function registerArchive(program: Command): void {
  program
    .command('archive <exp_id>')
    .description('Archive an experience (soft delete)')
    .option('--reason <reason>', 'reason for archiving')
    .action(() => {
      console.log('[stub] archive — will archive experience');
    });
}
