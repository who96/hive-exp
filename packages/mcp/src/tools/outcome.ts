import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { HiveExpContext } from "../context.js";
import type { ToolHandler } from "./index.js";
import type { HiveEvent, ExperienceReferencedPayload, ExperienceOutcomePayload } from "@hive-exp/core";
import * as fs from "node:fs";
import * as crypto from "node:crypto";

export const definition: Tool = {
  name: "hive_exp_outcome",
  description: "Record the outcome of applying an experience (success/failed/partial).",
  inputSchema: {
    type: "object",
    properties: {
      exp_id: { type: "string" },
      result: { type: "string", enum: ["success", "failed", "partial"] },
    },
    required: ["exp_id", "result"],
  },
};

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function experienceExists(ctx: HiveExpContext, expId: string): boolean {
  const dirs = [ctx.provisionalDir, ctx.promotedDir, ctx.archivedDir];
  for (const dir of dirs) {
    try {
      if (fs.existsSync(`${dir}/${expId}.json`)) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

export function createHandler(ctx: HiveExpContext): ToolHandler {
  return async (args) => {
    const expId = args.exp_id as string;
    const result = args.result as "success" | "failed" | "partial";

    if (!experienceExists(ctx, expId)) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ status: "error", message: `Experience not found: ${expId}` }),
        }],
      };
    }

    const now = new Date().toISOString();
    const sourceAgent = process.env.HIVE_EXP_AGENT ?? "mcp-client";

    // 1. Append experience.referenced event
    const refEventId = generateId("evt");
    const refEvent: HiveEvent<ExperienceReferencedPayload> = {
      event_id: refEventId,
      type: "experience.referenced",
      timestamp: now,
      source_agent: sourceAgent,
      signature: ctx.signer.sign(refEventId),
      payload: {
        exp_id: expId,
        context_summary: "Referenced via MCP outcome",
      },
    };
    await ctx.eventWriter.append(refEvent as HiveEvent);

    // 2. Append experience.outcome_recorded event
    const outEventId = generateId("evt");
    const outEvent: HiveEvent<ExperienceOutcomePayload> = {
      event_id: outEventId,
      type: "experience.outcome_recorded",
      timestamp: now,
      source_agent: sourceAgent,
      signature: ctx.signer.sign(outEventId),
      payload: {
        exp_id: expId,
        ref_event_id: refEventId,
        result,
      },
    };
    await ctx.eventWriter.append(outEvent as HiveEvent);

    // 3. Sync projector
    await ctx.projector.incrementalSync();

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ status: "recorded", exp_id: expId, result }),
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
