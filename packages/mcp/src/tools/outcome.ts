import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const definition: Tool = {
  name: "hive_exp_outcome",
  description: "Update the outcome of a previously recorded experience.",
  inputSchema: {
    type: "object",
    properties: {
      exp_id: { type: "string" },
      result: { type: "string", enum: ["success", "failed", "partial"] },
    },
    required: ["exp_id", "result"],
  },
};

export async function handler(_args: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ status: "not_implemented" }) }],
  };
}
