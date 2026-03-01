import {
  EventWriter,
  EventReader,
  EventProjector,
  StatsAggregator,
  createSigner,
} from '@hive-exp/core';
import type { SignerInterface } from '@hive-exp/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

export interface HiveExpContext {
  dataDir: string;
  experiencesDir: string;
  provisionalDir: string;
  promotedDir: string;
  archivedDir: string;
  eventsDir: string;
  dbPath: string;
  eventWriter: EventWriter;
  eventReader: EventReader;
  projector: EventProjector;
  aggregator: StatsAggregator;
  signer: SignerInterface;
}

export function createContext(dataDir?: string): HiveExpContext {
  const root =
    dataDir ?? process.env.HIVE_EXP_HOME ?? path.join(os.homedir(), '.hive-exp');

  const experiencesDir = path.join(root, 'experiences');
  const provisionalDir = path.join(root, 'experiences', 'provisional');
  const promotedDir = path.join(root, 'experiences', 'promoted');
  const archivedDir = path.join(root, 'experiences', 'archived');
  const eventsDir = path.join(root, 'events');
  const dbDir = path.join(root, 'db');

  for (const d of [experiencesDir, provisionalDir, promotedDir, archivedDir, eventsDir, dbDir]) {
    fs.mkdirSync(d, { recursive: true });
  }

  const dbPath = path.join(dbDir, 'projection.db');

  const secret =
    process.env.HIVE_EXP_SECRET ??
    crypto
      .createHash('sha256')
      .update(`${os.hostname()}-${os.userInfo().username}-hive-exp`)
      .digest('hex');

  const eventWriter = new EventWriter({ eventsDir });
  const eventReader = new EventReader({ eventsDir });
  const projector = new EventProjector({ dbPath, eventsDir });
  projector.initialize();

  const aggregator = new StatsAggregator({ dbPath });
  const signer = createSigner({ algorithm: 'hmac-sha256', secret });

  return {
    dataDir: root,
    experiencesDir,
    provisionalDir,
    promotedDir,
    archivedDir,
    eventsDir,
    dbPath,
    eventWriter,
    eventReader,
    projector,
    aggregator,
    signer,
  };
}
