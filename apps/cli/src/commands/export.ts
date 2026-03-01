import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import type { ExperienceRecord } from '@hive-exp/core';
import { createContext } from '../context.js';
import { effectiveConfidence } from '@hive-exp/core';

interface ExportedExperience {
  id: string;
  signals: string[];
  strategy: { name: string; description: string };
  confidence: number;
  source_agent: string;
  scope: string;
  risk_level: string;
  stats: { ref_count: number; success_rate: number | null };
}

interface ExportPayload {
  exported_at: string;
  filter: {
    min_confidence?: number;
    scope?: string;
    agent?: string;
    promoted_only?: boolean;
  };
  count: number;
  experiences: ExportedExperience[];
}

function loadRecords(
  provisionalDir: string,
  promotedDir: string,
  promotedOnly: boolean,
): ExperienceRecord[] {
  const load = (dir: string): ExperienceRecord[] =>
    readdirSync(dir)
      .filter((item) => item.endsWith('.json'))
      .map(
        (item) =>
          JSON.parse(readFileSync(join(dir, item), 'utf-8')) as ExperienceRecord,
      );

  if (promotedOnly) {
    return load(promotedDir);
  }
  return [...load(provisionalDir), ...load(promotedDir)];
}

export function registerExport(program: Command): void {
  program
    .command('export')
    .description('Export experiences for RAG or external consumption')
    .option('--format <format>', 'output format (json)', 'json')
    .option('--min-confidence <n>', 'minimum effective confidence threshold (with decay)', '0')
    .option('--scope <scope>', 'filter by scope (universal|language|project)')
    .option('--agent <name>', 'filter by source_agent')
    .option('--promoted-only', 'only export promoted experiences')
    .option('--output <path>', 'output file path')
    .action((options) => {
      const context = createContext();
      const threshold = Number.parseFloat(options.minConfidence ?? '0');
      const scopeFilter: string | undefined = options.scope;
      const agentFilter: string | undefined = options.agent;
      const promotedOnly: boolean = options.promotedOnly === true;

      const records = loadRecords(
        context.provisionalDir,
        context.promotedDir,
        promotedOnly,
      );

      const experiences: ExportedExperience[] = records
        .filter((record) => {
          const conf = effectiveConfidence(
            record.confidence,
            record.last_confirmed,
            record.decay_halflife_days,
          );
          if (conf < threshold) return false;
          if (scopeFilter && record.scope !== scopeFilter) return false;
          if (agentFilter && record.source_agent !== agentFilter) return false;
          return true;
        })
        .map((record) => {
          const conf = effectiveConfidence(
            record.confidence,
            record.last_confirmed,
            record.decay_halflife_days,
          );

          const expStats = context.aggregator.getExperienceStats(record.id);

          return {
            id: record.id,
            signals: record.signals,
            strategy: {
              name: record.strategy.name,
              description: record.strategy.description,
            },
            confidence: conf,
            source_agent: record.source_agent,
            scope: record.scope,
            risk_level: record.risk_level ?? 'low',
            stats: {
              ref_count: expStats?.ref_count ?? 0,
              success_rate: expStats?.success_rate ?? null,
            },
          };
        })
        .sort((a, b) => b.confidence - a.confidence);

      const filter: ExportPayload['filter'] = {};
      if (threshold > 0) filter.min_confidence = threshold;
      if (scopeFilter) filter.scope = scopeFilter;
      if (agentFilter) filter.agent = agentFilter;
      if (promotedOnly) filter.promoted_only = true;

      const payload: ExportPayload = {
        exported_at: new Date().toISOString(),
        filter,
        count: experiences.length,
        experiences,
      };

      const json = JSON.stringify(payload, null, 2);

      if (options.output) {
        writeFileSync(options.output, `${json}\n`);
      } else {
        console.log(json);
      }
    });
}
