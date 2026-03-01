import { describe, it, expect } from "vitest";
import { toolDefinitions, toolHandlers } from "../src/tools/index.js";

describe("Tool Registry", () => {
  it("registers exactly 5 tools", () => {
    expect(toolDefinitions).toHaveLength(5);
  });

  it("each tool has a valid name and inputSchema", () => {
    for (const tool of toolDefinitions) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name).toMatch(/^hive_exp_/);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("dispatch map resolves each tool name to a handler function", () => {
    const expectedNames = [
      "hive_exp_query",
      "hive_exp_record",
      "hive_exp_outcome",
      "hive_exp_stats",
      "hive_exp_promote",
    ];
    for (const name of expectedNames) {
      expect(toolHandlers[name]).toBeDefined();
      expect(typeof toolHandlers[name]).toBe("function");
    }
  });
});

describe("Skeleton Handlers", () => {
  it("hive_exp_query returns valid CallToolResult", async () => {
    const result = await toolHandlers.hive_exp_query({ signals: ["test"] });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ matches: [], total_available: 0 });
  });

  it("hive_exp_record returns valid CallToolResult", async () => {
    const result = await toolHandlers.hive_exp_record({
      signals: ["test"],
      strategy: { name: "s", description: "d", category: "repair" },
      outcome: { status: "success" },
    });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ status: "not_implemented" });
  });

  it("hive_exp_outcome returns valid CallToolResult", async () => {
    const result = await toolHandlers.hive_exp_outcome({ exp_id: "x", result: "success" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ status: "not_implemented" });
  });

  it("hive_exp_stats returns valid CallToolResult", async () => {
    const result = await toolHandlers.hive_exp_stats({});
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ status: "not_implemented" });
  });

  it("hive_exp_promote returns valid CallToolResult", async () => {
    const result = await toolHandlers.hive_exp_promote({ exp_id: "x" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ status: "not_implemented" });
  });
});
