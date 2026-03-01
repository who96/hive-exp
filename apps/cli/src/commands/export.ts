import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import type { ExperienceRecord } from '@hive-exp/core';
import { createContext } from '../context.js';
import { effectiveConfidence } from '@hive-exp/core';

export function registerExport(program: Command): void {
  program
    .command('export')
    .description('Export experiences for RAG or external consumption')
    .option('--format <format>', 'output format (json|yaml)', 'json')
    .option('--min-confidence <n>', 'minimum confidence threshold', '0')
    .option('--output <path>', 'output file path')
    .action((options) => {
      const context = createContext();
      const threshold = Number.parseFloat(options.minConfidence ?? '0');
      const records = [
        ...readdirSync(context.provisionalDir)
          .filter((item) => item.endsWith('.json'))
          .map((item) => JSON.parse(readFileSync(join(context.provisionalDir, item), 'utf-8')) as ExperienceRecord),
        ...readdirSync(context.promotedDir)
          .filter((item) => item.endsWith('.json'))
          .map((item) => JSON.parse(readFileSync(join(context.promotedDir, item), 'utf-8')) as ExperienceRecord),
      ];

      const outputRecords = records.filter((record) => {
        const confidence = effectiveConfidence(
          record.confidence,
          record.last_confirmed,
          record.decay_halflife_days,
        );
        return confidence >= threshold;
      });

      const payload = JSON.stringify(outputRecords, null, 2);
      if (options.output) {
        writeFileSync(options.output, `${payload}\n`);
      } else if (options.format === 'yaml') {
        console.log('YAML output is not implemented; JSON emitted.');
        console.log(payload);
      } else {
        console.log(payload);
      }
    });
}
