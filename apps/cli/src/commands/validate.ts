import type { Command } from 'commander';
import { validateExperience } from '@hive-exp/core';
import { parseFileAuto } from '../utils.js';

export function registerValidate(program: Command): void {
  program
    .command('validate <path>')
    .description('Validate an experience YAML file against the schema')
    .action((path) => {
      const filePath = path as string;
      const raw = parseFileAuto(filePath);
      const validation = validateExperience(raw);
      if (validation.valid) {
        console.log('PASS');
        process.exitCode = 0;
      } else {
        console.log('FAIL');
        for (const err of validation.errors) {
          console.log(`- ${err}`);
        }
        process.exitCode = 1;
      }
    });
}
