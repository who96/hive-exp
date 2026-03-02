import * as fs from 'node:fs';
import * as path from 'node:path';

export interface HiveExpConfig {
  autoApprove: boolean;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === 'true' || value === '1';
}

export function resolveConfig(dataDir: string): HiveExpConfig {
  const defaultConfig: HiveExpConfig = { autoApprove: true };
  const envValue = parseBoolean(process.env.HIVE_EXP_AUTO_APPROVE);
  if (envValue !== undefined) {
    return { autoApprove: envValue };
  }

  const configPath = path.join(dataDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    return defaultConfig;
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const existing = JSON.parse(raw) as Partial<{ auto_approve: boolean }>;
  return {
    autoApprove:
      typeof existing.auto_approve === 'boolean' ? existing.auto_approve : defaultConfig.autoApprove,
  };
}

export function writeConfig(dataDir: string, config: Partial<HiveExpConfig>): void {
  const configPath = path.join(dataDir, 'config.json');
  const raw = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : '{}';
  const existing = raw ? (JSON.parse(raw) as Partial<{ auto_approve: boolean }>) : {};
  const merged = {
    auto_approve:
      config.autoApprove ?? (typeof existing.auto_approve === 'boolean' ? existing.auto_approve : undefined),
  };

  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
}
