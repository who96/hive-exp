# Phase 0.5 Delivery Report — @hive-exp/core

> **Date**: 2026-03-02
> **Status**: Complete
> **Package**: `@hive-exp/core@0.1.0`

---

## 1. Summary

Phase 0.5 delivers the core library (`@hive-exp/core`) with 7 modules, 1,610 lines of source code, 2,642 lines of tests, and 148 passing tests across 9 test files. All acceptance criteria from the convergence report (§4.3) are met.

## 2. Module Inventory

| Module | Files | Lines | Tests | Status |
|--------|-------|-------|-------|--------|
| types/ | index.ts | 136 | (covered by schema) | Done |
| schema/ | experience.schema.json, event.schema.json, validator.ts, signal-conventions.ts | ~680 | 27 | Done |
| signer/ | interface.ts, hmac.ts | 55 | 9 | Done |
| sanitizer/ | security.ts, privacy.ts | ~240 | 20 | Done |
| events/ | writer.ts, reader.ts, projector.ts | ~400 | 30 (14 events + 16 projector) | Done |
| memory-graph/ | writer.ts, query.ts | ~200 | 16 | Done |
| stats/ | decay.ts, aggregator.ts | ~200 | 25 (11 decay + 14 aggregator) | Done |
| conformance/ | mcp-flow.test.ts | — | 21 | Done |
| **Total** | **19 source files** | **1,610** | **148** | **All pass** |

## 3. Acceptance Criteria Verification

| Criterion (§4.3) | Status | Evidence |
|-------------------|--------|----------|
| `npm test` all pass | **PASS** | 148/148 tests, 9/9 files |
| Schema validator covers all required fields + type checks | **PASS** | 27 schema tests (experience + event + conditional validation) |
| Sanitizer covers OWASP top 10 injection + Unicode variants | **PASS** | 20 tests: cmd injection, XSS, SQLi, path traversal, Unicode bypass, null bytes |
| Sanitizer covers privacy (API keys, paths, sensitive files) | **PASS** | Privacy tests: OpenAI/AWS/GitHub/Slack keys, absolute paths, emails, IPs |
| Events writer supports flock + monthly files + rotation | **PASS** | Lock file mechanism, `events-{YYYY}-{MM}.jsonl`, concurrent write test |
| Events projector idempotent rebuild from events.jsonl | **PASS** | rebuild() test: drop DB → replay → verify identical stats |
| Signal conventions >= 15 canonical names | **PASS** | 17 signals with aliases + regex detect patterns |
| Conformance test suite usable by future MCP Server | **PASS** | `tests/conformance/mcp-flow.test.ts` — full lifecycle test |
| SignerInterface abstract (no HMAC detail leakage) | **PASS** | Interface exposes only `sign(data): string` + `verify(data, sig): boolean` |
| `tsc --noEmit` zero errors | **PASS** | Clean typecheck |
| `tsup` build success | **PASS** | ESM + CJS + DTS output |

## 4. Architecture Decisions

1. **Event Sourcing**: `events/*.jsonl` = single mutable truth source. SQLite = projection cache. `experience.yaml` = immutable snapshot.
2. **Projector idempotency**: `rebuild()` drops all tables, replays from events. `incrementalSync()` uses checkpoint in `_projection_meta`.
3. **Signer pluggability**: `createSigner({ algorithm: 'hmac-sha256', secret })` factory. Ed25519 future-proofed via discriminated union.
4. **Sanitizer two-layer**: Security (code injection) + Privacy (API keys/paths). Both return `{ clean, violations/redactions }` for transparency.
5. **Signal conventions**: 17 canonical names with aliases + regex auto-detect. `normalizeSignal()` resolves free-form text to canonical.
6. **WAL mode**: SQLite opened with `pragma journal_mode = WAL` for concurrent reads.
7. **Lock file**: `.lock` file with `wx` exclusive flag + jittered retry for concurrent event writes.

## 5. Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| ajv | ^8.18.0 | JSON Schema validation |
| better-sqlite3 | ^11.10.0 | SQLite WAL projection |
| vitest | ^3.2.4 | Test runner (dev) |
| tsup | ^8.5.1 | Build (dev) |
| typescript | ^5.9.3 | Type checking (dev) |

## 6. Git History

```
b41cce1 feat: Wave 4 — index exports + MCP conformance test suite
ab2774f feat(aggregator): strategy stats queries from SQLite views
cde627e feat(projector): event-sourced SQLite projection with idempotent rebuild
a6dc2a5 Merge branch 'worktree-agent-a8e02c7e'
f400739 feat(events): append-only writer + multi-file reader with gzip support
f200105 feat(sanitizer): security + privacy sanitization
dd93d12 Merge branch 'worktree-agent-af0ec118'
b29db6d feat(memory-graph, stats): causal chain + confidence decay
1cb6ee0 feat(signer): HMAC-SHA256 implementation with pluggable interface
bbd8fe8 feat: Phase 0.5 scaffolding + Phase 1 schema/types/signals
```

## 7. Next Steps (Phase 1)

Phase 1 scope: `@hive-exp/mcp` — MCP stdio server wrapping `@hive-exp/core`:
- 5 MCP tools: `hive_exp_query`, `hive_exp_record`, `hive_exp_outcome`, `hive_exp_stats`, `hive_exp_promote`
- CLI: `hive-exp promote --confirm`, `hive-exp replay`, `hive-exp stats`
- Hook: `signal-detector.py` for Claude Code PostToolUse
- Estimated: 2 weeks
