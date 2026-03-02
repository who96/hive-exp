import { Command } from 'commander';
import { resolveConfig, writeConfig } from '@hive-exp/core';
import { resolveDataDir } from '../context.js';

export function registerConfig(program: Command): void {
  const configCmd = program.command('config').description('Manage hive-exp configuration');

  configCmd
    .command('get <key>')
    .description('Get a configuration value')
    .action((key: string) => {
      const dataDir = resolveDataDir();
      const config = resolveConfig(dataDir);
      const keyMap: Record<string, keyof typeof config> = {
        autoApprove: 'autoApprove',
        auto_approve: 'autoApprove',
        dedupEnabled: 'dedupEnabled',
        dedup_enabled: 'dedupEnabled',
        dedupIntervalHours: 'dedupIntervalHours',
        dedup_interval_hours: 'dedupIntervalHours',
      };
      const mappedKey = keyMap[key];
      const value = mappedKey ? config[mappedKey] : undefined;
      if (value === undefined) {
        console.error(`Unknown config key: ${key}`);
        process.exit(1);
      }
      console.log(`${key} = ${value}`);
    });

  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key: string, value: string) => {
      const dataDir = resolveDataDir();
      if (key === 'autoApprove' || key === 'auto_approve') {
        const boolVal = value === 'true' || value === '1';
        writeConfig(dataDir, { autoApprove: boolVal });
        console.log(`auto_approve = ${boolVal}`);
        if (boolVal) {
          console.log('⚠ Warning: auto_approve=true means new experiences skip review and go directly to trusted zone.');
        }
      } else if (key === 'dedupEnabled' || key === 'dedup_enabled') {
        const boolVal = value === 'true' || value === '1';
        writeConfig(dataDir, { dedupEnabled: boolVal });
        console.log(`dedup_enabled = ${boolVal}`);
      } else if (key === 'dedupIntervalHours' || key === 'dedup_interval_hours') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          console.error(`Invalid dedup interval: ${value}`);
          process.exit(1);
        }
        writeConfig(dataDir, { dedupIntervalHours: parsed });
        console.log(`dedup_interval_hours = ${parsed}`);
      } else {
        console.error(`Unknown config key: ${key}`);
        process.exit(1);
      }
    });
}
