import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { createContext } from '../context.js';
import { findExperienceFile, writeExperienceFile, generateEventId } from '../utils.js';
import { type ExperienceArchivedPayload, type ExperienceRecord, type HiveEvent } from '@hive-exp/core';
import { readExperienceFile } from '../utils.js';
import { effectiveConfidence } from '@hive-exp/core';

export function registerArchive(program: Command): void {
  program
    .command('archive <exp_id>')
    .description('Archive an experience (soft delete)')
    .option('--reason <reason>', 'reason for archiving')
    .action(async (expId, options) => {
      const context = createContext();
      const id = String(expId);
      const filePath = findExperienceFile(context.dataDir, id);
      if (!filePath) {
        console.log(`Experience not found: ${id}`);
        process.exitCode = 1;
        return;
      }

      const reasonInput = (options.reason as string | undefined) ?? 'low_confidence';
      const validReasons = ['zero_ref', 'low_confidence', 'consecutive_fail'] as const;
      type ArchiveReason = typeof validReasons[number];
      const reason: ArchiveReason = validReasons.includes(reasonInput as ArchiveReason)
        ? (reasonInput as ArchiveReason)
        : 'low_confidence';

      const current = readExperienceFile(filePath) as ExperienceRecord;
      const archived = {
        ...current,
        archived: true,
        archived_reason: reason,
      };
      archived.signature = context.signer.sign(JSON.stringify({ ...archived, signature: '' }));

      const nextPath = join(context.archivedDir, `${id}.json`);
      if (existsSync(nextPath)) {
        unlinkSync(nextPath);
      }
      writeExperienceFile(nextPath, archived);
      unlinkSync(filePath);

      const payload: ExperienceArchivedPayload = {
        exp_id: id,
        reason,
      };
      const event: HiveEvent = {
        event_id: generateEventId(),
        type: 'experience.archived',
        timestamp: new Date().toISOString(),
        source_agent: 'cli',
        signature: context.signer.sign(JSON.stringify(payload)),
        payload,
      };
      await context.eventWriter.append(event);
      await context.projector.incrementalSync();
      const conf = effectiveConfidence(
        current.confidence,
        current.last_confirmed,
        current.decay_halflife_days,
      );
      console.log(`Archived ${id} (confidence ${conf}, reason: ${reason})`);
    });
}
