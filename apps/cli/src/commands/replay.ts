import type { Command } from 'commander';

export function registerReplay(program: Command): void {
  program
    .command('replay')
    .description('Rebuild SQLite projection from event log')
    .option('--from <date>', 'replay from date')
    .option('--verbose', 'verbose output')
    .action(() => {
      console.log('[stub] replay — will rebuild projection from events');
    });
}
