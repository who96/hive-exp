# hive-exp — Bootstrap Context

## What Is This
AI Agent Experience Management System. Agents record, share, and learn from structured experiences via MCP protocol, with human-in-the-loop quality control.

## Tech Stack
- **Runtime**: Node.js 20, TypeScript, pnpm monorepo
- **Architecture**: Event sourcing (JSONL append-only → SQLite projection)
- **Packages**: @hive-exp/core, @hive-exp/mcp, @hive-exp/dashboard, @hive-exp/signer-ed25519, hive-exp (CLI)
- **Test**: Vitest (255 tests across 6 suites)
- **CI**: GitHub Actions (.github/workflows/ci.yml) — lint, test, build-check

## Repo Structure
```
packages/core/        — Schema, events, signer, sanitizer, projector, stats, lifecycle, consensus
packages/mcp/         — MCP Server (5 tools, stdio)
packages/signer-ed25519/ — Optional Ed25519 signer
apps/cli/             — CLI (10 commands)
apps/dashboard/       — Web dashboard (Express 5 + vanilla HTML/CSS/JS, localhost:3721)
hooks/                — Claude Code hook (signal-detector.py)
configs/              — Agent config templates (6 agents)
seeds/                — Cold-start data (25 OpenClaw experiences)
docs/                 — Design docs + delivery reports
```

## Key Design Decisions
1. Event sourcing: JSONL → SQLite projection
2. Promote two-step: MCP sets pending_promotion, CLI --confirm executes
3. Confidence decay: c * 0.5^(days/halflife), 30-day default
4. Dashboard local-only: 127.0.0.1:3721, no auth
5. Ed25519 optional: pluggable via SignerInterface

## Remote
- GitHub: git@github.com:who96/hive-exp.git
- Branch: main
