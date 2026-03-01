import type { Command } from 'commander';

export function registerAdd(program: Command): void {
  program
    .command('add')
    .description('Add a new experience record interactively or from a YAML file')
    .option('--file <path>', 'YAML file path')
    .option('--signals <signals...>', 'signal tags')
    .option('--strategy <name>', 'strategy name')
    .action(() => {
      console.log('[stub] add — will create experience record');
    });
}
