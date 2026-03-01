import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { HiveExpContext } from "../context.js";
import { definition as queryDef, createHandler as createQueryHandler } from "./query.js";
import { definition as recordDef, createHandler as createRecordHandler } from "./record.js";
import { definition as outcomeDef, createHandler as createOutcomeHandler } from "./outcome.js";
import { definition as statsDef, createHandler as createStatsHandler } from "./stats.js";
import { definition as promoteDef, createHandler as createPromoteHandler } from "./promote.js";

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

export function createToolHandlers(ctx: HiveExpContext): Record<string, ToolHandler> {
  return {
    hive_exp_query: createQueryHandler(ctx),
    hive_exp_record: createRecordHandler(ctx),
    hive_exp_outcome: createOutcomeHandler(ctx),
    hive_exp_stats: createStatsHandler(ctx),
    hive_exp_promote: createPromoteHandler(ctx),
  };
}

// Backward-compatible default (uses lazy initialization)
let _defaultHandlers: Record<string, ToolHandler> | null = null;
export function getToolHandlers(ctx?: HiveExpContext): Record<string, ToolHandler> {
  if (ctx) return createToolHandlers(ctx);
  if (!_defaultHandlers) {
    // Lazy: if no context given, create with defaults (for backward compat in tests)
    const { createContext } = require("../context.js") as typeof import("../context.js");
    _defaultHandlers = createToolHandlers(createContext());
  }
  return _defaultHandlers;
}

// Keep backward compat export (will be populated lazily)
export const toolHandlers: Record<string, ToolHandler> = new Proxy({} as Record<string, ToolHandler>, {
  get(_target, prop: string) {
    return getToolHandlers()[prop];
  },
  ownKeys() {
    return Object.keys(getToolHandlers());
  },
  getOwnPropertyDescriptor(_target, prop: string) {
    const handlers = getToolHandlers();
    if (prop in handlers) {
      return { configurable: true, enumerable: true, value: handlers[prop] };
    }
    return undefined;
  },
  has(_target, prop: string) {
    return prop in getToolHandlers();
  },
});
