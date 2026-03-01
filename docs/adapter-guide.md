# hive-exp Adapter and Integration Guide

This guide covers the extension points in hive-exp: custom signers, RAG export, custom MCP tool handlers, and the public API surface of `@hive-exp/core`.

---

## 1. The SignerInterface Pattern

Every experience record and every event envelope carries a `signature` field. The signature algorithm is pluggable via the `SignerInterface`:

```typescript
// packages/core/src/types/index.ts
export interface SignerInterface {
  sign(data: string): string;
  verify(data: string, signature: string): boolean;
}
```

`sign` takes a JSON-serialized string and returns a prefixed signature string (e.g. `"hmac-sha256:..."` or `"ed25519:..."`). `verify` returns `true` if the signature is valid for the given data.

The built-in default is HMAC-SHA256, keyed from `~/.hive-exp/secret` (generated on first `hive-exp init`).

---

## 2. Creating a Custom Signer

To plug in a different signing algorithm, implement `SignerInterface` and pass the instance to the context.

### Example: Using the bundled Ed25519 signer

```typescript
import { createEd25519Signer } from '@hive-exp/signer-ed25519';

// Generate a new key pair (store the private key securely)
const signer = createEd25519Signer();
console.log(signer.getPrivateKey()); // hex-encoded DER PKCS8

// Reconstruct from a stored private key
import { createEd25519SignerFromHex } from '@hive-exp/signer-ed25519';
const signer2 = createEd25519SignerFromHex(process.env.HIVE_PRIVATE_KEY!);
```

### Example: Writing your own signer

```typescript
import type { SignerInterface } from '@hive-exp/core';

export function createMyCustomSigner(secret: string): SignerInterface {
  const PREFIX = 'my-algo:';
  return {
    sign(data: string): string {
      // compute signature using your algorithm
      const sig = myAlgo.sign(data, secret);
      return `${PREFIX}${sig}`;
    },
    verify(data: string, signature: string): boolean {
      if (!signature.startsWith(PREFIX)) return false;
      return myAlgo.verify(data, signature.slice(PREFIX.length), secret);
    },
  };
}
```

Pass the signer when constructing the CLI context or invoking core functions directly:

```typescript
import { createContext } from 'hive-exp/cli'; // internal — use createSigner from @hive-exp/core
import { createSigner } from '@hive-exp/core';

// The built-in factory currently only supports 'hmac-sha256'.
// For Ed25519 or custom algorithms, instantiate your signer directly
// and supply it wherever SignerInterface is expected.
```

---

## 3. Exporting Data for RAG Systems

The `export` CLI command serializes experiences to a flat JSON structure suitable for ingestion into a vector database or retrieval system.

```bash
# Export all promoted experiences with confidence >= 0.5
hive-exp export \
  --promoted-only \
  --min-confidence 0.5 \
  --output experiences.json
```

Output shape:

```json
{
  "exported_at": "2026-03-01T12:00:00.000Z",
  "filter": { "min_confidence": 0.5, "promoted_only": true },
  "count": 42,
  "experiences": [
    {
      "id": "exp_1709280000_a1b2c3d4",
      "signals": ["tsc_error", "module_not_found"],
      "strategy": {
        "name": "check_tsconfig_paths",
        "description": "Check tsconfig.json paths mapping and baseUrl configuration"
      },
      "confidence": 0.82,
      "source_agent": "claude-code",
      "scope": "universal",
      "risk_level": "low",
      "stats": { "ref_count": 23, "success_rate": 0.87 }
    }
  ]
}
```

To build a RAG pipeline on top of this:

1. Run `hive-exp export --output experiences.json` on a schedule (or as a post-promote hook).
2. Embed each experience's `strategy.description` (and optionally `signals`) into your vector store.
3. At query time, retrieve top-k experiences by embedding similarity.
4. Optionally re-rank by `confidence` or `stats.success_rate`.

The `@hive-exp/core` `MemoryGraphQuery` class provides programmatic access to the same data without going through the CLI:

```typescript
import { MemoryGraphQuery } from '@hive-exp/core';

const query = new MemoryGraphQuery({ dataDir: process.env.HIVE_DATA_DIR });
const results = await query.search({ signals: ['tsc_error'], limit: 5 });
```

---

## 4. Building a Custom MCP Tool Handler

All MCP tools live in `packages/mcp/src/tools/`. Each file exports a factory function returning a `{ definition, handler }` pair.

```typescript
// packages/mcp/src/tools/my_tool.ts
import type { McpTool } from '../types.js';
import { createContext } from '@hive-exp/core';

export function myTool(): McpTool {
  return {
    definition: {
      name: 'hive_exp_my_tool',
      description: 'A custom tool that does X.',
      inputSchema: {
        type: 'object',
        properties: {
          some_param: { type: 'string', description: 'Input parameter.' },
        },
        required: ['some_param'],
      },
    },

    async handler(args: { some_param: string }) {
      const ctx = createContext();
      // Use ctx.provisionalDir, ctx.promotedDir, ctx.aggregator, etc.
      return { result: `processed: ${args.some_param}` };
    },
  };
}
```

Register it in `packages/mcp/src/server.ts` and it will be available to all connected agents immediately — no per-agent adapter code required.

---

## 5. API Surface Overview

### `@hive-exp/core`

| Export | Description |
|--------|-------------|
| `validateExperience(record)` | Validate an `ExperienceRecord` against the JSON schema. Returns `{ valid, errors }`. |
| `normalizeSignal(name)` | Canonicalize a signal name using the conventions table (aliases → canonical). |
| `sanitizeSecurity(text)` | Strip secrets, tokens, and credentials from strategy descriptions. |
| `sanitizePrivacy(text)` | Strip PII (emails, IPs, paths) from strategy descriptions. |
| `createSigner({ algorithm, secret })` | Factory for the built-in HMAC-SHA256 signer. |
| `effectiveConfidence(confidence, lastConfirmed, halflifeDays)` | Compute time-decayed confidence score. |
| `EventWriter` | Append events to the JSONL event log. |
| `EventReader` | Read and filter events from the log. |
| `EventProjector` | Rebuild or incrementally sync the SQLite projection. |
| `MemoryGraphWriter` | Write experiences to the file store. |
| `MemoryGraphQuery` | Query experiences from the file store and SQLite. |
| `StatsAggregator` | Read strategy-level statistics from the SQLite projection. |
| `ConsensusDetector` | Detect when multiple agents agree on a strategy (promotes confidence). |
| `CronRunner` | Run scheduled tasks (decay, auto-archival, provisional expiry). |
| `Lifecycle` | Orchestrate the full lifecycle of an experience. |

### `@hive-exp/signer-ed25519`

| Export | Description |
|--------|-------------|
| `createEd25519Signer(options?)` | Create an Ed25519 signer. Generates a fresh key pair if no options supplied. |
| `createEd25519SignerFromHex(privateKeyHex)` | Reconstruct an Ed25519 signer from a hex-encoded PKCS8 private key. |

### Experience Schema (v1.1.0)

The canonical TypeScript type is `ExperienceRecord` exported from `@hive-exp/core`. Key fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | `"exp_{timestamp}_{hash8}"` |
| `signals` | `string[]` | Canonical signal names (see `signal-conventions.yaml`) |
| `scope` | `"project" \| "language" \| "universal"` | Applicability scope |
| `strategy.name` | `string` | Snake_case strategy identifier |
| `strategy.category` | `"repair" \| "optimize" \| "innovate"` | Strategy category |
| `outcome.status` | `"success" \| "failed" \| "partial"` | Outcome of applying the strategy |
| `outcome.blast_radius` | `{ files, lines }` | Complexity indicator (used for low-complexity filtering) |
| `confidence` | `number` (0–1) | Raw confidence, decayed over time by `effectiveConfidence()` |
| `provisional` | `boolean` | `true` until human promotes via CLI or dashboard |
| `promoted` | `boolean` | `true` after human confirmation |
| `archived` | `boolean` | `true` after auto-archival or manual archive |
| `signature` | `string` | `"hmac-sha256:..."` or `"ed25519:..."` |
