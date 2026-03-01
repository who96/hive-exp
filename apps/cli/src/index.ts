import { Command } from 'commander';
import { registerInit } from './commands/init.js';
import { registerAdd } from './commands/add.js';
import { registerValidate } from './commands/validate.js';
import { registerSign } from './commands/sign.js';
import { registerQuery } from './commands/query.js';
import { registerPromote } from './commands/promote.js';
import { registerArchive } from './commands/archive.js';
import { registerStats } from './commands/stats.js';
import { registerReplay } from './commands/replay.js';
import { registerExport } from './commands/export.js';

export const program = new Command();

program
  .name('hive-exp')
  .description('AI Agent Experience Management System')
  .version('0.1.0');

registerInit(program);
registerAdd(program);
registerValidate(program);
registerSign(program);
registerQuery(program);
registerPromote(program);
registerArchive(program);
registerStats(program);
registerReplay(program);
registerExport(program);

program.parse();
