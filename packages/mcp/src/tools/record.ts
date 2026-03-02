import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { HiveExpContext } from "../context.js";
import type { ToolHandler } from "./index.js";
import type { ExperienceRecord, HiveEvent, ExperienceCreatedPayload } from "@hive-exp/core";
import {
  detectDuplicates,
  executeSupersedes,
  normalizeSignal,
  sanitizeSecurity,
  sanitizePrivacy,
  validateExperience,
} from "@hive-exp/core";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

export const definition: Tool = {
  name: "hive_exp_record",
  description: "Record a new debugging experience including signals, strategy, and outcome.",
  inputSchema: {
    type: "object",
    properties: {
      signals: { type: "array", items: { type: "string" } },
      strategy: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          category: { type: "string", enum: ["repair", "optimize", "innovate"] },
        },
        required: ["name", "description", "category"],
      },
      outcome: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["success", "failed", "partial"] },
          evidence: { type: "string" },
          blast_radius: {
            type: "object",
            properties: { files: { type: "number" }, lines: { type: "number" } },
          },
        },
        required: ["status"],
      },
      scope: { type: "string", enum: ["universal", "language", "project"], default: "universal" },
      preconditions: { type: "array", items: { type: "string" } },
      risk_level: { type: "string", enum: ["low", "medium", "high"], default: "low" },
    },
    required: ["signals", "strategy", "outcome"],
  },
};

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

async function loadExperiencesFromDir(dirPath: string): Promise<ExperienceRecord[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dirPath);
  } catch {
    return [];
  }

  const experiences: ExperienceRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(dirPath, entry);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      experiences.push(JSON.parse(raw) as ExperienceRecord);
    } catch {
      // skip malformed files
    }
  }
  return experiences;
}

async function loadAllExperiences(provisionalDir: string, promotedDir: string): Promise<ExperienceRecord[]> {
  const [provisional, promoted] = await Promise.all([
    loadExperiencesFromDir(provisionalDir),
    loadExperiencesFromDir(promotedDir),
  ]);
  return [...provisional, ...promoted];
}

export function createHandler(ctx: HiveExpContext): ToolHandler {
  return async (args) => {
    const rawSignals = args.signals as string[];
    const strategy = args.strategy as { name: string; description: string; category: "repair" | "optimize" | "innovate" };
    const outcome = args.outcome as { status: "success" | "failed" | "partial"; evidence?: string; blast_radius?: { files: number; lines: number } };
    const scope = (args.scope as ExperienceRecord["scope"]) ?? "universal";
    const preconditions = (args.preconditions as string[]) ?? [];
    const riskLevel = (args.risk_level as "low" | "medium" | "high") ?? "low";

    const expId = generateId("exp");
    const normalizedSignals = rawSignals.map(normalizeSignal);

    // Sanitize strategy description
    const secResult = sanitizeSecurity(strategy.description);
    const privResult = sanitizePrivacy(secResult.clean);
    const cleanDescription = privResult.clean;

    const now = new Date().toISOString();
    const deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const record: ExperienceRecord = {
      id: expId,
      type: "experience",
      schema_version: "1.1.0",
      signals: normalizedSignals,
      scope,
      preconditions,
      strategy: {
        name: strategy.name,
        description: cleanDescription,
        category: strategy.category,
      },
      outcome: {
        status: outcome.status,
        evidence: outcome.evidence,
        blast_radius: outcome.blast_radius,
      },
      confidence: 0.5,
      source_agent: process.env.HIVE_EXP_AGENT ?? "mcp-client",
      signature: "",
      validated_by: null,
      promoted: false,
      provisional: true,
      provisional_deadline: deadline,
      supersedes: null,
      superseded_by: null,
      risk_level: riskLevel,
      created: now,
      last_confirmed: now,
      decay_halflife_days: 30,
      archived: false,
      archived_reason: null,
    };

    // Sign
    record.signature = ctx.signer.sign(JSON.stringify(record));

    // Validate
    const validation = validateExperience(record);
    if (!validation.valid) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ status: "error", errors: validation.errors }),
        }],
      };
    }

    // Write JSON file
    if (ctx.autoApprove) {
      record.provisional = false;
      record.promoted = true;
      record.provisional_deadline = null;
      record.signature = '';
      record.signature = ctx.signer.sign(JSON.stringify({ ...record, signature: '' }));
      await fs.writeFile(
        path.join(ctx.promotedDir, `${expId}.json`),
        JSON.stringify(record, null, 2),
      );
    } else {
      await fs.writeFile(
        path.join(ctx.provisionalDir, `${expId}.json`),
        JSON.stringify(record, null, 2),
      );
    }

    // Append experience.created event
    const eventId = generateId("evt");
    const event: HiveEvent<ExperienceCreatedPayload> = {
      event_id: eventId,
      type: "experience.created",
      timestamp: now,
      source_agent: record.source_agent,
      signature: ctx.signer.sign(eventId),
      payload: {
        exp_id: expId,
        initial_confidence: 0.5,
      },
    };

    await ctx.eventWriter.append(event as HiveEvent);
    if (ctx.autoApprove) {
      const promoteEventId = generateId('evt');
      const promoteEvent: HiveEvent = {
        event_id: promoteEventId,
        type: 'experience.promoted',
        timestamp: now,
        source_agent: record.source_agent,
        signature: ctx.signer.sign(promoteEventId),
        payload: {
          exp_id: expId,
          promoted_by: 'auto',
          auto_approved: true,
        },
      };
      await ctx.eventWriter.append(promoteEvent);
    }
    await ctx.projector.incrementalSync();

    let supersededIds: string[] = [];
    if (ctx.dedupEnabled) {
      const allExperiences = await loadAllExperiences(ctx.provisionalDir, ctx.promotedDir);
      const duplicateActions = detectDuplicates(allExperiences);
      const relevantActions = duplicateActions.filter(
        (action) => action.winner_id === expId || action.loser_id === expId,
      );
      if (relevantActions.length > 0) {
        const supersedeResult = await executeSupersedes(relevantActions, {
          dataDir: ctx.dataDir,
          signer: ctx.signer,
          sourceAgent: record.source_agent,
        });
        if (supersedeResult.superseded > 0) {
          supersededIds = supersedeResult.actions.map((action) => action.old_exp_id);
        }
        await ctx.projector.incrementalSync();
      }
    }

    // Check low complexity warning
    let warning: string | undefined;
    const br = outcome.blast_radius;
    if (br && (br.files < 1 || br.lines < 5)) {
      warning = "low_complexity";
    }

    const result: Record<string, unknown> = {
      exp_id: expId,
      status: "created",
      provisional: !ctx.autoApprove,
    };
    if (ctx.autoApprove) result.auto_approved = true;
    if (warning) result.warning = warning;
    if (supersededIds.length > 0) result.superseded_ids = supersededIds;

    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  };
}

// Backward compat stub
export async function handler(_args: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ status: "not_implemented" }) }],
  };
}
