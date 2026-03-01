import type { Command } from 'commander';
import type { HiveEvent } from '@hive-exp/core';
import { createContext } from '../context.js';

export function registerReplay(program: Command): void {
  program
    .command('replay')
    .description('Rebuild SQLite projection from event log')
    .option('--from <date>', 'replay from date')
    .option('--verbose', 'verbose output')
    .action(async (options) => {
      const context = createContext();
      await context.projector.rebuild();
      const events = await context.eventReader.readEvents(
        options.from ? { fromDate: new Date(options.from) } : undefined,
      );

      console.log(`Replayed ${events.length} events`);
      if (options.verbose) {
        for (const event of events as HiveEvent[]) {
          console.log(`${event.type} ${event.event_id}`);
        }
      }
    });
}
