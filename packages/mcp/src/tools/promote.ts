import type { Tool } from "@modelcontextprotocol/sdk/types.js";

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

export async function handler(_args: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ status: "not_implemented" }) }],
  };
}
