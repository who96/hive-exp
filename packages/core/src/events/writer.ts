import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { HiveEvent } from '../types/index.js';

export interface EventWriterOptions {
  eventsDir: string;
}

const REQUIRED_FIELDS: (keyof HiveEvent)[] = [
  'event_id', 'type', 'timestamp', 'source_agent', 'signature', 'payload',
];

function getMonthlyFileName(date: Date): string {
  const yyyy = date.getFullYear().toString();
  const mm = (date.getMonth() + 1).toString().padStart(2, '0');
  return `events-${yyyy}-${mm}.jsonl`;
}

async function acquireLock(lockPath: string, retries = 20, delayMs = 10): Promise<fs.FileHandle> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      return handle;
    } catch (_err: unknown) {
      if (attempt === retries - 1) {
        throw new Error(`Failed to acquire lock after ${retries} attempts: ${lockPath}`);
      }
      // Jittered backoff: base delay + random component to reduce contention
      const jitter = Math.random() * delayMs;
      await new Promise(resolve => setTimeout(resolve, delayMs + jitter));
    }
  }
  // Unreachable, but satisfies TypeScript
  throw new Error(`Failed to acquire lock: ${lockPath}`);
}

async function releaseLock(handle: fs.FileHandle, lockPath: string): Promise<void> {
  await handle.close();
  await fs.unlink(lockPath).catch(() => {});
}

export class EventWriter {
  private readonly eventsDir: string;

  constructor(options: EventWriterOptions) {
    this.eventsDir = options.eventsDir;
  }

  getCurrentFilePath(): string {
    return path.join(this.eventsDir, getMonthlyFileName(new Date()));
  }

  async append(event: HiveEvent): Promise<void> {
    this.validate(event);

    await fs.mkdir(this.eventsDir, { recursive: true });

    const filePath = this.getCurrentFilePath();
    const lockPath = filePath + '.lock';
    const line = JSON.stringify(event) + '\n';

    const handle = await acquireLock(lockPath);
    try {
      await fs.appendFile(filePath, line, { flag: 'a' });
    } finally {
      await releaseLock(handle, lockPath);
    }
  }

  private validate(event: HiveEvent): void {
    for (const field of REQUIRED_FIELDS) {
      if (event[field] === undefined || event[field] === null) {
        throw new Error(`Missing required field: ${field}`);
      }
      if (typeof event[field] === 'string' && (event[field] as string).trim() === '') {
        throw new Error(`Required field must not be empty: ${field}`);
      }
    }
  }
}
