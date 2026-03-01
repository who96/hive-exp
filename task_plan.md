# Phase 0.5: @hive-exp/core Implementation Plan

## Goal
Implement the core library (`@hive-exp/core`) with 7 modules, forming the foundation for the MCP Server (Phase 1) and CLI.

## Design References
- `docs/review-convergence-report.md` — §4.1-§4.7
- `docs/agent-integration-design.md` — §2 MCP Tool schemas

## Phases

### Phase 1: Project Scaffolding + Types + Schema [status: pending]
- Initialize monorepo: pnpm workspace, tsconfig, vitest, tsup
- `packages/core/src/types/index.ts` — All TypeScript types
- `packages/core/src/schema/experience.schema.json` — JSON Schema for experience record v1.1.0
- `packages/core/src/schema/event.schema.json` — JSON Schema for event envelope + 11 event types
- `packages/core/src/schema/validator.ts` — Schema validation functions
- `packages/core/src/schema/signal-conventions.ts` — 15+ signal convention names + normalization
- Tests: `schema.test.ts`

**Files**: ~12 files, ~800 lines estimated
**Route**: Codex (≥50 lines, L2 verification)

### Phase 2: Signer Module [status: pending]
- `packages/core/src/signer/interface.ts` — SignerInterface (sign/verify only, no key leakage)
- `packages/core/src/signer/hmac.ts` — HMAC-SHA256 default implementation
- Tests: `signer.test.ts`

**Files**: 3 files, ~150 lines estimated
**Route**: Codex (≥50 lines, L2 verification)

### Phase 3: Sanitizer Module [status: pending]
- `packages/core/src/sanitizer/security.ts` — OWASP top 10 + Unicode variants
- `packages/core/src/sanitizer/privacy.ts` — API keys, absolute paths, sensitive filenames
- Tests: `sanitizer.test.ts`

**Files**: 3 files, ~200 lines estimated
**Route**: Codex (≥50 lines, L2 verification)

### Phase 4: Events Module (Writer + Reader + Rotation) [status: pending]
- `packages/core/src/events/writer.ts` — append-only, flock, monthly rotation
- `packages/core/src/events/reader.ts` — multi-file reading, .gz support, line validation
- Tests: `events.test.ts`

**Files**: 3 files, ~300 lines estimated
**Route**: Codex (≥50 lines, L2 verification)

### Phase 5: SQLite Projector [status: pending]
- `packages/core/src/events/projector.ts` — events → SQLite projection, idempotent rebuild
- DDL: usage_log table, experience_meta table, experience_stats view, strategy_stats view
- 8 event type → SQL mapping rules
- Tests: `projector.test.ts`

**Files**: 2 files, ~350 lines estimated
**Route**: Codex (≥50 lines, L3 verification — DB schema changes)

### Phase 6: Memory Graph + Stats [status: pending]
- `packages/core/src/memory-graph/writer.ts` — causal chain append
- `packages/core/src/memory-graph/query.ts` — query by signal/strategy/agent
- `packages/core/src/stats/aggregator.ts` — strategy stats from SQLite views
- `packages/core/src/stats/decay.ts` — confidence decay (30-day half-life)
- Tests: `memory-graph.test.ts`, `stats.test.ts`

**Files**: 6 files, ~400 lines estimated
**Route**: Codex (≥50 lines, L2 verification)

### Phase 7: Conformance Tests + Index Export + Final Verification [status: pending]
- `packages/core/src/index.ts` — public API exports
- `packages/core/tests/conformance/` — MCP conformance test suite
- Full `npm test` pass
- Delivery report: `docs/phase-0.5-delivery-report.md`

**Files**: 3 files, ~200 lines estimated
**Route**: Codex (conformance suite) + Claude (verification + report)

## Key Design Constraints
1. Event Sourcing: events.jsonl = single mutable truth, SQLite = projection cache
2. Cold/hot separation: experience.yaml immutable, usage tracking in events + SQLite
3. Monthly rotation: `events-{YYYY}-{MM}.jsonl`, 6-month gzip
4. SignerInterface pluggable: sign(data)/verify(data,sig) only, key mgmt internal
5. Signal Convention: ≥15 canonical signal names in Phase 0.5
6. Zero external deps: Node.js built-ins + better-sqlite3 only
7. Projector idempotent: rebuild() from scratch = incremental projection

## Acceptance Criteria
- [ ] `npm test` all pass
- [ ] schema validator covers all required fields + type checks
- [ ] sanitizer covers OWASP top 10 injection + Unicode variants + privacy
- [ ] events writer: flock + monthly files + rotation
- [ ] projector: idempotent rebuild from events (delete SQLite, rebuild, verify)
- [ ] signal-conventions: ≥15 canonical names
- [ ] conformance test suite usable by future MCP Server
- [ ] signer interface abstract enough (no HMAC detail leakage)

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| (none yet) | | |
