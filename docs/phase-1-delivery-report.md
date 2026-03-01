# Phase 1 Delivery Report — MCP Server + CLI + Hook

> **Date**: 2026-03-02
> **Status**: Complete
> **Packages**: `@hive-exp/mcp@0.1.0`, `hive-exp@0.1.0` (CLI)

---

## 1. Summary

Phase 1 delivers the MCP Server, CLI tool, and Claude Code hook — completing the agent integration layer. 209 tests pass across 5 test suites (148 core + 19 MCP + 23 CLI + 11 E2E + 8 Python hook).

## 2. Module Inventory

| Module | Files | Key Deliverables | Tests | Status |
|--------|-------|------------------|-------|--------|
| MCP Server | 10 source + 1 test | stdio server, 5 tool handlers, context management | 19 | Done |
| CLI | 14 source + 2 test | 10 commands, context, utils | 23 | Done |
| Hook | 2 source + 1 test + 1 README | signal-detector.py, signal-conventions.yaml | 8 | Done |
| Config Templates | 9 templates + README | 6 agent types: Claude Code, Codex, Gemini, Antigravity, Cursor, Windsurf | — | Done |
| E2E Integration | 1 test file | 11 integration tests, 6 test suites | 11 | Done |

## 3. MCP Server — 5 Tools

| Tool | Description | Implementation |
|------|-------------|----------------|
| `hive_exp_query` | Search experiences by signal | Signal normalization → file scan → stats enrichment → confidence decay → sort |
| `hive_exp_record` | Record new experience | Normalize → sanitize → sign → validate → write JSON → event → project |
| `hive_exp_outcome` | Record outcome after applying strategy | Verify exp → reference event → outcome event → project |
| `hive_exp_stats` | Strategy statistics | overview / strategy_ranking / at_risk modes |
| `hive_exp_promote` | Propose promotion | Sets pending_promotion only — human confirms via CLI |

## 4. CLI — 10 Commands

| Command | Description |
|---------|-------------|
| `hive-exp init` | Auto-detect agents, generate MCP config (--force to apply) |
| `hive-exp add` | Add experience from flags or --file |
| `hive-exp validate` | Validate experience against schema |
| `hive-exp sign` | Sign experience with HMAC-SHA256 |
| `hive-exp query` | Query experiences by signal/strategy/scope |
| `hive-exp promote` | Promote experience (--confirm required) |
| `hive-exp archive` | Archive experience with reason |
| `hive-exp stats` | Show statistics (overview/strategy_ranking/at_risk) |
| `hive-exp replay` | Rebuild SQLite projection from events |
| `hive-exp export` | Export for RAG (--min-confidence, --format json) |

## 5. Acceptance Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| `npx @hive-exp/mcp` starts, 5 tools callable | **PASS** | server.ts + 5 handlers + 19 MCP tests |
| `hive-exp` CLI all commands work | **PASS** | 10 commands implemented, 23 CLI tests |
| `hive-exp init` auto-detects 6 agent types | **PASS** | 11 init-specific tests |
| signal-detector.py loads from YAML config | **PASS** | 8 Python tests, YAML-first with fallback |
| E2E: record → query → outcome → stats chain | **PASS** | 11 integration tests (full lifecycle) |
| `hive-exp promote` requires --confirm | **PASS** | MCP only sets pending_promotion |

## 6. Architecture Decisions

1. **Context pattern**: `createContext()` factory initializes all core components (EventWriter, Projector, StatsAggregator, Signer) from a data directory.
2. **Experience files as JSON**: Stored as `.json` in `~/.hive-exp/experiences/{provisional,promoted,archived}/`. JSON chosen over YAML for zero-dependency simplicity.
3. **Singleton data dir**: `HIVE_EXP_HOME` env var or `~/.hive-exp/`. Auto-created on first use.
4. **Promote two-step**: MCP sets `pending_promotion: true`, CLI `promote --confirm` actually moves file + updates state.
5. **Init safe merge**: Never overwrites existing agent config entries. Detects 6 agents, supports JSON + TOML formats.
6. **Default signer secret**: SHA-256 of `hostname-username-hive-exp`. Overridable via `HIVE_EXP_SECRET` env var.

## 7. Git History (Phase 1)

```
adeeb3c feat(cli): agent config templates + enhanced init command
a2b4d4a feat(test): end-to-end integration tests for MCP + CLI
931597e feat(cli): implement all 10 CLI commands with full business logic
d1ecbd8 feat(mcp): implement 5 MCP tool handlers with full business logic
2ed276c chore: add Python cache to .gitignore
da297fc feat(hook): signal-detector.py — PostToolUse hook for Claude Code
9fd8730 feat(cli): CLI skeleton — 10 commands registered with stubs
7c7b34c feat(mcp): MCP Server skeleton — stdio + 5 tool stubs
```

## 8. Next Steps (Phase 2)

- Dashboard (Express + static HTML/CSS/JS + Chart.js) at localhost:3721
- Cross-agent consensus detection
- Confidence decay cron + auto-archival rules
- `hive-exp export` enhancement
- `@hive-exp/signer-ed25519` optional package
