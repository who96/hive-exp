import type { Command } from 'commander';

export function registerValidate(program: Command): void {
  program
    .command('validate <path>')
    .description('Validate an experience YAML file against the schema')
    .action(() => {
      console.log('[stub] validate — will validate experience file');
    });
}
