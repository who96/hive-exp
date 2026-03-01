import { readFileSync, writeFileSync } from 'node:fs';
import type { Command } from 'commander';
import { createSigner } from '@hive-exp/core';
import { createContext } from '../context.js';

export function registerSign(program: Command): void {
  program
    .command('sign <path>')
    .description('Sign an experience file with HMAC-SHA256')
    .option('--secret <secret>', 'signing secret')
    .action((path, options) => {
      const filePath = path as string;
      const raw = readFileSync(filePath, 'utf-8');
      const record = JSON.parse(raw) as Record<string, unknown>;

      const signer = options.secret
        ? createSigner({ algorithm: 'hmac-sha256', secret: options.secret })
        : createContext().signer;

      const unsigned = { ...record, signature: '' };
      record.signature = signer.sign(JSON.stringify(unsigned));
      writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`);
      console.log(record.signature);
    });
}
