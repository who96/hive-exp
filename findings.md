# Phase 0.5 Implementation Findings

## Design Specs Extracted

### Experience Record Schema v1.1.0 (§4.2)
Key fields: id, schema_version, signals[], scope, preconditions[], strategy{name,description,category}, outcome{status,evidence,evidence_digest,blast_radius}, confidence, source_agent, signature, promoted, provisional, provisional_deadline, supersedes, superseded_by, risk_level, created, last_confirmed, decay_halflife_days, archived, archived_reason

Removed from original: usage_stats (→ events+SQLite), corrections (→ supersedes/superseded_by), auto_promoted (→ provisional)

### Event Schema (§4.5)
Envelope: event_id, type, timestamp, source_agent, signature, payload
11 event types: experience.created, .referenced, .outcome_recorded, .promoted, .provisional, .provisional_expired, .archived, .quarantined, .superseded, confidence.decayed, strategy.banned

### SQLite Projection (§4.6)
Tables: usage_log (PK: event_id), experience_meta (PK: exp_id)
Views: experience_stats (aggregates usage_log by exp_id), strategy_stats (joins experience_meta + usage_log)
Also need: banned_strategies table (from strategy.banned events)

### Data Directory Structure (§4.1)
Root: ~/.agents/shared-knowledge/
- experiences/{agent}/*.yaml — immutable snapshots
- events/events-{YYYY}-{MM}.jsonl — append-only truth
- hive-exp.db — SQLite WAL projection
- memory-graph.jsonl — causal chains
- promoted/, quarantine/, archived/
- config.yaml, signal-conventions.yaml
- .keys/{agent}.key

### Replay Mapping (§4.6)
- experience.created → INSERT experience_meta
- experience.referenced → INSERT usage_log (result=NULL)
- experience.outcome_recorded → UPDATE usage_log SET result
- experience.promoted → UPDATE experience_meta SET promoted=1
- experience.archived → UPDATE experience_meta SET archived=1
- experience.superseded → UPDATE experience_meta SET superseded_by
- confidence.decayed → no SQL (computed at query time)
- strategy.banned → INSERT banned_strategies

## Technical Decisions
- Use Vitest for testing (fast, ESM-native, TypeScript first-class)
- Use tsup for build (esbuild-based, simple config)
- Use better-sqlite3 for SQLite (synchronous, no external deps beyond native addon)
- pnpm workspace for monorepo
