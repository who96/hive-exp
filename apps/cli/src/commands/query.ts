import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import type { ExperienceRecord } from '@hive-exp/core';
import { createContext } from '../context.js';
import { effectiveConfidence } from '@hive-exp/core';
import { formatTable } from '../utils.js';

interface QueryRecord extends ExperienceRecord {
  effective_confidence: number;
}

export function registerQuery(program: Command): void {
  program
    .command('query')
    .description('Query experiences by signal, strategy, or scope')
    .option('--signal <signal>', 'filter by signal')
    .option('--strategy <name>', 'filter by strategy')
    .option('--scope <scope>', 'filter by scope')
    .option('--limit <n>', 'max results', '10')
    .option('--format <format>', 'output format (table|json)')
    .action(async (options) => {
      const context = createContext();
      const readDirRecords = (dir: string): QueryRecord[] => {
        const entries = readdirSync(dir).filter((item) => item.endsWith('.json'));
        return entries
          .map((file) => JSON.parse(readFileSync(join(dir, file), 'utf-8')) as ExperienceRecord)
          .map((record) => ({
            ...record,
            effective_confidence: effectiveConfidence(
              record.confidence,
              record.last_confirmed,
              record.decay_halflife_days,
            ),
          }) as QueryRecord);
      };

      const records = [
        ...readDirRecords(context.provisionalDir),
        ...readDirRecords(context.promotedDir),
      ];

      const filtered = records
        .filter((record) =>
          !options.signal || record.signals.includes(options.signal))
        .filter((record) =>
          !options.strategy || record.strategy.name === options.strategy)
        .filter((record) => !options.scope || record.scope === options.scope)
        .sort((a, b) => {
          const aConfidence = (a as QueryRecord).effective_confidence;
          const bConfidence = (b as QueryRecord).effective_confidence;
          return bConfidence - aConfidence;
        })
        .slice(0, Number.parseInt(options.limit as string, 10));

      const asJson = options.format === 'json' || process.stdout.isTTY === false;
      if (asJson) {
        console.log(JSON.stringify(filtered, null, 2));
        return;
      }

      const headers = ['id', 'signals', 'strategy', 'confidence', 'scope'];
      const rows = filtered.map((record) => [
        record.id,
        record.signals.join(','),
        record.strategy.name,
        String((record as QueryRecord).effective_confidence.toFixed(4)),
        record.scope,
      ]);
      console.log(formatTable(headers, rows));
    });
}
