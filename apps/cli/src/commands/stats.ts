import type { Command } from 'commander';

export function registerStats(program: Command): void {
  program
    .command('stats')
    .description('Show strategy statistics and experience health overview')
    .option(
      '--type <type>',
      'statistics type (overview|strategy_ranking|at_risk)',
      'overview',
    )
    .option('--format <format>', 'output format (table|json)', 'table')
    .action(() => {
      console.log('[stub] stats — will show statistics');
    });
}
