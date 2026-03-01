import type { Command } from 'commander';

export function registerQuery(program: Command): void {
  program
    .command('query')
    .description('Query experiences by signal, strategy, or scope')
    .option('--signal <signal>', 'filter by signal')
    .option('--strategy <name>', 'filter by strategy')
    .option('--scope <scope>', 'filter by scope')
    .option('--limit <n>', 'max results', '10')
    .action(() => {
      console.log('[stub] query — will search experiences');
    });
}
