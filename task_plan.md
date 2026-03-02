# Task Plan: hive-exp auto_approve Config + Dashboard UX Polish

## Goal
Implement auto_approve config system, Dashboard UX improvements (strategy search, detail view, Settings tab), and i18n corrections — as a single batch delivery.

## Current Phase
Phase 2

## Phases

### Phase 1: Architecture Design & User Alignment
- [x] Discuss auto_approve semantics with user
- [x] Align on config storage (config.json + env override)
- [x] Align on default value (true)
- [x] Align on granularity (boolean switch)
- [x] Align on Dashboard placement (Settings tab)
- [x] Align on i18n corrections
- [x] Address third-party review feedback (event audit trail)
- **Status:** complete

### Phase 2: Task Decomposition & Delegation
- [ ] Create task list with dependency ordering
- [ ] Write delegation task sheets per routing rules
- [ ] Dispatch to subagents
- **Status:** in_progress

### Phase 3: Implementation (Delegated)
- [ ] Task A: core/src/config.ts — config reader utility (depended on by B, C, D, F)
- [ ] Task B: MCP record tool — auto_approve branching (depends on A)
- [ ] Task C: Three context files — add autoApprove field (depends on A)
- [ ] Task D: Dashboard backend — Settings API + promote fix (depends on A, C)
- [ ] Task E: Dashboard frontend — Settings tab + search + detail + i18n (depends on D)
- [ ] Task F: CLI — config get/set command (depends on A, C)
- [ ] Task G: Tests for new functionality
- **Status:** pending

### Phase 4: Acceptance & Verification (L2)
- [ ] `pnpm exec tsc --noEmit` zero errors across all packages
- [ ] `pnpm run build` succeeds (all packages)
- [ ] Related tests pass
- [ ] Diff review — no broken existing behavior
- [ ] Manual: Dashboard loads, Settings tab works, search works, detail panel works
- **Status:** pending

### Phase 5: Delivery
- [ ] Summary to user
- [ ] Commit if requested
- **Status:** pending

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| config.json at ~/.hive-exp/ | Persistent, one-time set. Env var HIVE_EXP_AUTO_APPROVE overrides. |
| Default auto_approve=true | Single-user = zero friction. Team/repo admins set false. |
| Pure boolean switch | YAGNI. Conditional rules added later if needed. |
| Settings tab for toggle | Future-proof for more config options. |
| provisional="待审核", promoted="已通过" | Accurate semantics. Remove "待审阅" card. |
| Promote button → "通过" | Matches "审核通过" action verb. |
| Event payload: auto_approved=true | Audit trail distinguishes human vs auto approval. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| (none yet) | | |
