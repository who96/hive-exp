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
      const value = config[key as keyof typeof config];
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
      } else {
        console.error(`Unknown config key: ${key}`);
        process.exit(1);
      }
    });
}
