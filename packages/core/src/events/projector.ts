import Database from 'better-sqlite3';
import { EventReader } from './reader.js';
import type {
  HiveEvent,
  ExperienceCreatedPayload,
  ExperienceReferencedPayload,
  ExperienceOutcomePayload,
  ExperiencePromotedPayload,
  ExperienceArchivedPayload,
  ExperienceSupersededPayload,
  StrategyBannedPayload,
} from '../types/index.js';

export interface ProjectorOptions {
  dbPath: string;
  eventsDir: string;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS _projection_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS usage_log (
  event_id        TEXT PRIMARY KEY,
  exp_id          TEXT NOT NULL,
  source_agent    TEXT NOT NULL,
  timestamp       TEXT NOT NULL,
  result          TEXT,
  context_summary TEXT
);

CREATE TABLE IF NOT EXISTS experience_meta (
  exp_id            TEXT PRIMARY KEY,
  strategy_name     TEXT NOT NULL DEFAULT '',
  strategy_category TEXT,
  promoted          INTEGER DEFAULT 0,
  archived          INTEGER DEFAULT 0,
  archived_reason   TEXT,
  superseded_by     TEXT
);

CREATE TABLE IF NOT EXISTS banned_strategies (
  strategy_name TEXT PRIMARY KEY,
  reason        TEXT NOT NULL,
  banned_by     TEXT NOT NULL,
  timestamp     TEXT NOT NULL
);
`;

const VIEWS_SQL = `
CREATE VIEW IF NOT EXISTS experience_stats AS
SELECT
  exp_id,
  COUNT(*)                                          AS ref_count,
  COUNT(CASE WHEN result = 'success' THEN 1 END)   AS success_count,
  COUNT(CASE WHEN result = 'failed' THEN 1 END)    AS fail_count,
  ROUND(
    CAST(COUNT(CASE WHEN result = 'success' THEN 1 END) AS REAL) /
    NULLIF(COUNT(CASE WHEN result IS NOT NULL THEN 1 END), 0),
    4
  )                                                 AS success_rate,
  MAX(timestamp)                                    AS last_used,
  json_group_array(DISTINCT source_agent)           AS used_by_agents
FROM usage_log
GROUP BY exp_id;

CREATE VIEW IF NOT EXISTS strategy_stats AS
SELECT
  em.strategy_name,
  em.strategy_category,
  COUNT(DISTINCT em.exp_id)                          AS total_experiences,
  COUNT(ul.event_id)                                 AS total_refs,
  COUNT(CASE WHEN ul.result IS NOT NULL THEN 1 END)  AS total_outcomes,
  ROUND(
    CAST(COUNT(CASE WHEN ul.result = 'success' THEN 1 END) AS REAL) /
    NULLIF(COUNT(CASE WHEN ul.result IS NOT NULL THEN 1 END), 0),
    4
  )                                                  AS success_rate
FROM experience_meta em
LEFT JOIN usage_log ul ON em.exp_id = ul.exp_id
GROUP BY em.strategy_name;
`;

const DROP_SQL = `
DROP VIEW IF EXISTS strategy_stats;
DROP VIEW IF EXISTS experience_stats;
DROP TABLE IF EXISTS banned_strategies;
DROP TABLE IF EXISTS experience_meta;
DROP TABLE IF EXISTS usage_log;
DROP TABLE IF EXISTS _projection_meta;
`;

export class EventProjector {
  private db: Database.Database;
  private reader: EventReader;

  constructor(options: ProjectorOptions) {
    this.db = new Database(options.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.reader = new EventReader({ eventsDir: options.eventsDir });
  }

  initialize(): void {
    this.db.exec(SCHEMA_SQL);
    this.db.exec(VIEWS_SQL);
  }

  projectEvent(event: HiveEvent): void {
    switch (event.type) {
      case 'experience.created':
        this.handleCreated(event);
        break;
      case 'experience.referenced':
        this.handleReferenced(event);
        break;
      case 'experience.outcome_recorded':
        this.handleOutcome(event);
        break;
      case 'experience.promoted':
        this.handlePromoted(event);
        break;
      case 'experience.archived':
        this.handleArchived(event);
        break;
      case 'experience.superseded':
        this.handleSuperseded(event);
        break;
      case 'strategy.banned':
        this.handleBanned(event);
        break;
      case 'confidence.decayed':
        // No SQL — confidence computed at query time
        break;
      default:
        // Unknown or unhandled event types are silently ignored
        break;
    }

    this.updateMeta(event.event_id, event.timestamp);
  }

  rebuild(): void {
    const events = this.readAllEventsSync();
    const txn = this.db.transaction(() => {
      this.db.exec(DROP_SQL);
      this.db.exec(SCHEMA_SQL);
      this.db.exec(VIEWS_SQL);
      for (const event of events) {
        this.projectEvent(event);
      }
    });
    txn();
  }

  async incrementalSync(): Promise<void> {
    const lastId = this.getMetaValue('last_event_id');
    const events = await this.reader.readEvents();

    let pastCheckpoint = lastId === null;
    const txn = this.db.transaction((pending: HiveEvent[]) => {
      for (const event of pending) {
        this.projectEvent(event);
      }
    });

    const pending: HiveEvent[] = [];
    for (const event of events) {
      if (!pastCheckpoint) {
        if (event.event_id === lastId) {
          pastCheckpoint = true;
        }
        continue;
      }
      pending.push(event);
    }

    if (pending.length > 0) {
      txn(pending);
    }
  }

  close(): void {
    this.db.close();
  }

  // --- Internal helpers ---

  private readAllEventsSync(): HiveEvent[] {
    // We need a synchronous path for rebuild().
    // Use a workaround: run the async reader via a blocking helper.
    // Since better-sqlite3 is sync and rebuild() is called in controlled contexts,
    // we read events files synchronously using node:fs.
    const fs = require('node:fs') as typeof import('node:fs');
    const pathMod = require('node:path') as typeof import('node:path');
    const zlib = require('node:zlib') as typeof import('node:zlib');

    const eventsDir = (this.reader as unknown as { eventsDir: string }).eventsDir;
    const EVENT_FILE_RE = /^events-(\d{4})-(\d{2})\.jsonl(\.gz)?$/;

    let entries: string[];
    try {
      entries = fs.readdirSync(eventsDir);
    } catch {
      return [];
    }

    const files = entries
      .filter((name: string) => EVENT_FILE_RE.test(name))
      .sort()
      .map((name: string) => pathMod.join(eventsDir, name));

    const events: HiveEvent[] = [];
    for (const filePath of files) {
      const match = pathMod.basename(filePath).match(EVENT_FILE_RE);
      if (!match) continue;

      const raw = fs.readFileSync(filePath);
      const content = match[3] === '.gz'
        ? zlib.gunzipSync(raw).toString('utf8')
        : raw.toString('utf8');

      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          events.push(JSON.parse(trimmed) as HiveEvent);
        } catch {
          // skip malformed lines
        }
      }
    }
    return events;
  }

  private handleCreated(event: HiveEvent): void {
    const p = event.payload as ExperienceCreatedPayload & {
      strategy_name?: string;
      strategy_category?: string;
    };
    this.db.prepare(
      `INSERT OR IGNORE INTO experience_meta (exp_id, strategy_name, strategy_category)
       VALUES (?, ?, ?)`
    ).run(
      p.exp_id,
      p.strategy_name ?? '',
      p.strategy_category ?? null,
    );
  }

  private handleReferenced(event: HiveEvent): void {
    const p = event.payload as ExperienceReferencedPayload;
    this.db.prepare(
      `INSERT OR IGNORE INTO usage_log (event_id, exp_id, source_agent, timestamp, result, context_summary)
       VALUES (?, ?, ?, ?, NULL, ?)`
    ).run(
      event.event_id,
      p.exp_id,
      event.source_agent,
      event.timestamp,
      p.context_summary,
    );
  }

  private handleOutcome(event: HiveEvent): void {
    const p = event.payload as ExperienceOutcomePayload;
    this.db.prepare(
      `UPDATE usage_log SET result = ? WHERE event_id = ?`
    ).run(p.result, p.ref_event_id);
  }

  private handlePromoted(event: HiveEvent): void {
    const p = event.payload as ExperiencePromotedPayload;
    this.db.prepare(
      `UPDATE experience_meta SET promoted = 1 WHERE exp_id = ?`
    ).run(p.exp_id);
  }

  private handleArchived(event: HiveEvent): void {
    const p = event.payload as ExperienceArchivedPayload;
    this.db.prepare(
      `UPDATE experience_meta SET archived = 1, archived_reason = ? WHERE exp_id = ?`
    ).run(p.reason, p.exp_id);
  }

  private handleSuperseded(event: HiveEvent): void {
    const p = event.payload as ExperienceSupersededPayload;
    this.db.prepare(
      `UPDATE experience_meta SET superseded_by = ?, archived = 1, archived_reason = 'superseded' WHERE exp_id = ?`
    ).run(p.new_exp_id, p.old_exp_id);
  }

  private handleBanned(event: HiveEvent): void {
    const p = event.payload as StrategyBannedPayload;
    this.db.prepare(
      `INSERT OR IGNORE INTO banned_strategies (strategy_name, reason, banned_by, timestamp)
       VALUES (?, ?, ?, ?)`
    ).run(p.strategy_name, p.reason, p.banned_by, event.timestamp);
  }

  private updateMeta(eventId: string, timestamp: string): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO _projection_meta (key, value) VALUES ('last_event_id', ?)`
    ).run(eventId);
    this.db.prepare(
      `INSERT OR REPLACE INTO _projection_meta (key, value) VALUES ('last_event_timestamp', ?)`
    ).run(timestamp);
  }

  private getMetaValue(key: string): string | null {
    const row = this.db.prepare(
      `SELECT value FROM _projection_meta WHERE key = ?`
    ).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }
}
