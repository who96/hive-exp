import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { definition as queryDef, handler as queryHandler } from "./query.js";
import { definition as recordDef, handler as recordHandler } from "./record.js";
import { definition as outcomeDef, handler as outcomeHandler } from "./outcome.js";
import { definition as statsDef, handler as statsHandler } from "./stats.js";
import { definition as promoteDef, handler as promoteHandler } from "./promote.js";

export type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: "text"; text: string }>;
}>;

export const toolDefinitions: Tool[] = [
  queryDef,
  recordDef,
  outcomeDef,
  statsDef,
  promoteDef,
];

export const toolHandlers: Record<string, ToolHandler> = {
  hive_exp_query: queryHandler,
  hive_exp_record: recordHandler,
  hive_exp_outcome: outcomeHandler,
  hive_exp_stats: statsHandler,
  hive_exp_promote: promoteHandler,
};
