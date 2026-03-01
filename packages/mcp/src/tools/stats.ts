import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { HiveExpContext } from "../context.js";
import type { ToolHandler } from "./index.js";
import type { ExperienceRecord } from "@hive-exp/core";
import { effectiveConfidence } from "@hive-exp/core";
import * as fs from "node:fs";

export const definition: Tool = {
  name: "hive_exp_stats",
  description: "Retrieve statistics about stored experiences, strategy rankings, and at-risk patterns.",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["overview", "strategy_ranking", "at_risk"], default: "overview" },
    },
  },
};

function countJsonFiles(dir: string): number {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

function readAllExperiences(dirs: string[]): ExperienceRecord[] {
  const results: ExperienceRecord[] = [];
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
        const raw = fs.readFileSync(`${dir}/${entry}`, "utf-8");
        const record = JSON.parse(raw) as ExperienceRecord;
        if (record.id) results.push(record);
      } catch {
        // skip
      }
    }
  }
  return results;
}

export function createHandler(ctx: HiveExpContext): ToolHandler {
  return async (args) => {
    const statsType = (args.type as string) ?? "overview";

    if (statsType === "overview") {
      const provisional = countJsonFiles(ctx.provisionalDir);
      const promoted = countJsonFiles(ctx.promotedDir);
      const archived = countJsonFiles(ctx.archivedDir);
      const total = provisional + promoted + archived;

      // Count by signal category
      const allExps = readAllExperiences([ctx.provisionalDir, ctx.promotedDir]);
      const signalCategories: Record<string, number> = {};
      for (const exp of allExps) {
        for (const signal of exp.signals) {
          signalCategories[signal] = (signalCategories[signal] ?? 0) + 1;
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            type: "overview",
            counts: { total, provisional, promoted, archived },
            signal_distribution: signalCategories,
          }),
        }],
      };
    }

    if (statsType === "strategy_ranking") {
      const rankings = ctx.aggregator.getAllStrategyStats({
        sortBy: "success_rate",
        order: "desc",
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            type: "strategy_ranking",
            rankings: rankings.map((r) => ({
              strategy_name: r.strategy_name,
              strategy_category: r.strategy_category,
              total_experiences: r.total_experiences,
              total_refs: r.total_refs,
              success_rate: r.success_rate,
            })),
          }),
        }],
      };
    }

    if (statsType === "at_risk") {
      const allExps = readAllExperiences([ctx.provisionalDir, ctx.promotedDir]);
      const atRisk: Array<{
        exp_id: string;
        confidence: number;
        ref_count: number;
        reason: string;
      }> = [];

      for (const exp of allExps) {
        const decayed = effectiveConfidence(
          exp.confidence,
          exp.last_confirmed,
          exp.decay_halflife_days,
        );
        const stats = ctx.aggregator.getExperienceStats(exp.id);
        const refCount = stats?.ref_count ?? 0;

        if (decayed < 0.3) {
          atRisk.push({
            exp_id: exp.id,
            confidence: Math.round(decayed * 1000) / 1000,
            ref_count: refCount,
            reason: refCount === 0 ? "zero_refs_and_low_confidence" : "low_confidence",
          });
        } else if (refCount === 0) {
          atRisk.push({
            exp_id: exp.id,
            confidence: Math.round(decayed * 1000) / 1000,
            ref_count: 0,
            reason: "zero_refs",
          });
        }
      }

      atRisk.sort((a, b) => a.confidence - b.confidence);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ type: "at_risk", experiences: atRisk }),
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ status: "error", message: `Unknown stats type: ${statsType}` }),
      }],
    };
  };
}

// Backward compat stub
export async function handler(_args: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ status: "not_implemented" }) }],
  };
}
