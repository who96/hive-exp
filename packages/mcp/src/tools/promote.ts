import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { HiveExpContext } from "../context.js";
import type { ToolHandler } from "./index.js";
import type { ExperienceRecord } from "@hive-exp/core";
import * as fs from "node:fs";
import * as path from "node:path";

export const definition: Tool = {
  name: "hive_exp_promote",
  description: "Propose promoting an experience to trusted zone. Does NOT immediately promote — sets pending_promotion status. Requires human confirmation via CLI or Dashboard.",
  inputSchema: {
    type: "object",
    properties: {
      exp_id: { type: "string" },
      reason: { type: "string" },
    },
    required: ["exp_id"],
  },
};

function findExperienceFile(ctx: HiveExpContext, expId: string): string | null {
  const dirs = [ctx.provisionalDir, ctx.promotedDir];
  for (const dir of dirs) {
    const filePath = path.join(dir, `${expId}.json`);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

export function createHandler(ctx: HiveExpContext): ToolHandler {
  return async (args) => {
    const expId = args.exp_id as string;
    const reason = (args.reason as string) ?? "Proposed via MCP";

    const filePath = findExperienceFile(ctx, expId);
    if (!filePath) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ status: "error", message: `Experience not found: ${expId}` }),
        }],
      };
    }

    // Read the experience and mark pending_promotion
    const raw = fs.readFileSync(filePath, "utf-8");
    const record = JSON.parse(raw) as ExperienceRecord & { pending_promotion?: boolean; promotion_reason?: string };

    if (record.promoted) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ status: "already_promoted", exp_id: expId }),
        }],
      };
    }

    record.pending_promotion = true;
    record.promotion_reason = reason;

    fs.writeFileSync(filePath, JSON.stringify(record, null, 2));

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "pending_promotion",
          exp_id: expId,
          message: "Awaiting human confirmation via CLI (hive-exp promote --confirm) or Dashboard",
        }),
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
