import { Router } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExperienceRecord } from '@hive-exp/core';
import { effectiveConfidence } from '@hive-exp/core';
import type { DashboardContext } from '../context.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const AT_RISK_CONFIDENCE_THRESHOLD = 0.3;

interface StrategyRankingEntry {
  strategy_name: string;
  ref_count: number;
  success_rate: number;
  avg_confidence: number;
}

interface AtRiskEntry {
  exp_id: string;
  signals: string[];
  strategy_name: string;
  confidence: number;
  risk_reason: string;
}

interface ConfidenceDistribution {
  high: number;
  medium: number;
  low: number;
}

interface AgentContributionEntry {
  agent: string;
  count: number;
}

function readDirRecords(dir: string): ExperienceRecord[] {
  const records: ExperienceRecord[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return records;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, entry), 'utf-8');
      records.push(JSON.parse(raw) as ExperienceRecord);
    } catch {
      /* skip malformed */
    }
  }
  return records;
}

export function statsRouter(ctx: DashboardContext) {
  const router = Router();

  router.get('/stats', (_req, res) => {
    try {
      const provisional = readDirRecords(ctx.provisionalDir);
      const promoted = readDirRecords(ctx.promotedDir);
      const all = [...provisional, ...promoted];

      // --- Strategy ranking ---
      const strategyMap = new Map<
        string,
        { ref_count: number; success_count: number; total_count: number; confidence_sum: number }
      >();
      for (const record of all) {
        const name = record.strategy.name;
        const existing = strategyMap.get(name) ?? {
          ref_count: 0,
          success_count: 0,
          total_count: 0,
          confidence_sum: 0,
        };
        // treat each experience as a ref; count successes
        existing.ref_count += 1;
        if (record.outcome.status === 'success') {
          existing.success_count += 1;
        }
        existing.total_count += 1;
        existing.confidence_sum += effectiveConfidence(
          record.confidence,
          record.last_confirmed,
          record.decay_halflife_days,
        );
        strategyMap.set(name, existing);
      }

      const strategy_ranking: StrategyRankingEntry[] = Array.from(strategyMap.entries())
        .map(([strategy_name, stats]) => ({
          strategy_name,
          ref_count: stats.ref_count,
          success_rate: stats.total_count > 0 ? stats.success_count / stats.total_count : 0,
          avg_confidence: stats.total_count > 0 ? stats.confidence_sum / stats.total_count : 0,
        }))
        .sort((a, b) => b.ref_count - a.ref_count);

      // --- At-risk experiences ---
      const now = Date.now();
      const at_risk: AtRiskEntry[] = [];
      for (const record of all) {
        const eff = effectiveConfidence(
          record.confidence,
          record.last_confirmed,
          record.decay_halflife_days,
        );
        const isLowConfidence = eff < AT_RISK_CONFIDENCE_THRESHOLD;
        const lastConfirmedMs = new Date(record.last_confirmed).getTime();
        const noRecentRef = now - lastConfirmedMs > THIRTY_DAYS_MS;

        if (isLowConfidence || noRecentRef) {
          const risk_reason = isLowConfidence ? 'low_confidence' : 'no_recent_ref';
          at_risk.push({
            exp_id: record.id,
            signals: record.signals,
            strategy_name: record.strategy.name,
            confidence: Math.round(eff * 10000) / 10000,
            risk_reason,
          });
        }
      }

      // --- Confidence distribution ---
      const confidence_distribution: ConfidenceDistribution = { high: 0, medium: 0, low: 0 };
      for (const record of all) {
        const eff = effectiveConfidence(
          record.confidence,
          record.last_confirmed,
          record.decay_halflife_days,
        );
        if (eff >= 0.7) {
          confidence_distribution.high += 1;
        } else if (eff >= 0.3) {
          confidence_distribution.medium += 1;
        } else {
          confidence_distribution.low += 1;
        }
      }

      // --- Agent contribution ---
      const agentMap = new Map<string, number>();
      for (const record of all) {
        const agent = record.source_agent ?? 'unknown';
        agentMap.set(agent, (agentMap.get(agent) ?? 0) + 1);
      }
      const agent_contribution: AgentContributionEntry[] = Array.from(agentMap.entries())
        .map(([agent, count]) => ({ agent, count }))
        .sort((a, b) => b.count - a.count);

      res.json({
        status: 'ok',
        data: {
          strategy_ranking,
          at_risk,
          confidence_distribution,
          agent_contribution,
        },
      });
    } catch (err) {
      res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  return router;
}
