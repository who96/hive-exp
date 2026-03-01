import type { Tool } from "@modelcontextprotocol/sdk/types.js";

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

export async function handler(_args: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ matches: [], total_available: 0 }) }],
  };
}
