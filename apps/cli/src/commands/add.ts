import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type ExperienceCreatedPayload,
  type ExperienceRecord,
  type HiveEvent,
  normalizeSignal,
  sanitizeSecurity,
  validateExperience,
} from '@hive-exp/core';
import { createContext } from '../context.js';
import type { Command as CommanderCommand } from 'commander';
import { generateEventId, generateExpId, writeExperienceFile } from '../utils.js';

export function registerAdd(program: CommanderCommand): void {
  program
    .command('add')
    .description('Add a new experience record interactively or from a YAML file')
    .option('--file <path>', 'YAML file path')
    .option('--signals <signals...>', 'signal tags')
    .option('--strategy <name>', 'strategy name')
    .option('--strategy-description <description>', 'strategy description')
    .action(async (options: {
      file?: string;
      signals?: string[];
      strategy?: string;
      strategyDescription?: string;
    }) => {
      const context = createContext();
      const now = new Date().toISOString();
      const deadlineDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const defaultDeadline = deadlineDate.toISOString();

      let record: ExperienceRecord;

      if (options.file) {
        const raw = JSON.parse(readFileSync(options.file, 'utf-8')) as Partial<ExperienceRecord>;
        const strategyName = raw.strategy?.name ?? options.strategy;

        if (!strategyName) {
          console.log('Missing required fields: --strategy');
          process.exitCode = 1;
          return;
        }

        const sanitized = sanitizeSecurity(
          options.strategyDescription ?? raw.strategy?.description ?? strategyName,
        ).clean;
        record = {
          id: raw.id ?? generateExpId(),
          type: 'experience',
          schema_version: raw.schema_version ?? '1.1.0',
          signals: (raw.signals ?? []).map((signal) => normalizeSignal(signal)),
          scope: raw.scope ?? 'universal',
          strategy: {
            name: strategyName,
            description: sanitized,
            category: raw.strategy?.category ?? 'repair',
          },
          outcome: {
            status: raw.outcome?.status ?? 'success',
            evidence: raw.outcome?.evidence,
            evidence_digest: raw.outcome?.evidence_digest,
            blast_radius: raw.outcome?.blast_radius,
          },
          confidence: raw.confidence ?? 0.5,
          source_agent: raw.source_agent ?? 'cli',
          signature: '',
          validated_by: raw.validated_by ?? null,
          promoted: raw.promoted ?? false,
          provisional: raw.provisional ?? true,
          provisional_deadline: raw.provisional_deadline ?? ((raw.provisional ?? true) ? defaultDeadline : null),
          supersedes: raw.supersedes ?? null,
          superseded_by: raw.superseded_by ?? null,
          risk_level: raw.risk_level ?? 'low',
          created: raw.created ?? now,
          last_confirmed: raw.last_confirmed ?? now,
          decay_halflife_days: raw.decay_halflife_days ?? 30,
          archived: raw.archived ?? false,
          archived_reason: raw.archived_reason ?? null,
        };
      } else {
        if (!options.signals || options.signals.length === 0 || !options.strategy) {
          console.log('Missing required fields: --signals and --strategy are required');
          process.exitCode = 1;
          return;
        }

        const sanitized = sanitizeSecurity(options.strategyDescription ?? options.strategy).clean;
        record = {
          id: generateExpId(),
          type: 'experience',
          schema_version: '1.1.0',
          signals: options.signals.map((signal) => normalizeSignal(signal)),
          scope: 'universal',
          strategy: {
            name: options.strategy,
            description: sanitized,
            category: 'repair',
          },
          outcome: {
            status: 'success',
          },
          confidence: 0.5,
          source_agent: 'cli',
          signature: '',
          validated_by: null,
          promoted: false,
          provisional: true,
          provisional_deadline: defaultDeadline,
          supersedes: null,
          superseded_by: null,
          risk_level: 'low',
          created: now,
          last_confirmed: now,
          decay_halflife_days: 30,
          archived: false,
          archived_reason: null,
        };
      }

      // Sign before validation (schema requires valid signature pattern)
      const unsigned = { ...record, signature: '' };
      record.signature = context.signer.sign(JSON.stringify(unsigned));

      const validation = validateExperience(record);
      if (!validation.valid) {
        console.log('Validation failed:');
        for (const err of validation.errors) {
          console.log(`- ${err}`);
        }
        process.exitCode = 1;
        return;
      }

      const target = join(context.provisionalDir, `${record.id}.json`);
      writeExperienceFile(target, record);

      const eventPayload: ExperienceCreatedPayload & {
        strategy_name?: string;
        strategy_category?: string;
      } = {
        exp_id: record.id,
        initial_confidence: record.confidence,
        strategy_name: record.strategy.name,
        strategy_category: record.strategy.category,
      };

      const event: HiveEvent = {
        event_id: generateEventId(),
        type: 'experience.created',
        timestamp: new Date().toISOString(),
        source_agent: 'cli',
        signature: context.signer.sign(JSON.stringify(eventPayload)),
        payload: eventPayload,
      };
      await context.eventWriter.append(event);
      await context.projector.incrementalSync();
      console.log(record.id);
    });
}
