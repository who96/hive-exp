import Database from 'better-sqlite3';

export interface ExperienceStatsRow {
  exp_id: string;
  ref_count: number;
  success_count: number;
  fail_count: number;
  success_rate: number | null;
  last_used: string | null;
  used_by_agents: string[];
}

export interface StrategyStatsRow {
  strategy_name: string;
  strategy_category: string | null;
  total_experiences: number;
  total_refs: number;
  total_outcomes: number;
  success_rate: number | null;
}

export interface BannedStrategyRow {
  strategy_name: string;
  reason: string;
  banned_by: string;
  timestamp: string;
}

export interface StatsAggregatorOptions {
  dbPath: string;
}

interface RawExperienceStatsRow {
  exp_id: string;
  ref_count: number;
  success_count: number;
  fail_count: number;
  success_rate: number | null;
  last_used: string | null;
  used_by_agents: string;
}

const EXP_SORT_COLUMNS: Record<string, string> = {
  ref_count: 'ref_count',
  success_rate: 'success_rate',
  last_used: 'last_used',
};

const STRATEGY_SORT_COLUMNS: Record<string, string> = {
  total_refs: 'total_refs',
  success_rate: 'success_rate',
  total_experiences: 'total_experiences',
};

function parseAgents(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && v !== '');
  } catch {
    return [];
  }
}

function toExperienceStats(row: RawExperienceStatsRow): ExperienceStatsRow {
  return {
    exp_id: row.exp_id,
    ref_count: row.ref_count,
    success_count: row.success_count,
    fail_count: row.fail_count,
    success_rate: row.success_rate,
    last_used: row.last_used,
    used_by_agents: parseAgents(row.used_by_agents),
  };
}

function viewExists(db: Database.Database, name: string): boolean {
  const row = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='view' AND name=?",
  ).get(name) as { '1': number } | undefined;
  return row !== undefined;
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  ).get(name) as { '1': number } | undefined;
  return row !== undefined;
}

export class StatsAggregator {
  private db: Database.Database;

  constructor(options: StatsAggregatorOptions) {
    this.db = new Database(options.dbPath, { readonly: true });
  }

  getExperienceStats(expId: string): ExperienceStatsRow | null {
    if (!viewExists(this.db, 'experience_stats')) return null;

    const row = this.db
      .prepare('SELECT * FROM experience_stats WHERE exp_id = ?')
      .get(expId) as RawExperienceStatsRow | undefined;

    return row ? toExperienceStats(row) : null;
  }

  getAllExperienceStats(options?: {
    sortBy?: 'ref_count' | 'success_rate' | 'last_used';
    order?: 'asc' | 'desc';
    limit?: number;
  }): ExperienceStatsRow[] {
    if (!viewExists(this.db, 'experience_stats')) return [];

    const sortCol = options?.sortBy
      ? EXP_SORT_COLUMNS[options.sortBy]
      : undefined;
    const order = options?.order === 'asc' ? 'ASC' : 'DESC';

    let sql = 'SELECT * FROM experience_stats';
    if (sortCol) {
      sql += ` ORDER BY ${sortCol} ${order}`;
    }
    if (options?.limit && options.limit > 0) {
      sql += ` LIMIT ${Number(options.limit)}`;
    }

    const rows = this.db.prepare(sql).all() as RawExperienceStatsRow[];
    return rows.map(toExperienceStats);
  }

  getStrategyStats(strategyName: string): StrategyStatsRow | null {
    if (!viewExists(this.db, 'strategy_stats')) return null;

    const row = this.db
      .prepare('SELECT * FROM strategy_stats WHERE strategy_name = ?')
      .get(strategyName) as StrategyStatsRow | undefined;

    return row ?? null;
  }

  getAllStrategyStats(options?: {
    sortBy?: 'total_refs' | 'success_rate' | 'total_experiences';
    order?: 'asc' | 'desc';
    limit?: number;
  }): StrategyStatsRow[] {
    if (!viewExists(this.db, 'strategy_stats')) return [];

    const sortCol = options?.sortBy
      ? STRATEGY_SORT_COLUMNS[options.sortBy]
      : undefined;
    const order = options?.order === 'asc' ? 'ASC' : 'DESC';

    let sql = 'SELECT * FROM strategy_stats';
    if (sortCol) {
      sql += ` ORDER BY ${sortCol} ${order}`;
    }
    if (options?.limit && options.limit > 0) {
      sql += ` LIMIT ${Number(options.limit)}`;
    }

    return this.db.prepare(sql).all() as StrategyStatsRow[];
  }

  getBannedStrategies(): BannedStrategyRow[] {
    if (!tableExists(this.db, 'banned_strategies')) return [];
    return this.db
      .prepare('SELECT * FROM banned_strategies')
      .all() as BannedStrategyRow[];
  }

  isStrategyBanned(strategyName: string): boolean {
    if (!tableExists(this.db, 'banned_strategies')) return false;
    const row = this.db
      .prepare('SELECT 1 FROM banned_strategies WHERE strategy_name = ?')
      .get(strategyName);
    return row !== undefined;
  }

  close(): void {
    this.db.close();
  }
}
