import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { createContext } from '../context.js';
import { formatTable } from '../utils.js';
import { effectiveConfidence } from '@hive-exp/core';
import { readFileSync } from 'node:fs';
import { type ExperienceRecord } from '@hive-exp/core';

interface RiskRecord extends ExperienceRecord {
  effective_confidence: number;
}

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
    .action(async (options) => {
      const context = createContext();

      const countJson = (dir: string): number =>
        readdirSync(dir).filter((item) => item.endsWith('.json')).length;
      const parseRecords = (dir: string): ExperienceRecord[] =>
        readdirSync(dir)
          .filter((item) => item.endsWith('.json'))
          .map((item) => JSON.parse(readFileSync(join(dir, item), 'utf-8')) as ExperienceRecord);

      if (options.type === 'overview') {
        const overview = {
          provisional: countJson(context.provisionalDir),
          promoted: countJson(context.promotedDir),
          archived: countJson(context.archivedDir),
        };

        if (options.format === 'json') {
          console.log(JSON.stringify(overview, null, 2));
          return;
        }

        const rows = [
          ['provisional', String(overview.provisional)],
          ['promoted', String(overview.promoted)],
          ['archived', String(overview.archived)],
        ];
        console.log(formatTable(['zone', 'count'], rows));
        return;
      }

      if (options.type === 'strategy_ranking') {
        const stats = context.aggregator.getAllStrategyStats({ sortBy: 'success_rate', order: 'desc' });
        if (options.format === 'json') {
          console.log(JSON.stringify(stats, null, 2));
          return;
        }

        const headers = ['strategy', 'category', 'total', 'refs', 'outcomes', 'success_rate'];
        const rows = stats.map((entry) => [
          entry.strategy_name,
          entry.strategy_category ?? '',
          String(entry.total_experiences),
          String(entry.total_refs),
          String(entry.total_outcomes),
          String(entry.success_rate ?? 0),
        ]);
        console.log(formatTable(headers, rows));
        return;
      }

      const all = [
        ...parseRecords(context.provisionalDir),
        ...parseRecords(context.promotedDir),
        ...parseRecords(context.archivedDir),
      ];
      const atRisk: RiskRecord[] = all
        .map((record) => ({
          ...record,
          effective_confidence: effectiveConfidence(
            record.confidence,
            record.last_confirmed,
            record.decay_halflife_days,
          ),
        }))
        .filter((record) => record.effective_confidence < 0.3);

      if (options.format === 'json') {
        console.log(JSON.stringify(atRisk, null, 2));
        return;
      }

      const rows = atRisk.map((record) => [
        record.id,
        record.strategy.name,
        String(record.effective_confidence.toFixed(4)),
        record.scope,
      ]);
      console.log(formatTable(['id', 'strategy', 'confidence', 'scope'], rows));
    });
}
