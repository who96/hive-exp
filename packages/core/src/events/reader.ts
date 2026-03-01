import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import type { HiveEvent } from '../types/index.js';

export interface EventReaderOptions {
  eventsDir: string;
}

export interface ReadEventsOptions {
  fromDate?: Date;
  toDate?: Date;
  types?: string[];
  limit?: number;
}

const EVENT_FILE_RE = /^events-(\d{4})-(\d{2})\.jsonl(\.gz)?$/;

function toMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) {
    return undefined;
  }
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
}

export class EventReader {
  private readonly eventsDir: string;

  constructor(options: EventReaderOptions) {
    this.eventsDir = options.eventsDir;
  }

  async listEventFiles(): Promise<string[]> {
    const entries = await fs.readdir(this.eventsDir, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isFile() && EVENT_FILE_RE.test(entry.name))
      .map((entry) => path.join(this.eventsDir, entry.name))
      .sort((a, b) => a.localeCompare(b));
  }

  async readEvents(options: ReadEventsOptions = {}): Promise<HiveEvent[]> {
    const { fromDate, toDate, types, limit: rawLimit } = options;
    const normalizedLimit = normalizeLimit(rawLimit);
    const typeSet = types && types.length > 0 ? new Set(types) : null;
    const files = await this.listEventFiles();

    const fromMonth = fromDate ? toMonthStart(fromDate) : null;
    const toMonth = toDate ? toMonthStart(toDate) : null;

    const events: HiveEvent[] = [];

    const relevantFiles = files.filter((filePath) => {
      const fileName = path.basename(filePath);
      const match = fileName.match(EVENT_FILE_RE);
      if (!match) {
        return false;
      }
      if (!fromMonth && !toMonth) {
        return true;
      }
      const fileMonth = new Date(Number(match[1]), Number(match[2]) - 1, 1, 0, 0, 0, 0);
      if (fromMonth && fileMonth < fromMonth) {
        return false;
      }
      if (toMonth) {
        return fileMonth <= toMonth;
      }
      return true;
    });

    for (const filePath of relevantFiles) {
      const fileName = path.basename(filePath);
      const match = fileName.match(EVENT_FILE_RE);
      if (!match) {
        continue;
      }
      const isGzip = match[3] === '.gz';

      const content = await fs.readFile(filePath);
      const rawContent = isGzip ? zlib.gunzipSync(content).toString('utf8') : content.toString('utf8');
      const lines = rawContent.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        let event: HiveEvent;
        try {
          event = JSON.parse(trimmed) as HiveEvent;
        } catch (error: unknown) {
          console.warn('Malformed event JSON line skipped', error);
          continue;
        }

        if (typeSet && !typeSet.has(event.type)) {
          continue;
        }

        const eventTime = new Date(event.timestamp);
        if (fromDate && eventTime < fromDate) {
          continue;
        }
        if (toDate && eventTime > toDate) {
          continue;
        }

        if (normalizedLimit !== undefined && events.length >= normalizedLimit) {
          return events;
        }
        events.push(event);
      }
    }

    return events;
  }
}
