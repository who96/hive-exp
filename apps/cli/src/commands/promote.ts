import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { createContext } from '../context.js';
import { findExperienceFile, readExperienceFile, writeExperienceFile, generateEventId } from '../utils.js';
import {
  effectiveConfidence,
  type ExperienceRecord,
  type HiveEvent,
  type ExperiencePromotedPayload,
} from '@hive-exp/core';

export function registerPromote(program: Command): void {
  program
    .command('promote <exp_id>')
    .description('Promote an experience to the trusted zone (requires confirmation)')
    .option('--confirm', 'confirm promotion (required for actual promotion)')
    .action(async (expId, options: { confirm?: boolean }) => {
      const context = createContext();
      const id = String(expId);
      const filePath = findExperienceFile(context.dataDir, id);
      if (!filePath) {
        console.log(`Experience not found: ${id}`);
        process.exitCode = 1;
        return;
      }

      const record = readExperienceFile(filePath) as ExperienceRecord;
      const conf = effectiveConfidence(
        record.confidence,
        record.last_confirmed,
        record.decay_halflife_days,
      );

      if (!options.confirm) {
        console.log(`id: ${record.id}`);
        console.log(`signals: ${record.signals.join(',')}`);
        console.log(`strategy: ${record.strategy.name}`);
        console.log(`confidence: ${conf}`);
        console.log('Run with --confirm to promote');
        return;
      }

      const nextFile = join(context.promotedDir, `${record.id}.json`);
      const next = {
        ...record,
        provisional: false,
        promoted: true,
        provisional_deadline: null,
      };
      next.signature = context.signer.sign(JSON.stringify({ ...next, signature: '' }));
      if (existsSync(nextFile)) {
        unlinkSync(nextFile);
      }
      writeExperienceFile(nextFile, next);
      unlinkSync(filePath);

      const payload: ExperiencePromotedPayload = {
        exp_id: record.id,
        promoted_by: 'human',
      };
      const event: HiveEvent = {
        event_id: generateEventId(),
        type: 'experience.promoted',
        timestamp: new Date().toISOString(),
        source_agent: 'cli',
        signature: context.signer.sign(JSON.stringify(payload)),
        payload,
      };
      await context.eventWriter.append(event);
      await context.projector.incrementalSync();
      console.log(`Promoted ${record.id}`);
    });
}
