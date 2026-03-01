import type { Command } from 'commander';

export function registerSign(program: Command): void {
  program
    .command('sign <path>')
    .description('Sign an experience file with HMAC-SHA256')
    .option('--secret <secret>', 'signing secret')
    .action(() => {
      console.log('[stub] sign — will sign experience file');
    });
}
