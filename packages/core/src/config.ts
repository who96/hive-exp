import * as fs from 'node:fs';
import * as path from 'node:path';

export interface HiveExpConfig {
  autoApprove: boolean;
  dedupEnabled: boolean;
  dedupIntervalHours: number;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return undefined;
}

function parsePositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

const DEFAULT_CONFIG: HiveExpConfig = {
  autoApprove: true,
  dedupEnabled: true,
  dedupIntervalHours: 24,
};

export function resolveConfig(dataDir: string): HiveExpConfig {
  const envAutoApprove = parseBoolean(process.env.HIVE_EXP_AUTO_APPROVE);
  const envDedupEnabled = parseBoolean(process.env.HIVE_EXP_DEDUP_ENABLED);
  const envDedupInterval = parsePositiveNumber(
    process.env.HIVE_EXP_DEDUP_INTERVAL_HOURS
      ? Number(process.env.HIVE_EXP_DEDUP_INTERVAL_HOURS)
      : undefined,
  );

  const configPath = path.join(dataDir, 'config.json');
  let existing: Partial<{
    auto_approve: boolean;
    dedup_enabled: boolean;
    dedup_interval_hours: number;
  }> = {};
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8');
    existing = JSON.parse(raw) as Partial<{
      auto_approve: boolean;
      dedup_enabled: boolean;
      dedup_interval_hours: number;
    }>;
  }

  return {
    autoApprove: envAutoApprove
      ?? (typeof existing.auto_approve === 'boolean' ? existing.auto_approve : DEFAULT_CONFIG.autoApprove),
    dedupEnabled: envDedupEnabled
      ?? (typeof existing.dedup_enabled === 'boolean' ? existing.dedup_enabled : DEFAULT_CONFIG.dedupEnabled),
    dedupIntervalHours: envDedupInterval
      ?? parsePositiveNumber(existing.dedup_interval_hours)
      ?? DEFAULT_CONFIG.dedupIntervalHours,
  };
}

export function writeConfig(dataDir: string, config: Partial<HiveExpConfig>): void {
  const configPath = path.join(dataDir, 'config.json');
  const raw = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : '{}';
  const existing = raw
    ? (JSON.parse(raw) as Partial<{
      auto_approve: boolean;
      dedup_enabled: boolean;
      dedup_interval_hours: number;
    }>)
    : {};
  const merged = {
    auto_approve:
      config.autoApprove
      ?? (typeof existing.auto_approve === 'boolean' ? existing.auto_approve : DEFAULT_CONFIG.autoApprove),
    dedup_enabled:
      config.dedupEnabled
      ?? (typeof existing.dedup_enabled === 'boolean' ? existing.dedup_enabled : DEFAULT_CONFIG.dedupEnabled),
    dedup_interval_hours:
      config.dedupIntervalHours
      ?? parsePositiveNumber(existing.dedup_interval_hours)
      ?? DEFAULT_CONFIG.dedupIntervalHours,
  };

  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
}
