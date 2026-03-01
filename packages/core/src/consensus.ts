import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { ExperienceRecord, ExperienceProvisionalPayload } from './types/index.js';
import { EventWriter } from './events/writer.js';
import { effectiveConfidence } from './stats/decay.js';

export interface ConsensusResult {
  signal: string;
  strategy_name: string;
  agents: string[];       // source_agent values
  exp_ids: string[];      // experience IDs involved
  avg_confidence: number; // average confidence across matching experiences
  consensus_strength: number; // agents.length / total_known_agents
}

export interface ConsensusDetectorOptions {
  provisionalDir: string;
  promotedDir: string;
  eventWriter: EventWriter;
  knownAgents?: string[];
}

const DEFAULT_KNOWN_AGENTS = [
  'claude-code',
  'codex',
  'gemini-cli',
  'cursor',
  'windsurf',
  'antigravity',
];

function generateEventId(): string {
  const ts = Date.now();
  const hash = crypto.randomBytes(4).toString('hex');
  return `evt_${ts}_${hash}`;
}

function loadExperiencesFromDir(dirPath: string): ExperienceRecord[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    return [];
  }

  const records: ExperienceRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const filePath = path.join(dirPath, entry);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'id' in parsed &&
        'signals' in parsed &&
        'strategy' in parsed &&
        'source_agent' in parsed &&
        'confidence' in parsed
      ) {
        records.push(parsed as ExperienceRecord);
      }
    } catch {
      // skip malformed files
    }
  }
  return records;
}

export class ConsensusDetector {
  private readonly provisionalDir: string;
  private readonly promotedDir: string;
  private readonly eventWriter: EventWriter;
  private readonly knownAgents: string[];

  constructor(options: ConsensusDetectorOptions) {
    this.provisionalDir = options.provisionalDir;
    this.promotedDir = options.promotedDir;
    this.eventWriter = options.eventWriter;
    this.knownAgents = options.knownAgents ?? DEFAULT_KNOWN_AGENTS;
  }

  detect(): ConsensusResult[] {
    const allExperiences = [
      ...loadExperiencesFromDir(this.provisionalDir),
      ...loadExperiencesFromDir(this.promotedDir),
    ];

    // Group by (signal, strategy_name) → list of experiences
    // Each experience may have multiple signals; expand the grouping key per signal
    const groups = new Map<string, ExperienceRecord[]>();

    for (const exp of allExperiences) {
      if (!Array.isArray(exp.signals) || exp.signals.length === 0) continue;
      const strategyName = exp.strategy?.name;
      if (!strategyName) continue;

      for (const signal of exp.signals) {
        const key = `${signal}\0${strategyName}`;
        const existing = groups.get(key);
        if (existing) {
          existing.push(exp);
        } else {
          groups.set(key, [exp]);
        }
      }
    }

    const results: ConsensusResult[] = [];

    for (const [key, experiences] of groups) {
      // Find distinct agents
      const agentSet = new Set<string>();
      for (const exp of experiences) {
        if (exp.source_agent) {
          agentSet.add(exp.source_agent);
        }
      }

      // Consensus requires >= 2 different agents
      if (agentSet.size < 2) continue;

      const separatorIdx = key.indexOf('\0');
      const signal = key.slice(0, separatorIdx);
      const strategyName = key.slice(separatorIdx + 1);

      const agents = Array.from(agentSet).sort();
      const expIds = experiences.map(e => e.id);

      // Compute average effective confidence
      const confidences = experiences.map(exp =>
        effectiveConfidence(
          exp.confidence,
          exp.last_confirmed ?? new Date().toISOString(),
          exp.decay_halflife_days ?? 30,
        )
      );
      const avgConfidence =
        confidences.length > 0
          ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
          : 0;

      const consensusStrength = agents.length / this.knownAgents.length;

      results.push({
        signal,
        strategy_name: strategyName,
        agents,
        exp_ids: expIds,
        avg_confidence: avgConfidence,
        consensus_strength: consensusStrength,
      });
    }

    return results;
  }

  async detectAndEmit(): Promise<{ results: ConsensusResult[]; eventsEmitted: number }> {
    const results = this.detect();
    let eventsEmitted = 0;

    for (const result of results) {
      for (const expId of result.exp_ids) {
        // Write experience.provisional event for each involved experience
        const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const payload: ExperienceProvisionalPayload = {
          exp_id: expId,
          consensus_agents: result.agents,
          deadline,
        };

        await this.eventWriter.append({
          event_id: generateEventId(),
          type: 'experience.provisional',
          timestamp: new Date().toISOString(),
          source_agent: 'consensus-detector',
          signature: 'hmac-sha256:consensus-detector',
          payload,
        });

        eventsEmitted++;
      }
    }

    return { results, eventsEmitted };
  }
}
