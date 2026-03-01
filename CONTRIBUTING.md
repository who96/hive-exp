# Contributing to hive-exp

## Development Setup

```bash
# Clone the repository
git clone https://github.com/hive-exp/hive-exp.git
cd hive-exp

# Install dependencies (requires pnpm >= 9)
pnpm install

# Build all packages
pnpm -r run build

# Run all tests
pnpm -r run test

# Type-check without emitting
pnpm typecheck
```

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Python >= 3.9 (for hook tests only)

## Repository Layout

```
packages/core/           — @hive-exp/core: schema, events, signer, sanitizer, consensus
packages/mcp/            — @hive-exp/mcp: MCP server (5 tools)
packages/signer-ed25519/ — @hive-exp/signer-ed25519: optional Ed25519 signer
apps/cli/                — hive-exp CLI (10 commands)
apps/dashboard/          — Web dashboard
hooks/                   — Claude Code PostToolUse hook
tests/                   — Integration tests (vitest)
configs/                 — Shared tsconfig and eslint presets
```

## Code Style

- **Language**: TypeScript, strict mode, ESM (`.js` imports in source).
- **Test runner**: Vitest. Unit tests live next to source (`*.test.ts`). Integration tests live in `tests/`.
- **No classes** in public APIs where a plain function or plain object works.
- **No default exports**. Named exports only.
- Indentation: 2 spaces. Max line length: 100 characters.
- Run `pnpm -r run build` before submitting — the CI gate requires a clean build.

## Pull Request Process

1. Fork the repository and create a branch from `main`.
2. Make your changes. Add or update tests to cover the affected paths.
3. Run `pnpm -r run build && pnpm -r run test` locally. Both must pass.
4. Open a PR against `main`. Describe what changed and why.
5. A maintainer will review. Address feedback by pushing additional commits (do not force-push during review).
6. Once approved and CI is green, a maintainer will merge.

Keep PRs focused. One logical change per PR. If you are adding a new MCP tool and a new CLI command, open two separate PRs.

## Adding a New MCP Tool

1. Create `packages/mcp/src/tools/<tool-name>.ts`. Export a single function that returns an `MCP.Tool` definition and a handler.

   ```typescript
   // packages/mcp/src/tools/my_tool.ts
   import type { McpTool } from '../types.js';

   export function myTool(): McpTool {
     return {
       definition: {
         name: 'hive_exp_my_tool',
         description: 'What this tool does.',
         inputSchema: { /* JSON Schema */ },
       },
       async handler(args) {
         // implementation
         return { result: '...' };
       },
     };
   }
   ```

2. Register the tool in `packages/mcp/src/server.ts`:

   ```typescript
   import { myTool } from './tools/my_tool.js';
   // add to the tools array
   ```

3. Add unit tests in `packages/mcp/src/tools/my_tool.test.ts`.

4. Update the MCP Tools table in `README.md`.

## Adding a New CLI Command

1. Create `apps/cli/src/commands/<command>.ts`. Export a `register<Command>(program: Command): void` function.

   ```typescript
   import type { Command } from 'commander';

   export function registerMyCommand(program: Command): void {
     program
       .command('my-command <arg>')
       .description('What this command does')
       .option('--flag', 'a flag')
       .action(async (arg, options) => {
         // implementation
       });
   }
   ```

2. Import and register in `apps/cli/src/index.ts`.

3. Add tests in `apps/cli/src/commands/<command>.test.ts`.

4. Update the CLI Commands table in `README.md`.

## Reporting Issues

Open an issue on GitHub. Include:
- The exact command or agent configuration you used.
- The full error output.
- Your OS, Node.js version, and pnpm version.

## Security

Do not open a public issue for security vulnerabilities. Email the maintainers directly (address in `package.json`). We aim to respond within 48 hours.
