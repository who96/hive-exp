# Integrating hive-exp with Letta and Mem0

> **Date**: 2026-03-02
> **Status**: v1.0
> **Scope**: Practical guide for bridging hive-exp with Letta and Mem0

---

## 1. Introduction

Three distinct layers exist in the modern AI agent memory stack:

- **hive-exp** — structured experience management. Stores *what worked*: verifiable, outcome-tracked three-tuples of `signal → strategy → outcome`. Every record has a confidence score, a cryptographic signature, and a decay schedule. It answers: "When I see this error pattern, which strategy has a proven success rate?"

- **Letta** (formerly MemGPT) — stateful agent memory with an OS metaphor. Manages *what the agent knows right now*: Core Memory (RAM), Recall Memory (searchable history), and Archival Memory (long-term cold storage). It answers: "What context does this agent need to carry across conversations?"

- **Mem0** — personalized AI memory. Extracts and stores *what was said and preferred*: user facts, preferences, and organizational knowledge extracted from conversations via LLM. It answers: "What does this user consistently care about?"

This guide explains how to export hive-exp experiences and feed them into Letta's Archival Memory or Mem0's long-term memory store — extending both systems with structured, outcome-verified institutional knowledge.

**Integration model**: hive-exp is the source of truth for *proven solutions*. Letta and Mem0 are downstream consumers that can query this knowledge base to inform agent behavior without owning the experience lifecycle (recording, outcome tracking, confidence decay, promotion).

---

## 2. hive-exp Export API

The CLI export command produces a self-contained JSON envelope suitable for ingestion by downstream systems:

```bash
hive-exp export --format json --min-confidence 0.8
```

**Common flags**:

| Flag | Description | Default |
|------|-------------|---------|
| `--format` | Output format: `json`, `yaml`, `csv` | `json` |
| `--min-confidence` | Minimum confidence threshold (0.0–1.0) | `0.0` |
| `--scope` | Filter by scope: `universal`, `language`, `project` | all |
| `--since` | ISO 8601 date — only export experiences updated after this date | none |
| `--out` | Output file path; defaults to stdout | stdout |
| `--promoted-only` | Only include experiences that have been human-confirmed | `false` |

**Output envelope structure**:

```json
{
  "version": "1.0",
  "exported_at": "2026-03-02T10:00:00Z",
  "total": 42,
  "filters": {
    "min_confidence": 0.8,
    "scope": "universal"
  },
  "experiences": [
    {
      "exp_id": "exp_1709280000_a1b2c3d4",
      "signals": ["tsc_error", "module_not_found"],
      "strategy": {
        "name": "check_tsconfig_paths",
        "description": "Verify tsconfig.json paths mapping and baseUrl. Missing baseUrl causes module resolution failures for path aliases.",
        "category": "repair"
      },
      "outcome": {
        "status": "success",
        "evidence_digest": "sha256:ab12cd34...",
        "blast_radius": {
          "files": 2,
          "lines": 15
        }
      },
      "confidence": 0.87,
      "stats": {
        "ref_count": 23,
        "success_count": 20,
        "success_rate": 0.87
      },
      "scope": "universal",
      "preconditions": ["TypeScript >= 5.0"],
      "risk_level": "low",
      "provisional": false,
      "promoted": true,
      "created_at": "2026-02-10T08:30:00Z",
      "updated_at": "2026-03-01T14:20:00Z"
    }
  ]
}
```

**Key fields for downstream integration**:

- `signals` — error pattern tags, usable as searchable keywords or embedding inputs
- `strategy.description` — the human-readable explanation of what to do
- `confidence` — a float in [0, 1] derived from `success_rate` with a 30-day decay applied
- `promoted` — boolean indicating human confirmation; use this flag to gate high-trust ingestion
- `provisional` — if `true`, the experience is still in observation period and should be treated with lower weight

---

## 3. Integrating with Letta

Letta's **Archival Memory** is the right target for hive-exp experiences. Archival Memory is designed for large amounts of external knowledge that an agent can search on demand — exactly the role hive-exp experiences play.

### Conceptual mapping

| hive-exp field | Letta Archival Memory field |
|---|---|
| `signals` | Tags in the `text` blob; also used as search queries |
| `strategy.description` | Primary content of the archival entry `text` |
| `confidence` | Embedded as a metadata string in `text` (Letta has no native weight field) |
| `exp_id` | Prefix in `text` for traceability |
| `promoted` | Gate condition: only ingest promoted experiences for high-trust use |

### Python pseudocode

```python
import json
import subprocess

# Step 1: Export hive-exp experiences above confidence threshold
result = subprocess.run(
    ["hive-exp", "export", "--format", "json", "--min-confidence", "0.8", "--promoted-only"],
    capture_output=True,
    text=True,
    check=True,
)
export_data = json.loads(result.stdout)

# Step 2: Connect to Letta (adjust server URL and agent ID as needed)
from letta import create_client

client = create_client()  # connects to local Letta server by default
agent_id = "agent-<your-agent-id>"

# Step 3: Map each hive-exp experience to a Letta archival memory entry
for exp in export_data["experiences"]:
    signals_tag = ", ".join(exp["signals"])
    content = (
        f"[hive-exp:{exp['exp_id']}] "
        f"Signals: {signals_tag} | "
        f"Strategy: {exp['strategy']['name']} — {exp['strategy']['description']} | "
        f"Success rate: {exp['stats']['success_rate']:.0%} "
        f"({exp['stats']['ref_count']} references) | "
        f"Confidence: {exp['confidence']:.2f} | "
        f"Risk: {exp['risk_level']}"
    )

    # Only insert if not already present (check by exp_id prefix)
    existing = client.get_archival_memory(agent_id, query=exp["exp_id"], limit=1)
    if not existing or exp["exp_id"] not in existing[0].text:
        client.insert_archival_memory(agent_id, memory=content)
        print(f"Inserted: {exp['exp_id']}")
    else:
        # Update: delete old entry and re-insert with fresh stats
        client.delete_archival_memory(agent_id, id=existing[0].id)
        client.insert_archival_memory(agent_id, memory=content)
        print(f"Updated: {exp['exp_id']}")
```

### Agent behavior after ingestion

Once experiences are in Letta's Archival Memory, the agent can retrieve them with a natural language search. The agent's system prompt should instruct it to query archival memory when it encounters errors:

```
When you encounter a build error, test failure, or lint error, search your archival memory
for entries beginning with "[hive-exp:" to find proven strategies before attempting a fix.
```

### Sync schedule

Archival Memory entries do not auto-expire in Letta. Run the ingestion script periodically (e.g., daily via cron) with the `--since` flag to ingest only updated experiences:

```bash
hive-exp export --format json --min-confidence 0.8 --since $(date -d "1 day ago" -I) | python3 letta_ingest.py
```

---

## 4. Integrating with Mem0

Mem0's `add()` API accepts arbitrary text and associates it with a `user_id`, `agent_id`, or `run_id`. For hive-exp integration, use a stable `agent_id` that represents the shared experience pool (not tied to any individual user).

### Conceptual mapping

| hive-exp field | Mem0 memory field |
|---|---|
| `signals` | Included in memory text; also drives semantic retrieval via embedding |
| `strategy.description` | Core of the memory `messages` content |
| `confidence` | Embedded as a string annotation in content |
| `exp_id` | Included as a prefix for deduplication and traceability |
| `scope` | Becomes a Mem0 category label if using structured metadata |

### Python pseudocode

```python
import json
import subprocess
from mem0 import Memory

# Step 1: Export hive-exp experiences
result = subprocess.run(
    ["hive-exp", "export", "--format", "json", "--min-confidence", "0.75"],
    capture_output=True,
    text=True,
    check=True,
)
export_data = json.loads(result.stdout)

# Step 2: Initialize Mem0 (self-hosted or cloud)
config = {
    "vector_store": {
        "provider": "qdrant",
        "config": {"host": "localhost", "port": 6333},
    }
}
memory = Memory.from_config(config)

# Use a stable agent_id that represents the shared hive-exp knowledge pool
HIVE_EXP_AGENT_ID = "hive-exp-knowledge-pool"

# Step 3: Map each experience to a Mem0 long-term memory
for exp in export_data["experiences"]:
    signals_str = " | ".join(exp["signals"])
    preconditions_str = (
        "; ".join(exp.get("preconditions", [])) or "none"
    )

    # Format as a factual statement Mem0 can extract and store
    memory_text = (
        f"When encountering error signals [{signals_str}], "
        f"the proven strategy is: {exp['strategy']['description']} "
        f"(strategy id: {exp['strategy']['name']}, "
        f"category: {exp['strategy']['category']}, "
        f"success rate: {exp['stats']['success_rate']:.0%}, "
        f"confidence: {exp['confidence']:.2f}, "
        f"preconditions: {preconditions_str}, "
        f"risk: {exp['risk_level']}, "
        f"hive-exp id: {exp['exp_id']})"
    )

    messages = [{"role": "system", "content": memory_text}]

    # Add to Mem0; Mem0's LLM will decide whether to ADD, UPDATE, or MERGE
    result = memory.add(
        messages,
        agent_id=HIVE_EXP_AGENT_ID,
        metadata={
            "source": "hive-exp",
            "exp_id": exp["exp_id"],
            "scope": exp["scope"],
            "confidence": exp["confidence"],
        },
    )
    print(f"Mem0 result for {exp['exp_id']}: {result}")

# Step 4: Search usage example
search_results = memory.search(
    query="TypeScript module not found error",
    agent_id=HIVE_EXP_AGENT_ID,
    limit=3,
)
for item in search_results["results"]:
    print(item["memory"])
```

### Important limitations with Mem0

Mem0 uses an LLM to decide how to process each memory (ADD, UPDATE, MERGE, DELETE). This means:

1. **No guaranteed deduplication**: Running the ingestion twice may result in merged or updated entries rather than exact overwrites. The `exp_id` embedded in the text helps, but Mem0's extraction is probabilistic.

2. **No confidence decay awareness**: Mem0 does not understand that hive-exp confidence scores decay over time. Re-run ingestion regularly to refresh memories with updated scores.

3. **Semantic drift**: Mem0 may rephrase or merge the stored content. Retrieve by `exp_id` substring if you need exact traceability. Use the `metadata` field for structured filtering.

4. **Cloud vs. self-hosted**: The `MemoryClient` (cloud) does not support the `agent_id` parameter in the same way as the self-hosted `Memory` class. Adjust accordingly for your deployment.

---

## 5. Building a Custom Adapter

For deeper integration — bidirectional sync, real-time streaming, or embedding into a custom agent framework — you can build an adapter directly against hive-exp's filesystem layout.

### SignerInterface pattern

hive-exp uses a `SignerInterface` for signing experience records. If your adapter needs to write experiences back to hive-exp (bidirectional sync), implement the interface:

```typescript
// packages/core/src/signer/interface.ts (reference)
export interface SignerInterface {
  sign(payload: string): Promise<string>;
  verify(payload: string, signature: string): Promise<boolean>;
  publicKey(): string;
}
```

The default implementation in `@hive-exp/signer-ed25519` uses Ed25519 keys stored at `~/.hive-exp/keys/`. Custom adapters can supply alternative signers (e.g., cloud KMS-backed).

### Event log filesystem layout

All hive-exp state is derived from append-only JSONL event logs stored at:

```
~/.hive-exp/
├── events/
│   ├── events-2026-02.jsonl   # one file per month
│   └── events-2026-03.jsonl
├── experiences/
│   └── <exp_id>/
│       └── experience.yaml    # current state snapshot
├── db/
│   └── hive-exp.sqlite        # SQLite projection for fast queries
└── keys/
    ├── signing.private.pem
    └── signing.public.pem
```

**Event log format** (each line is a JSON object):

```json
{
  "event_type": "experience.created",
  "exp_id": "exp_1709280000_a1b2c3d4",
  "timestamp": "2026-02-10T08:30:00Z",
  "payload": { "...": "full experience record at creation time" },
  "signature": "ed25519:base64..."
}
```

Event types include: `experience.created`, `experience.outcome_recorded`, `experience.promoted`, `experience.archived`.

### Filesystem polling adapter (Python example)

```python
import json
import time
import glob
import os
from pathlib import Path
from datetime import datetime, timezone

HIVE_EXP_EVENTS_DIR = Path.home() / ".hive-exp" / "events"

def tail_event_log(last_seen_offset: dict[str, int]) -> list[dict]:
    """
    Poll event log files for new events since last check.
    last_seen_offset maps filename -> byte offset of last read position.
    Returns list of new events in chronological order.
    """
    new_events = []
    event_files = sorted(HIVE_EXP_EVENTS_DIR.glob("events-*.jsonl"))

    for event_file in event_files:
        filename = event_file.name
        offset = last_seen_offset.get(filename, 0)

        with open(event_file, "r") as f:
            f.seek(offset)
            for line in f:
                line = line.strip()
                if line:
                    try:
                        event = json.loads(line)
                        new_events.append(event)
                    except json.JSONDecodeError:
                        pass  # skip malformed lines
            last_seen_offset[filename] = f.tell()

    return new_events


def should_ingest(event: dict) -> bool:
    """
    Decide whether a new event warrants updating the downstream system.
    Only ingest on creation or promotion; outcome updates change stats
    but do not require immediate downstream sync.
    """
    return event.get("event_type") in {
        "experience.created",
        "experience.promoted",
    }


# Example polling loop — integrate into your adapter's main loop
offsets: dict[str, int] = {}
while True:
    events = tail_event_log(offsets)
    for event in events:
        if should_ingest(event):
            exp_id = event["exp_id"]
            # Read current experience snapshot from YAML
            experience_path = (
                Path.home() / ".hive-exp" / "experiences" / exp_id / "experience.yaml"
            )
            if experience_path.exists():
                # ingest_to_downstream(experience_path)  # your integration here
                print(f"New event {event['event_type']} for {exp_id}")
    time.sleep(5)  # poll every 5 seconds; tune to your latency requirements
```

### Bidirectional sync considerations

Writing experiences *back* to hive-exp from Letta or Mem0 is more complex and carries risks:

1. **Authenticity**: hive-exp requires all experiences to be signed by a registered signer. A sync adapter writing back to hive-exp must hold a valid signing key.

2. **Signal normalization**: hive-exp enforces a Signal Semantic Convention (stored in `~/.hive-exp/signal-conventions.yaml`). Free-text memories from Letta or Mem0 must be mapped to normalized signal names before recording. Use the MCP tool `hive_exp_record` instead of writing to the filesystem directly — it handles normalization.

3. **Duplication**: Without deduplication, bidirectional sync can create duplicate experiences. Use `exp_id` as the idempotency key. Before calling `hive_exp_record`, query with `hive_exp_query` to check whether a similar experience already exists.

4. **Outcome pollution**: Experiences written from downstream systems lack verified outcome evidence (`evidence_digest`). Mark them as `provisional: true` and set `risk_level: "medium"` until a hive-exp agent verifies the outcome.

5. **Recommended path**: Rather than a fully automated bidirectional sync, prefer a human-in-the-loop workflow: Letta/Mem0 surfaces candidate experiences, a human reviews them via the hive-exp Dashboard, and then approves them with `hive-exp promote --confirm <exp_id>`.

---

## 6. Comparison Table

| Dimension | hive-exp | Letta | Mem0 |
|---|---|---|---|
| **What is stored** | Structured solving experiences: `signal → strategy → outcome` | Agent conversation state: Core / Recall / Archival memory layers | User and organizational facts extracted from conversations |
| **Data model** | Strongly typed YAML schema with required fields and enum constraints | Layered text blocks; Core Memory has a schema, Archival is free-text | Semi-structured; Graph tier adds entity-relation triples (Pro only) |
| **Provenance** | Cryptographic HMAC/Ed25519 signature on every record; `evidence_digest` field links to verification artifacts | No provenance mechanism; memory text is trusted as-is | No provenance; LLM extraction is probabilistic |
| **Outcome tracking** | First-class: `outcome.status` (success/failed/partial) + `success_rate` updated per reference | Not supported | Not supported |
| **Confidence & decay** | Confidence score with 30-day half-life decay; auto-archival at 90 days zero-reference | No decay mechanism | No decay mechanism |
| **Multi-agent sharing** | Designed for cross-agent cross-tool sharing via MCP protocol | Per-agent state; shared only through Letta's Conversations API | Shared via `user_id` / `org_id` namespacing; known memory leakage issues across agents |
| **Human verification** | Explicit promotion workflow: pending → human confirms → promoted; Dashboard UI | No promotion concept | No promotion concept |
| **Scope of knowledge** | Error resolution strategies, engineering patterns, reusable technical playbooks | Agent's own working context and task history | User preferences, personal facts, organizational policies |
| **Self-hosted** | Yes — local-first, SQLite + JSONL, zero external dependencies | Yes — requires Letta server | Yes (complex: FastAPI + Postgres + Qdrant) or cloud API |
| **Relationship** | Source of truth for proven solutions | Downstream consumer for agent context | Downstream consumer for personalization |

**Summary**: hive-exp, Letta, and Mem0 occupy different layers of the agent knowledge stack and are complementary. The ideal setup is:

```
hive-exp    →  "What strategy has a proven 87% success rate for tsc_error?"
Letta       →  "What is this agent currently working on and what did it decide?"
Mem0        →  "What does this user prefer and what organizational policies apply?"
```

Each answers a different question. Integration between them amplifies all three rather than replacing any.

---

## Appendix: Quick Reference

### Export and ingest pipeline (minimal)

```bash
# Export high-confidence, human-promoted experiences
hive-exp export \
  --format json \
  --min-confidence 0.8 \
  --promoted-only \
  --out /tmp/hive-exp-export.json

# Feed into Letta (run your ingestion script)
python3 letta_ingest.py < /tmp/hive-exp-export.json

# Feed into Mem0 (run your ingestion script)
python3 mem0_ingest.py < /tmp/hive-exp-export.json
```

### MCP tools available during live agent sessions

If your Letta or Mem0 agent also has the `@hive-exp/mcp` server configured, it can query hive-exp directly at runtime without any ingestion step:

```
hive_exp_query  — retrieve top-N strategies for given error signals
hive_exp_record — record a new experience after a successful fix
hive_exp_outcome — record whether a referenced strategy actually worked
hive_exp_promote — propose a human-confirmation promotion for an experience
```

This is the preferred approach for real-time agent integration. The export-and-ingest pipeline described in this document is for offline batch enrichment of Letta/Mem0 knowledge bases.
