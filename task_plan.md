# Phase 1→3 Implementation Plan

> Phase 0.5 (@hive-exp/core) — COMPLETE (148 tests, 1610 LOC)
> Phase 1 starts from commit f9f74b1 on main

## Architecture

```
Controller (Opus 4.6)           Workers (Sonnet via Agent tool)
  Plan → Dispatch → Verify        Implement in isolated worktrees
        → Merge to main           Self-test before reporting back
```

---

## Phase 1: MCP Server + CLI + Hook

### Wave 1 (parallel, no deps) [status: in_progress]

| Branch | Task | Status |
|--------|------|--------|
| feat/phase1-wave1-mcp-server | MCP Server skeleton — stdio + 5 tool stubs + @hive-exp/core import | pending |
| feat/phase1-wave1-cli-scaffold | CLI skeleton — 10 commands registered with stub output | pending |
| feat/phase1-wave1-hook-script | signal-detector.py — load patterns from YAML, not hardcoded | pending |

### Wave 2 (depends on Wave 1) [status: pending]

| Branch | Task | Status |
|--------|------|--------|
| feat/phase1-wave2-mcp-tools | 5 MCP tool full implementations (query/record/outcome/stats/promote) | pending |
| feat/phase1-wave2-cli-commands | CLI all command implementations (call core API) | pending |

### Wave 3 (depends on Wave 2) [status: pending]

| Branch | Task | Status |
|--------|------|--------|
| feat/phase1-wave3-integration | E2E integration tests — MCP start + CLI write + query + outcome + promote | pending |
| feat/phase1-wave3-agent-config | Agent config templates + hive-exp init auto-detect MCP config | pending |

### Phase 1 Acceptance Criteria
- [ ] `npx @hive-exp/mcp` starts, 5 tools callable by Agent
- [ ] `hive-exp` CLI all commands work
- [ ] `hive-exp init` auto-detects Claude Code/Codex/Gemini/Antigravity
- [ ] signal-detector.py loads patterns from config, not hardcoded
- [ ] E2E: record → query → outcome → stats full chain
- [ ] hive-exp promote requires interactive confirmation

---

## Phase 2: Dashboard + Advanced Features

### Wave 1 (parallel, depends on Phase 1) [status: pending]

| Branch | Task | Status |
|--------|------|--------|
| feat/phase2-wave1-dashboard-scaffold | Dashboard skeleton — Express + static frontend + localhost:3721 | pending |
| feat/phase2-wave1-consensus | Cross-agent consensus detection | pending |
| feat/phase2-wave1-decay-cron | Confidence decay cron + 3 auto-archival rules | pending |

### Wave 2 (depends on P2W1) [status: pending]

| Branch | Task | Status |
|--------|------|--------|
| feat/phase2-wave2-dashboard-overview | P0: System overview — agent status + experience count + pending badge | pending |
| feat/phase2-wave2-dashboard-review | P0: Experience review table — per-agent grouping + promote/quarantine | pending |
| feat/phase2-wave2-dashboard-audit | P0: Audit log — events.jsonl realtime stream | pending |

### Wave 3 (depends on P2W2) [status: pending]

| Branch | Task | Status |
|--------|------|--------|
| feat/phase2-wave3-dashboard-stats | P1: Strategy stats panel + experience leaderboard (Chart.js) | pending |
| feat/phase2-wave3-export | hive-exp export --format json --min-confidence 0.8 | pending |
| feat/phase2-wave3-ed25519 | @hive-exp/signer-ed25519 optional package | pending |

---

## Phase 3: Open Source Release + Cold Start

### Wave 1 (parallel, depends on Phase 2) [status: pending]

| Branch | Task | Status |
|--------|------|--------|
| feat/phase3-wave1-docs | README + Contributing + Adapter Guide + LICENSE (MIT) | pending |
| feat/phase3-wave1-ci | GitHub Actions CI — lint + test + build | pending |
| feat/phase3-wave1-seed-data | OpenClaw cold start — 20-30 structured experiences | pending |

### Wave 2 (depends on P3W1) [status: pending]

| Branch | Task | Status |
|--------|------|--------|
| feat/phase3-wave2-npm-publish | npm publish prep — package.json + npm pack verify | pending |
| feat/phase3-wave2-community | Issue/PR templates + Discussion categories | pending |
| feat/phase3-wave2-letta-doc | Letta/Mem0 integration docs | pending |

---

## Decisions Locked

| Decision | Choice | Notes |
|----------|--------|-------|
| Python SDK | Phase 4 (community) | README: "Python SDK coming soon" |
| Ed25519 | Phase 2 Wave 3 optional pkg | core SignerInterface already pluggable |
| ARC params | Defaults, adaptive_risk_enabled: false | Toggle preserved |
| RAG | Export command only, no integration | --format json --min-confidence |
| Letta adapter | Docs only, no code | Describe how to integrate |
| Cold start | 20-30 OpenClaw experiences | Via xiaohongshu-mcp + GitHub issues |

## Errors Encountered
| Error | Phase | Resolution |
|-------|-------|------------|
| (none yet) | | |
