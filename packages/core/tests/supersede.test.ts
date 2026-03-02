import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

import {
  executeSupersedes,
  executeSupersedesSync,
} from '../src/supersede.js';
import type { SupersedeAction } from '../src/dedup.js';
import type { ExperienceRecord, HiveEvent, SignerInterface } from '../src/types/index.js';

function tmpDir(): string {
  return path.join(os.tmpdir(), `hive-supersede-test-${crypto.randomUUID()}`);
}

function setupDataDir(baseDir: string): void {
  const directories = [
    path.join(baseDir, 'experiences', 'provisional'),
    path.join(baseDir, 'experiences', 'promoted'),
    path.join(baseDir, 'events'),
  ];
  for (const dir of directories) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function buildExperience(overrides: Partial<ExperienceRecord> = {}): ExperienceRecord {
  return {
    id: 'exp_1709280000_a1b2c3d4',
    type: 'experience',
    schema_version: '1.1.0',
    signals: ['tsc_error'],
    scope: 'project',
    strategy: {
      name: 'retry_with_backoff',
      description: 'Retry with backoff',
      category: 'repair',
    },
    outcome: { status: 'success' },
    confidence: 0.5,
    source_agent: 'test-agent',
    signature: 'hmac-sha256:test',
    validated_by: null,
    promoted: false,
    provisional: true,
    provisional_deadline: null,
    supersedes: null,
    superseded_by: null,
    created: '2026-03-01T00:00:00Z',
    last_confirmed: '2026-03-01T00:00:00Z',
    decay_halflife_days: 30,
    archived: false,
    archived_reason: null,
    ...overrides,
  };
}

function writeExperience(dir: string, record: ExperienceRecord): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${record.id}.json`), JSON.stringify(record, null, 2) + '\n', 'utf8');
}

function readExperience(filePath: string): ExperienceRecord {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ExperienceRecord;
}

function readEvents(eventsDir: string): HiveEvent[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(eventsDir);
  } catch {
    return [];
  }

  const files = entries
    .filter((name) => /^events-(\d{4})-(\d{2})\.jsonl$/.test(name))
    .sort()
    .map((name) => path.join(eventsDir, name));

  const out: HiveEvent[] = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      out.push(JSON.parse(trimmed) as HiveEvent);
    }
  }
  return out;
}

function action(
  winnerId: string,
  loserId: string,
  winnerConfidence = 0.8,
  loserConfidence = 0.4,
): SupersedeAction {
  return {
    winner_id: winnerId,
    loser_id: loserId,
    reason: `Duplicate strategy: ${winnerConfidence} > ${loserConfidence}`,
    winner_confidence: winnerConfidence,
    loser_confidence: loserConfidence,
  };
}

const signer: SignerInterface = {
  sign(data: string): string {
    return `hmac-sha256:${crypto.createHash('sha256').update(data).digest('hex')}`;
  },
  verify(): boolean {
    return true;
  },
};

describe('executeSupersedes / executeSupersedesSync', () => {
  let testDir = '';

  afterEach(async () => {
    if (testDir) {
      await fsp.rm(testDir, { recursive: true, force: true });
      testDir = '';
    }
  });

  it('sync: moves loser from provisional/ to superseded/', () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const winner = buildExperience({ id: 'exp_1709280100_aaaaaaaa' });
    const loser = buildExperience({ id: 'exp_1709280101_bbbbbbbb' });
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), winner);
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), loser);

    const result = executeSupersedesSync([action(winner.id, loser.id)], {
      dataDir: baseDir,
      signer,
    });

    expect(result.superseded).toBe(1);
    expect(fs.existsSync(path.join(baseDir, 'experiences', 'provisional', `${loser.id}.json`))).toBe(false);
    expect(fs.existsSync(path.join(baseDir, 'experiences', 'superseded', `${loser.id}.json`))).toBe(true);
    const supersededRecord = readExperience(path.join(baseDir, 'experiences', 'superseded', `${loser.id}.json`));
    expect(supersededRecord.archived).toBe(true);
    expect(supersededRecord.archived_reason).toBe('superseded');
    expect(supersededRecord.superseded_by).toBe(winner.id);
  });

  it('async: moves loser from promoted/ to superseded/', async () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const winner = buildExperience({
      id: 'exp_1709280200_aaaaaaaa',
      promoted: true,
      provisional: false,
      provisional_deadline: null,
    });
    const loser = buildExperience({
      id: 'exp_1709280201_bbbbbbbb',
      promoted: true,
      provisional: false,
      provisional_deadline: null,
    });
    writeExperience(path.join(baseDir, 'experiences', 'promoted'), winner);
    writeExperience(path.join(baseDir, 'experiences', 'promoted'), loser);

    const result = await executeSupersedes([action(winner.id, loser.id)], {
      dataDir: baseDir,
      signer,
    });

    expect(result.superseded).toBe(1);
    expect(fs.existsSync(path.join(baseDir, 'experiences', 'promoted', `${loser.id}.json`))).toBe(false);
    expect(fs.existsSync(path.join(baseDir, 'experiences', 'superseded', `${loser.id}.json`))).toBe(true);
  });

  it('sync: updates winner supersedes field', () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const winner = buildExperience({ id: 'exp_1709280300_aaaaaaaa' });
    const loser = buildExperience({ id: 'exp_1709280301_bbbbbbbb' });
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), winner);
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), loser);

    executeSupersedesSync([action(winner.id, loser.id)], {
      dataDir: baseDir,
      signer,
    });

    const winnerRecord = readExperience(path.join(baseDir, 'experiences', 'provisional', `${winner.id}.json`));
    expect(winnerRecord.supersedes).toBe(loser.id);
  });

  it('async: writes experience.superseded event with auto_superseded=true', async () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const winner = buildExperience({ id: 'exp_1709280400_aaaaaaaa' });
    const loser = buildExperience({ id: 'exp_1709280401_bbbbbbbb' });
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), winner);
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), loser);

    await executeSupersedes([action(winner.id, loser.id)], {
      dataDir: baseDir,
      signer,
    });

    const events = readEvents(path.join(baseDir, 'events'));
    const supersedeEvent = events.find((event) => event.type === 'experience.superseded');
    expect(supersedeEvent).toBeDefined();
    expect(supersedeEvent?.payload).toMatchObject({
      old_exp_id: loser.id,
      new_exp_id: winner.id,
      auto_superseded: true,
    });
  });

  it('sync: empty actions produce no side effects', () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const winner = buildExperience({ id: 'exp_1709280500_aaaaaaaa' });
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), winner);

    const result = executeSupersedesSync([], {
      dataDir: baseDir,
      signer,
    });

    expect(result.superseded).toBe(0);
    expect(fs.existsSync(path.join(baseDir, 'experiences', 'provisional', `${winner.id}.json`))).toBe(true);
    expect(readEvents(path.join(baseDir, 'events'))).toEqual([]);
  });

  it('async: skips missing loser file without throwing', async () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const winner = buildExperience({ id: 'exp_1709280600_aaaaaaaa' });
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), winner);

    const result = await executeSupersedes([action(winner.id, 'exp_1709280601_bbbbbbbb')], {
      dataDir: baseDir,
      signer,
    });

    expect(result.superseded).toBe(0);
    expect(result.actions).toEqual([]);
  });

  it('sync: for multiple losers, winner.supersedes equals the last loser_id', () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const winner = buildExperience({ id: 'exp_1709280700_aaaaaaaa' });
    const loserA = buildExperience({ id: 'exp_1709280701_bbbbbbbb' });
    const loserB = buildExperience({ id: 'exp_1709280702_cccccccc' });
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), winner);
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), loserA);
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), loserB);

    executeSupersedesSync([action(winner.id, loserA.id), action(winner.id, loserB.id)], {
      dataDir: baseDir,
      signer,
    });

    const winnerRecord = readExperience(path.join(baseDir, 'experiences', 'provisional', `${winner.id}.json`));
    expect(winnerRecord.supersedes).toBe(loserB.id);
  });

  it('async: auto-creates superseded/ directory when missing', async () => {
    const baseDir = tmpDir();
    testDir = baseDir;
    setupDataDir(baseDir);

    const supersededDir = path.join(baseDir, 'experiences', 'superseded');
    if (fs.existsSync(supersededDir)) {
      fs.rmSync(supersededDir, { recursive: true, force: true });
    }

    const winner = buildExperience({ id: 'exp_1709280800_aaaaaaaa' });
    const loser = buildExperience({ id: 'exp_1709280801_bbbbbbbb' });
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), winner);
    writeExperience(path.join(baseDir, 'experiences', 'provisional'), loser);

    await executeSupersedes([action(winner.id, loser.id)], {
      dataDir: baseDir,
      signer,
    });

    expect(fs.existsSync(path.join(supersededDir, `${loser.id}.json`))).toBe(true);
  });
});
