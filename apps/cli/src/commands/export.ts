import type { Command } from 'commander';

export function registerExport(program: Command): void {
  program
    .command('export')
    .description('Export experiences for RAG or external consumption')
    .option('--format <format>', 'output format (json|yaml)', 'json')
    .option('--min-confidence <n>', 'minimum confidence threshold', '0')
    .option('--output <path>', 'output file path')
    .action(() => {
      console.log('[stub] export — will export experiences');
    });
}
