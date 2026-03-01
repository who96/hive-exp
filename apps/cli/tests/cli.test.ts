import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { registerInit } from '../src/commands/init.js';
import { registerAdd } from '../src/commands/add.js';
import { registerValidate } from '../src/commands/validate.js';
import { registerSign } from '../src/commands/sign.js';
import { registerQuery } from '../src/commands/query.js';
import { registerPromote } from '../src/commands/promote.js';
import { registerArchive } from '../src/commands/archive.js';
import { registerStats } from '../src/commands/stats.js';
import { registerReplay } from '../src/commands/replay.js';
import { registerExport } from '../src/commands/export.js';

function createTestProgram(): Command {
  const program = new Command();
  program
    .name('hive-exp')
    .description('AI Agent Experience Management System')
    .version('0.1.0');

  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });

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

  return program;
}

const EXPECTED_COMMANDS = [
  'init',
  'add',
  'validate',
  'sign',
  'query',
  'promote',
  'archive',
  'stats',
  'replay',
  'export',
];

describe('hive-exp CLI', () => {
  it('should create program with name hive-exp', () => {
    const program = createTestProgram();
    expect(program.name()).toBe('hive-exp');
  });

  it('should register all 10 commands', () => {
    const program = createTestProgram();
    const commandNames = program.commands.map((cmd) => cmd.name());
    expect(commandNames).toHaveLength(10);
    for (const name of EXPECTED_COMMANDS) {
      expect(commandNames).toContain(name);
    }
  });

  it('should have a description for every command', () => {
    const program = createTestProgram();
    for (const cmd of program.commands) {
      expect(cmd.description()).toBeTruthy();
    }
  });

  it('should output version 0.1.0 on --version', () => {
    const program = createTestProgram();
    expect(program.version()).toBe('0.1.0');
  });

  it('should include all command names in help output', () => {
    const program = createTestProgram();
    const helpText = program.helpInformation();
    for (const name of EXPECTED_COMMANDS) {
      expect(helpText).toContain(name);
    }
  });
});
