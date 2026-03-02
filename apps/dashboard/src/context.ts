import {
  EventWriter,
  EventReader,
  EventProjector,
  StatsAggregator,
  createSigner,
  resolveConfig,
} from '@hive-exp/core';
import type { SignerInterface } from '@hive-exp/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

export interface DashboardContext {
  dataDir: string;
  experiencesDir: string;
  provisionalDir: string;
  promotedDir: string;
  archivedDir: string;
  supersededDir: string;
  eventsDir: string;
  dbPath: string;
  eventWriter: EventWriter;
  eventReader: EventReader;
  projector: EventProjector;
  aggregator: StatsAggregator;
  signer: SignerInterface;
  autoApprove: boolean;
}

export function createDashboardContext(dataDir?: string): DashboardContext {
  const root = dataDir ?? process.env.HIVE_EXP_HOME ?? path.join(os.homedir(), '.hive-exp');
  const config = resolveConfig(root);
  const experiencesDir = path.join(root, 'experiences');
  const provisionalDir = path.join(root, 'experiences', 'provisional');
  const promotedDir = path.join(root, 'experiences', 'promoted');
  const archivedDir = path.join(root, 'experiences', 'archived');
  const supersededDir = path.join(root, 'experiences', 'superseded');
  const eventsDir = path.join(root, 'events');
  const dbDir = path.join(root, 'db');

  for (const d of [experiencesDir, provisionalDir, promotedDir, archivedDir, supersededDir, eventsDir, dbDir]) {
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
  let projector: EventProjector;
  let aggregator: StatsAggregator;

  try {
    const realProjector = new EventProjector({ dbPath, eventsDir });
    realProjector.initialize();
    projector = realProjector;
    aggregator = new StatsAggregator({ dbPath });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Dashboard context: SQL-backed projection initialization skipped (${message})`);
    projector = {
      initialize() {
        return undefined;
      },
      projectEvent() {
        return undefined;
      },
      rebuild() {
        return undefined;
      },
      incrementalSync: async () => {
        return undefined;
      },
      close() {
        return undefined;
      },
    } as unknown as EventProjector;
    aggregator = {
      close() {
        return undefined;
      },
    } as unknown as StatsAggregator;
  }

  const signer = createSigner({ algorithm: 'hmac-sha256', secret });

  return {
    dataDir: root,
    experiencesDir,
    provisionalDir,
    promotedDir,
    archivedDir,
    supersededDir,
    eventsDir,
    dbPath,
    eventWriter,
    eventReader,
    projector,
    aggregator,
    signer,
    autoApprove: config.autoApprove,
  };
}
