import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { EventWriter } from './events/writer.js';
import type { SupersedeAction } from './dedup.js';
import type {
  ExperienceRecord,
  ExperienceSupersededPayload,
  HiveEvent,
  SignerInterface,
} from './types/index.js';

export interface SupersedeOptions {
  dataDir: string;
  signer: SignerInterface;
  sourceAgent?: string;
}

export interface SupersedeResult {
  superseded: number;
  actions: ExperienceSupersededPayload[];
}

function generateEventId(): string {
  return `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function getEventsFilePath(eventsDir: string, now: Date): string {
  const yyyy = now.getFullYear().toString();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return path.join(eventsDir, `events-${yyyy}-${mm}.jsonl`);
}

function readJsonFileSync<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

function writeJsonFileSync(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function findExperiencePathSync(
  provisionalDir: string,
  promotedDir: string,
  expId: string,
): string | null {
  const provisionalPath = path.join(provisionalDir, `${expId}.json`);
  if (fs.existsSync(provisionalPath)) {
    return provisionalPath;
  }
  const promotedPath = path.join(promotedDir, `${expId}.json`);
  if (fs.existsSync(promotedPath)) {
    return promotedPath;
  }
  return null;
}

async function findExperiencePath(
  provisionalDir: string,
  promotedDir: string,
  expId: string,
): Promise<string | null> {
  const provisionalPath = path.join(provisionalDir, `${expId}.json`);
  try {
    await fsp.access(provisionalPath, fs.constants.F_OK);
    return provisionalPath;
  } catch {
    // continue
  }

  const promotedPath = path.join(promotedDir, `${expId}.json`);
  try {
    await fsp.access(promotedPath, fs.constants.F_OK);
    return promotedPath;
  } catch {
    return null;
  }
}

function buildSupersededEvent(
  payload: ExperienceSupersededPayload,
  signer: SignerInterface,
  sourceAgent: string,
): HiveEvent<ExperienceSupersededPayload> {
  return {
    event_id: generateEventId(),
    type: 'experience.superseded',
    timestamp: new Date().toISOString(),
    source_agent: sourceAgent,
    signature: signer.sign(JSON.stringify(payload)),
    payload,
  };
}

function appendEventSync(eventsDir: string, event: HiveEvent): void {
  fs.mkdirSync(eventsDir, { recursive: true });
  const filePath = getEventsFilePath(eventsDir, new Date(event.timestamp));
  fs.appendFileSync(filePath, JSON.stringify(event) + '\n', { flag: 'a' });
}

export function executeSupersedesSync(
  actions: SupersedeAction[],
  options: SupersedeOptions,
): SupersedeResult {
  const experiencesDir = path.join(options.dataDir, 'experiences');
  const provisionalDir = path.join(experiencesDir, 'provisional');
  const promotedDir = path.join(experiencesDir, 'promoted');
  const supersededDir = path.join(experiencesDir, 'superseded');
  const eventsDir = path.join(options.dataDir, 'events');
  const sourceAgent = options.sourceAgent ?? 'lifecycle-manager';

  if (actions.length === 0) {
    return { superseded: 0, actions: [] };
  }

  fs.mkdirSync(supersededDir, { recursive: true });
  const applied: ExperienceSupersededPayload[] = [];

  for (const action of actions) {
    const loserPath = findExperiencePathSync(provisionalDir, promotedDir, action.loser_id);
    if (!loserPath) {
      continue;
    }

    let loserRecord: ExperienceRecord;
    try {
      loserRecord = readJsonFileSync<ExperienceRecord>(loserPath);
    } catch {
      continue;
    }

    loserRecord.superseded_by = action.winner_id;
    loserRecord.archived = true;
    loserRecord.archived_reason = 'superseded';
    const supersededPath = path.join(supersededDir, `${action.loser_id}.json`);
    writeJsonFileSync(supersededPath, loserRecord);

    try {
      fs.unlinkSync(loserPath);
    } catch (error: unknown) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    }

    const winnerPath = findExperiencePathSync(provisionalDir, promotedDir, action.winner_id);
    if (winnerPath) {
      try {
        const winnerRecord = readJsonFileSync<ExperienceRecord>(winnerPath);
        winnerRecord.supersedes = action.loser_id;
        writeJsonFileSync(winnerPath, winnerRecord);
      } catch {
        // keep going: loser move + event are the source of truth
      }
    }

    const payload: ExperienceSupersededPayload = {
      old_exp_id: action.loser_id,
      new_exp_id: action.winner_id,
      reason: action.reason,
      auto_superseded: true,
    };
    const event = buildSupersededEvent(payload, options.signer, sourceAgent);
    appendEventSync(eventsDir, event);
    applied.push(payload);
  }

  return {
    superseded: applied.length,
    actions: applied,
  };
}

export async function executeSupersedes(
  actions: SupersedeAction[],
  options: SupersedeOptions,
): Promise<SupersedeResult> {
  const experiencesDir = path.join(options.dataDir, 'experiences');
  const provisionalDir = path.join(experiencesDir, 'provisional');
  const promotedDir = path.join(experiencesDir, 'promoted');
  const supersededDir = path.join(experiencesDir, 'superseded');
  const eventsDir = path.join(options.dataDir, 'events');
  const sourceAgent = options.sourceAgent ?? 'mcp-record';

  if (actions.length === 0) {
    return { superseded: 0, actions: [] };
  }

  await fsp.mkdir(supersededDir, { recursive: true });
  await fsp.mkdir(eventsDir, { recursive: true });
  const writer = new EventWriter({ eventsDir });
  const applied: ExperienceSupersededPayload[] = [];

  for (const action of actions) {
    const loserPath = await findExperiencePath(provisionalDir, promotedDir, action.loser_id);
    if (!loserPath) {
      continue;
    }

    let loserRecord: ExperienceRecord;
    try {
      loserRecord = await readJsonFile<ExperienceRecord>(loserPath);
    } catch {
      continue;
    }

    loserRecord.superseded_by = action.winner_id;
    loserRecord.archived = true;
    loserRecord.archived_reason = 'superseded';
    const supersededPath = path.join(supersededDir, `${action.loser_id}.json`);
    await writeJsonFile(supersededPath, loserRecord);

    try {
      await fsp.unlink(loserPath);
    } catch (error: unknown) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    }

    const winnerPath = await findExperiencePath(provisionalDir, promotedDir, action.winner_id);
    if (winnerPath) {
      try {
        const winnerRecord = await readJsonFile<ExperienceRecord>(winnerPath);
        winnerRecord.supersedes = action.loser_id;
        await writeJsonFile(winnerPath, winnerRecord);
      } catch {
        // keep going: loser move + event are the source of truth
      }
    }

    const payload: ExperienceSupersededPayload = {
      old_exp_id: action.loser_id,
      new_exp_id: action.winner_id,
      reason: action.reason,
      auto_superseded: true,
    };
    const event = buildSupersededEvent(payload, options.signer, sourceAgent);
    await writer.append(event);
    applied.push(payload);
  }

  return {
    superseded: applied.length,
    actions: applied,
  };
}
