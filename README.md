# hive-exp

**AI Agent Experience Management System** — structured, cross-agent, human-reviewed knowledge for your AI tools.

[![npm](https://img.shields.io/npm/v/hive-exp)](https://www.npmjs.com/package/hive-exp)
[![CI](https://img.shields.io/github/actions/workflow/status/hive-exp/hive-exp/ci.yml)](https://github.com/hive-exp/hive-exp/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## What is hive-exp?

When an AI agent solves a non-trivial problem — a TypeScript compiler error, a broken build, a failing test — the solution disappears the moment the session ends. The next time the same error appears (in a different project, by a different agent, even by the same agent tomorrow), the work starts from zero. hive-exp fixes this by recording *experiences*: structured JSON objects with a canonical `signal → strategy → outcome` shape, persisted locally and queryable in milliseconds.

Knowledge does not stay siloed per-agent. Because hive-exp speaks the Model Context Protocol (MCP), Claude Code, Codex, Gemini CLI, Cursor, and Windsurf all read and write the same experience store. An experience recorded by Claude Code while fixing a TypeScript path alias issue is immediately available to Codex the next time it encounters the same signal. The experience store is a shared brain, not a per-agent scratch pad.

Humans stay in the loop. Experiences start as *provisional* and can only be *promoted* to the trusted zone by an explicit human action — via the CLI or the dashboard. Confidence decays over time using an exponential half-life model; experiences that accumulate consecutive failures or go 30 days without a single reference are auto-archived. The dashboard gives you a live view of every experience, its current confidence, and its usage statistics.

## Quick Start

```bash
# Install CLI globally
npm install -g hive-exp

# Initialize for your AI agents (auto-detects installed agents)
hive-exp init --force

# Or run the MCP server directly
npx @hive-exp/mcp
```

## Agent Configuration

`hive-exp init --force` writes the correct snippet automatically. To configure manually:

### Claude Code — `~/.mcp.json`

```json
{
  "mcpServers": {
    "hive-exp": {
      "command": "npx",
      "args": ["-y", "@hive-exp/mcp"]
    }
  }
}
```

### Codex — `~/.codex/config.toml`

```toml
[mcp_servers.hive-exp]
type = "stdio"
command = "npx"
args = ["-y", "@hive-exp/mcp"]
```

### Gemini CLI — `~/.gemini/mcp.json`

```json
{
  "mcpServers": {
    "hive-exp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@hive-exp/mcp"],
      "env": {}
    }
  }
}
```

### Antigravity — `~/.gemini/antigravity/mcp_config.json`

```json
{
  "mcpServers": {
    "hive-exp": {
      "command": "npx",
      "args": ["-y", "@hive-exp/mcp"]
    }
  }
}
```

### Cursor — `.cursor/mcp.json`

```json
{
  "hive-exp": {
    "command": "npx",
    "args": ["-y", "@hive-exp/mcp"]
  }
}
```

### Windsurf — `.windsurf/mcp.json`

```json
{
  "hive-exp": {
    "command": "npx",
    "args": ["-y", "@hive-exp/mcp"]
  }
}
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `hive-exp init [--force] [--agent <type>]` | Auto-detect AI agents and write MCP configuration |
| `hive-exp add [--file <path>] [--signals ...] [--strategy <name>]` | Add a new experience record |
| `hive-exp validate <path>` | Validate an experience JSON file against the schema |
| `hive-exp sign <path> [--secret <secret>]` | Sign an experience file with HMAC-SHA256 |
| `hive-exp query [--signal] [--strategy] [--scope] [--limit] [--format]` | Query experiences by signal, strategy, or scope |
| `hive-exp promote <exp_id> [--confirm]` | Promote an experience to the trusted zone (human confirmation required) |
| `hive-exp archive <exp_id> [--reason]` | Archive an experience (soft delete) |
| `hive-exp stats [--type] [--format]` | Show strategy statistics and experience health overview |
| `hive-exp replay [--from <date>] [--verbose]` | Rebuild SQLite projection from the event log |
| `hive-exp export [--format] [--min-confidence] [--scope] [--agent] [--promoted-only] [--output]` | Export experiences for RAG or external consumption |

## MCP Tools

The MCP server exposes five tools to connected agents:

| Tool | Description |
|------|-------------|
| `hive_exp_query` | Search for experiences matching error signals; returns strategies ranked by success rate and confidence |
| `hive_exp_record` | Record a new experience after successfully solving a non-trivial problem |
| `hive_exp_outcome` | Record the outcome after applying a strategy from a queried experience |
| `hive_exp_stats` | Get strategy statistics and experience health overview (`overview`, `strategy_ranking`, `at_risk`) |
| `hive_exp_promote` | Propose promoting an experience to the trusted zone (sets `pending_promotion`; actual promotion requires human confirmation) |

## Dashboard

```bash
# Start the dashboard (requires the CLI to be installed)
hive-exp dashboard

# Or start directly from source
npx tsx apps/dashboard/src/server.ts
```

The dashboard runs at `http://localhost:3333` and shows all experiences, their current confidence scores, usage statistics, and a promotion queue for human review.

## Architecture

```
packages/core/           — Core library (schema, events, signer, sanitizer, consensus, cron)
packages/mcp/            — MCP Server (5 tools, stdio transport, zero external dependencies)
packages/signer-ed25519/ — Optional Ed25519 signer (drop-in replacement for HMAC-SHA256)
apps/cli/                — CLI tool (10 commands)
apps/dashboard/          — Web dashboard (Express + HTML/CSS/JS)
hooks/                   — Claude Code PostToolUse hook (signal-detector.py)
```

Data is stored under `~/.hive-exp/` by default:

```
~/.hive-exp/
├── experiences/
│   ├── provisional/   — New, unreviewed experiences
│   ├── promoted/      — Human-confirmed trusted experiences
│   └── archived/      — Auto-archived (zero-ref, low-confidence, consecutive fail)
├── events/            — Append-only JSONL event log (yyyy-mm.jsonl)
├── db.sqlite          — SQLite projection for fast queries
└── signal-conventions.yaml
```

## How It Compares

| Feature | hive-exp | Mem0 | Letta | Vector DB |
|---------|----------|------|-------|-----------|
| Structured signal→strategy→outcome | Yes | No (free-form text) | No | No |
| Multi-agent cross-vendor sharing | Yes | No | No | No |
| Human-in-the-loop promotion | Yes | No | Limited | No |
| MCP native (zero adapter code) | Yes | No | No | No |
| Confidence decay + auto-archival | Yes | No | No | No |
| Zero external dependencies (no Docker/Postgres/Neo4j) | Yes | No | No | No |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

---

*Python SDK coming soon.*
