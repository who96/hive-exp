import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { computeDecay } from './stats/decay.js';
import { EventWriter } from './events/writer.js';
import { EventProjector } from './events/projector.js';
import { resolveConfig } from './config.js';
import { detectDuplicates } from './dedup.js';
import { executeSupersedesSync } from './supersede.js';
import type {
  ExperienceRecord,
  HiveEvent,
  ExperienceArchivedPayload,
  ConfidenceDecayedPayload,
} from './types/index.js';

export interface LifecycleOptions {
  dataDir: string;
  halflifeDays?: number;         // default: 30
  archiveThreshold?: number;     // confidence below this -> archive candidate (default: 0.1)
  zeroRefDays?: number;          // days with zero references -> archive (default: 30)
  consecutiveFailLimit?: number; // consecutive failures -> archive (default: 3)
  /** Override current time for deterministic testing. */
  now?: Date;
}

export interface LifecycleResult {
  decayed: number;
  superseded: number;
  archived: number;
  reasons: Array<{
    exp_id: string;
    reason: 'low_confidence' | 'zero_ref' | 'consecutive_fail' | 'superseded';
  }>;
}

type ArchiveReason = 'low_confidence' | 'zero_ref' | 'consecutive_fail' | 'superseded';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function generateEventId(): string {
  return `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function readJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Scan a directory for .json files and return their paths.
 * Returns empty array if the directory doesn't exist.
 */
function listJsonFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(dir, name));
}

export class LifecycleManager {
  private readonly dataDir: string;
  private readonly halflifeDays: number;
  private readonly archiveThreshold: number;
  private readonly zeroRefDays: number;
  private readonly consecutiveFailLimit: number;
  private readonly now: Date;

  constructor(options: LifecycleOptions) {
    this.dataDir = options.dataDir;
    this.halflifeDays = options.halflifeDays ?? 30;
    this.archiveThreshold = options.archiveThreshold ?? 0.1;
    this.zeroRefDays = options.zeroRefDays ?? 30;
    this.consecutiveFailLimit = options.consecutiveFailLimit ?? 3;
    this.now = options.now ?? new Date();
  }

  run(): LifecycleResult {
    const provisionalDir = path.join(this.dataDir, 'experiences', 'provisional');
    const promotedDir = path.join(this.dataDir, 'experiences', 'promoted');
    const archivedDir = path.join(this.dataDir, 'experiences', 'archived');
    const eventsDir = path.join(this.dataDir, 'events');
    const dbPath = path.join(this.dataDir, 'hive-exp.db');

    // Ensure archived dir exists
    fs.mkdirSync(archivedDir, { recursive: true });

    // Collect all experience files from provisional + promoted
    const expFiles = [
      ...listJsonFiles(provisionalDir).map((f) => ({ path: f, dir: provisionalDir })),
      ...listJsonFiles(promotedDir).map((f) => ({ path: f, dir: promotedDir })),
    ];

    const writer = new EventWriter({ eventsDir });
    const projector = new EventProjector({ dbPath, eventsDir });
    projector.initialize();

    // Read outcome events for consecutive-fail detection
    const outcomesByExp = this.loadOutcomesByExp(eventsDir);

    // Sync projector before we query stats
    try {
      // Use rebuild for a clean read of experience_stats
      projector.rebuild();
    } catch {
      // If rebuild fails (e.g., no events yet), initialize is enough
    }

    let decayed = 0;
    let superseded = 0;
    const archiveCandidates: Array<{
      exp_id: string;
      reason: ArchiveReason;
      filePath: string;
      record: ExperienceRecord;
    }> = [];

    const decayedExpIds: string[] = [];
    const recordsForDedup: ExperienceRecord[] = [];

    for (const { path: filePath } of expFiles) {
      let record: ExperienceRecord;
      try {
        record = readJsonFile<ExperienceRecord>(filePath);
      } catch {
        continue; // skip unreadable files
      }

      // Skip already archived records
      if (record.archived) {
        continue;
      }

      // --- Step 1: Confidence Decay ---
      const effective = computeDecay(
        record.confidence,
        record.last_confirmed,
        this.now,
        this.halflifeDays,
      );
      const delta = Math.abs(effective - record.confidence);
      if (delta > 0.01) {
        record.confidence = effective;
        writeJsonFile(filePath, record);
        decayedExpIds.push(record.id);
        decayed++;
      }

      // --- Step 2: Auto-Archival Rules ---
      let archiveReason: ArchiveReason | null = null;

      if (effective < this.archiveThreshold) {
        archiveReason = 'low_confidence';
      } else if (this.checkZeroRef(record, projector)) {
        archiveReason = 'zero_ref';
      } else if (this.checkConsecutiveFail(record.id, outcomesByExp)) {
        archiveReason = 'consecutive_fail';
      }

      if (archiveReason) {
        archiveCandidates.push({
          exp_id: record.id,
          reason: archiveReason,
          filePath,
          record,
        });
        continue;
      }

      recordsForDedup.push(record);
    }

    // Emit confidence.decayed event (batch)
    if (decayedExpIds.length > 0) {
      const decayEvent: HiveEvent<ConfidenceDecayedPayload> = {
        event_id: generateEventId(),
        type: 'confidence.decayed',
        timestamp: this.now.toISOString(),
        source_agent: 'lifecycle-manager',
        signature: 'system:lifecycle',
        payload: {
          affected_exp_ids: decayedExpIds,
          decay_factor: Math.pow(0.5, 1 / this.halflifeDays),
        },
      };
      this.appendEventSync(writer, decayEvent);
    }

    // --- Step 2.5: Dedup ---
    const config = resolveConfig(this.dataDir);
    const supersededIds = new Set<string>();
    if (config.dedupEnabled) {
      const dedupActions = detectDuplicates(recordsForDedup);
      if (dedupActions.length > 0) {
        const result = executeSupersedesSync(dedupActions, {
          dataDir: this.dataDir,
          signer: {
            sign: () => 'system:lifecycle',
            verify: () => true,
          },
          sourceAgent: 'lifecycle-manager',
        });
        superseded = result.superseded;
        for (const applied of result.actions) {
          supersededIds.add(applied.old_exp_id);
        }
      }
    }

    // --- Step 3: Archive ---
    const reasons: LifecycleResult['reasons'] = [];
    for (const candidate of archiveCandidates) {
      const { exp_id, reason, filePath, record } = candidate;
      if (supersededIds.has(exp_id) || !fs.existsSync(filePath)) {
        continue;
      }

      // Update record
      record.archived = true;
      record.archived_reason = reason;

      // Move file to archived/
      const destPath = path.join(archivedDir, path.basename(filePath));
      writeJsonFile(destPath, record);
      fs.unlinkSync(filePath);

      // Emit experience.archived event
      const archiveEvent: HiveEvent<ExperienceArchivedPayload> = {
        event_id: generateEventId(),
        type: 'experience.archived',
        timestamp: this.now.toISOString(),
        source_agent: 'lifecycle-manager',
        signature: 'system:lifecycle',
        payload: { exp_id, reason },
      };
      this.appendEventSync(writer, archiveEvent);

      reasons.push({ exp_id, reason });
    }

    // Sync projector with new events
    projector.rebuild();
    projector.close();

    return {
      decayed,
      superseded,
      archived: reasons.length,
      reasons,
    };
  }

  private checkZeroRef(
    record: ExperienceRecord,
    projector: EventProjector,
  ): boolean {
    const createdDate = new Date(record.created);
    const daysSinceCreation = (this.now.getTime() - createdDate.getTime()) / MS_PER_DAY;

    // Experience must be older than zeroRefDays
    if (daysSinceCreation < this.zeroRefDays) {
      return false;
    }

    // Query stats from the projector's DB
    const db = (projector as unknown as { db: import('better-sqlite3').Database }).db;
    const row = db.prepare(
      'SELECT ref_count, last_used FROM experience_stats WHERE exp_id = ?',
    ).get(record.id) as { ref_count: number; last_used: string | null } | undefined;

    // No stats at all means zero references
    if (!row) {
      return true;
    }

    if (row.ref_count === 0) {
      return true;
    }

    // Has references but check if last_used is > zeroRefDays ago
    if (row.last_used) {
      const lastUsedDate = new Date(row.last_used);
      const daysSinceLastUse = (this.now.getTime() - lastUsedDate.getTime()) / MS_PER_DAY;
      if (daysSinceLastUse >= this.zeroRefDays) {
        return true;
      }
    }

    return false;
  }

  private checkConsecutiveFail(
    expId: string,
    outcomesByExp: Map<string, string[]>,
  ): boolean {
    const outcomes = outcomesByExp.get(expId);
    if (!outcomes || outcomes.length < this.consecutiveFailLimit) {
      return false;
    }

    // Check last N outcomes
    const lastN = outcomes.slice(-this.consecutiveFailLimit);
    return lastN.every((result) => result === 'failed');
  }

  /**
   * Read all outcome events from event files and group by exp_id.
   * Returns a map of exp_id -> ordered list of outcome results.
   */
  private loadOutcomesByExp(eventsDir: string): Map<string, string[]> {
    const result = new Map<string, string[]>();

    let entries: string[];
    try {
      entries = fs.readdirSync(eventsDir);
    } catch {
      return result;
    }

    const eventFileRe = /^events-(\d{4})-(\d{2})\.jsonl$/;
    const files = entries
      .filter((name) => eventFileRe.test(name))
      .sort()
      .map((name) => path.join(eventsDir, name));

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as HiveEvent;
          if (event.type === 'experience.outcome_recorded') {
            const payload = event.payload as { exp_id: string; result: string };
            if (!result.has(payload.exp_id)) {
              result.set(payload.exp_id, []);
            }
            result.get(payload.exp_id)!.push(payload.result);
          }
        } catch {
          // skip malformed
        }
      }
    }

    return result;
  }

  private appendEventSync(writer: EventWriter, event: HiveEvent): void {
    // EventWriter.append is async, but we need sync for lifecycle.
    // Write directly to the events file.
    const eventsDir = (writer as unknown as { eventsDir: string }).eventsDir;
    fs.mkdirSync(eventsDir, { recursive: true });

    const now = new Date();
    const yyyy = now.getFullYear().toString();
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const filePath = path.join(eventsDir, `events-${yyyy}-${mm}.jsonl`);
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(filePath, line, { flag: 'a' });
  }
}
