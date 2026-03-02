import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createContext } from "../src/context.js";
import { toolDefinitions, createToolHandlers } from "../src/tools/index.js";
import type { HiveExpContext } from "../src/context.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hive-exp-test-"));
}

function cleanDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

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
});

describe("Integration Tests", () => {
  let tmpDir: string;
  let ctx: HiveExpContext;
  let handlers: ReturnType<typeof createToolHandlers>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
      auto_approve: false,
      dedup_enabled: false,
    }));
    ctx = createContext(tmpDir);
    handlers = createToolHandlers(ctx);
  });

  afterEach(() => {
    try { ctx.aggregator.close(); } catch {}
    try { ctx.projector.close(); } catch {}
    cleanDir(tmpDir);
  });

  describe("hive_exp_record", () => {
    it("creates a new provisional experience", async () => {
      const result = await handlers.hive_exp_record({
        signals: ["tsc_error"],
        strategy: { name: "fix_imports", description: "Fix missing imports", category: "repair" },
        outcome: { status: "success", blast_radius: { files: 2, lines: 10 } },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe("created");
      expect(parsed.provisional).toBe(true);
      expect(parsed.exp_id).toMatch(/^exp_\d+_[a-f0-9]{8}$/);

      // Verify file exists
      const files = fs.readdirSync(ctx.provisionalDir);
      expect(files.length).toBe(1);
      expect(files[0]).toBe(`${parsed.exp_id}.json`);
    });

    it("returns low_complexity warning for small blast radius", async () => {
      const result = await handlers.hive_exp_record({
        signals: ["build_failed"],
        strategy: { name: "fix_config", description: "Fix build config", category: "repair" },
        outcome: { status: "success", blast_radius: { files: 0, lines: 2 } },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.warning).toBe("low_complexity");
    });

    it("normalizes signal names", async () => {
      const result = await handlers.hive_exp_record({
        signals: ["typescript_compilation_failed"],
        strategy: { name: "fix_types", description: "Fix type errors", category: "repair" },
        outcome: { status: "success" },
      });

      const parsed = JSON.parse(result.content[0].text);
      const expFile = fs.readFileSync(
        path.join(ctx.provisionalDir, `${parsed.exp_id}.json`),
        "utf-8",
      );
      const record = JSON.parse(expFile);
      expect(record.signals).toContain("tsc_error");
    });

    it("sanitizes strategy description", async () => {
      const result = await handlers.hive_exp_record({
        signals: ["test_failed"],
        strategy: {
          name: "fix_test",
          description: "Run eval('test') to fix",
          category: "repair",
        },
        outcome: { status: "success" },
      });

      const parsed = JSON.parse(result.content[0].text);
      const expFile = fs.readFileSync(
        path.join(ctx.provisionalDir, `${parsed.exp_id}.json`),
        "utf-8",
      );
      const record = JSON.parse(expFile);
      expect(record.strategy.description).toContain("[REDACTED");
    });
  });

  describe("hive_exp_query", () => {
    it("returns empty matches when no experiences exist", async () => {
      const result = await handlers.hive_exp_query({ signals: ["tsc_error"] });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.matches).toEqual([]);
      expect(parsed.total_available).toBe(0);
    });

    it("finds matching experiences by signal", async () => {
      // Record first
      await handlers.hive_exp_record({
        signals: ["tsc_error"],
        strategy: { name: "fix_imports", description: "Fix imports", category: "repair" },
        outcome: { status: "success" },
      });

      // Query
      const result = await handlers.hive_exp_query({ signals: ["tsc_error"] });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.matches.length).toBe(1);
      expect(parsed.matches[0].signals).toContain("tsc_error");
      expect(parsed.matches[0].provisional).toBe(true);
    });

    it("filters by scope", async () => {
      await handlers.hive_exp_record({
        signals: ["tsc_error"],
        strategy: { name: "fix_a", description: "Fix A", category: "repair" },
        outcome: { status: "success" },
        scope: "project",
      });
      await handlers.hive_exp_record({
        signals: ["tsc_error"],
        strategy: { name: "fix_b", description: "Fix B", category: "repair" },
        outcome: { status: "success" },
        scope: "universal",
      });

      const result = await handlers.hive_exp_query({
        signals: ["tsc_error"],
        scope: "universal",
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.matches.length).toBe(1);
      expect(parsed.matches[0].strategy.name).toBe("fix_b");
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await handlers.hive_exp_record({
          signals: ["build_failed"],
          strategy: { name: `fix_${i}`, description: `Fix ${i}`, category: "repair" },
          outcome: { status: "success" },
        });
      }

      const result = await handlers.hive_exp_query({
        signals: ["build_failed"],
        limit: 2,
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.matches.length).toBe(2);
      expect(parsed.total_available).toBe(5);
    });
  });

  describe("hive_exp_outcome", () => {
    it("records outcome for existing experience", async () => {
      const recordResult = await handlers.hive_exp_record({
        signals: ["test_failed"],
        strategy: { name: "fix_test", description: "Fix test", category: "repair" },
        outcome: { status: "partial" },
      });
      const expId = JSON.parse(recordResult.content[0].text).exp_id;

      const outcomeResult = await handlers.hive_exp_outcome({
        exp_id: expId,
        result: "success",
      });
      const parsed = JSON.parse(outcomeResult.content[0].text);
      expect(parsed.status).toBe("recorded");
      expect(parsed.exp_id).toBe(expId);
      expect(parsed.result).toBe("success");
    });

    it("returns error for non-existent experience", async () => {
      const result = await handlers.hive_exp_outcome({
        exp_id: "exp_0000000000000_deadbeef",
        result: "success",
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe("error");
    });
  });

  describe("hive_exp_stats", () => {
    it("returns overview with zero counts when empty", async () => {
      const result = await handlers.hive_exp_stats({ type: "overview" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.type).toBe("overview");
      expect(parsed.counts.total).toBe(0);
    });

    it("returns overview with correct counts after recording", async () => {
      await handlers.hive_exp_record({
        signals: ["tsc_error"],
        strategy: { name: "fix_types", description: "Fix types", category: "repair" },
        outcome: { status: "success" },
      });

      const result = await handlers.hive_exp_stats({ type: "overview" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.counts.total).toBe(1);
      expect(parsed.counts.provisional).toBe(1);
    });

    it("returns strategy_ranking", async () => {
      const result = await handlers.hive_exp_stats({ type: "strategy_ranking" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.type).toBe("strategy_ranking");
      expect(Array.isArray(parsed.rankings)).toBe(true);
    });

    it("returns at_risk experiences", async () => {
      const result = await handlers.hive_exp_stats({ type: "at_risk" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.type).toBe("at_risk");
      expect(Array.isArray(parsed.experiences)).toBe(true);
    });
  });

  describe("hive_exp_promote", () => {
    it("sets pending_promotion on existing experience", async () => {
      const recordResult = await handlers.hive_exp_record({
        signals: ["lint_error"],
        strategy: { name: "fix_lint", description: "Fix lint errors", category: "repair" },
        outcome: { status: "success" },
      });
      const expId = JSON.parse(recordResult.content[0].text).exp_id;

      const promoteResult = await handlers.hive_exp_promote({
        exp_id: expId,
        reason: "Proven reliable",
      });
      const parsed = JSON.parse(promoteResult.content[0].text);
      expect(parsed.status).toBe("pending_promotion");
      expect(parsed.exp_id).toBe(expId);

      // Verify file was updated
      const expFile = fs.readFileSync(
        path.join(ctx.provisionalDir, `${expId}.json`),
        "utf-8",
      );
      const record = JSON.parse(expFile);
      expect(record.pending_promotion).toBe(true);
      expect(record.promotion_reason).toBe("Proven reliable");
    });

    it("returns error for non-existent experience", async () => {
      const result = await handlers.hive_exp_promote({
        exp_id: "exp_0000000000000_deadbeef",
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe("error");
    });
  });

  describe("Full Flow: record -> query -> outcome -> stats", () => {
    it("completes the full lifecycle", async () => {
      // 1. Record
      const recordResult = await handlers.hive_exp_record({
        signals: ["tsc_error", "build_failed"],
        strategy: { name: "fix_tsconfig", description: "Fix tsconfig paths", category: "repair" },
        outcome: { status: "success", blast_radius: { files: 3, lines: 25 } },
        scope: "project",
        risk_level: "low",
      });
      const recordParsed = JSON.parse(recordResult.content[0].text);
      expect(recordParsed.status).toBe("created");
      const expId = recordParsed.exp_id;

      // 2. Query
      const queryResult = await handlers.hive_exp_query({
        signals: ["tsc_error"],
        scope: "project",
      });
      const queryParsed = JSON.parse(queryResult.content[0].text);
      expect(queryParsed.matches.length).toBe(1);
      expect(queryParsed.matches[0].exp_id).toBe(expId);

      // 3. Outcome
      const outcomeResult = await handlers.hive_exp_outcome({
        exp_id: expId,
        result: "success",
      });
      const outcomeParsed = JSON.parse(outcomeResult.content[0].text);
      expect(outcomeParsed.status).toBe("recorded");

      // 4. Stats
      const statsResult = await handlers.hive_exp_stats({ type: "overview" });
      const statsParsed = JSON.parse(statsResult.content[0].text);
      expect(statsParsed.counts.provisional).toBe(1);

      // 5. Promote
      const promoteResult = await handlers.hive_exp_promote({
        exp_id: expId,
        reason: "Verified in production",
      });
      const promoteParsed = JSON.parse(promoteResult.content[0].text);
      expect(promoteParsed.status).toBe("pending_promotion");
    });
  });
});
