import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { HiveExpContext } from "../context.js";
import type { ToolHandler } from "./index.js";
import type { ExperienceRecord } from "@hive-exp/core";
import { normalizeSignal, effectiveConfidence } from "@hive-exp/core";
import * as fs from "node:fs";
import * as path from "node:path";

export const definition: Tool = {
  name: "hive_exp_query",
  description: "Query the hive-exp knowledge base for matching experiences based on error signals.",
  inputSchema: {
    type: "object",
    properties: {
      signals: { type: "array", items: { type: "string" }, description: "Error signals to match" },
      scope: { type: "string", enum: ["universal", "language", "project"], default: "universal" },
      limit: { type: "number", default: 3 },
    },
    required: ["signals"],
  },
};

function readExperienceFiles(dirs: string[]): { record: ExperienceRecord; dir: string }[] {
  const results: { record: ExperienceRecord; dir: string }[] = [];
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = fs.readFileSync(path.join(dir, entry), "utf-8");
        const record = JSON.parse(raw) as ExperienceRecord;
        if (record.id && record.signals) {
          results.push({ record, dir });
        }
      } catch {
        // skip malformed files
      }
    }
  }
  return results;
}

export function createHandler(ctx: HiveExpContext): ToolHandler {
  return async (args) => {
    const rawSignals = (args.signals ?? []) as string[];
    const scope = args.scope as string | undefined;
    const limit = typeof args.limit === "number" ? args.limit : 3;

    if (rawSignals.length === 0) {
      return { content: [{ type: "text", text: JSON.stringify({ matches: [], total_available: 0 }) }] };
    }

    const normalizedSignals = rawSignals.map(normalizeSignal);
    const signalSet = new Set(normalizedSignals);

    const all = readExperienceFiles([ctx.provisionalDir, ctx.promotedDir]);

    // Filter by signal intersection and scope
    const filtered = all.filter(({ record }) => {
      if (record.archived) return false;
      const hasOverlap = record.signals.some((s) => signalSet.has(s));
      if (!hasOverlap) return false;
      if (scope && record.scope !== scope) return false;
      return true;
    });

    // Score and sort
    const scored = filtered.map(({ record, dir }) => {
      const stats = ctx.aggregator.getExperienceStats(record.id);
      const decayed = effectiveConfidence(
        record.confidence,
        record.last_confirmed,
        record.decay_halflife_days,
      );
      const successRate = stats?.success_rate ?? 0.5;
      const score = decayed * successRate;
      const isProvisional = dir === ctx.provisionalDir;

      return {
        exp_id: record.id,
        signals: record.signals,
        strategy: record.strategy,
        confidence: Math.round(decayed * 1000) / 1000,
        stats: stats
          ? { ref_count: stats.ref_count, success_rate: stats.success_rate ?? 0 }
          : { ref_count: 0, success_rate: 0 },
        preconditions: record.preconditions ?? [],
        provisional: isProvisional,
        risk_level: record.risk_level ?? "low",
        score,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    const matches = scored.slice(0, limit).map(({ score: _score, ...rest }) => rest);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ matches, total_available: scored.length }),
      }],
    };
  };
}

// Backward compat stub (unused when context injection is active)
export async function handler(_args: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ matches: [], total_available: 0 }) }],
  };
}
