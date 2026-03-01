import { Router } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExperienceRecord } from '@hive-exp/core';
import type { DashboardContext } from '../context.js';

export function overviewRouter(ctx: DashboardContext) {
  const router = Router();

  router.get('/overview', async (_req, res) => {
    try {
      const dirs = [
        { dir: ctx.provisionalDir, status: 'provisional' },
        { dir: ctx.promotedDir, status: 'promoted' },
        { dir: ctx.archivedDir, status: 'archived' },
      ];

      const agentCounts: Record<string, number> = {};
      let provisional_count = 0;
      let promoted_count = 0;
      let archived_count = 0;
      let pending_review = 0;

      for (const { dir, status } of dirs) {
        let entries: string[];
        try {
          entries = fs.readdirSync(dir);
        } catch {
          entries = [];
        }
        for (const entry of entries) {
          if (!entry.endsWith('.json')) {
            continue;
          }
          try {
            const raw = fs.readFileSync(path.join(dir, entry), 'utf-8');
            const record = JSON.parse(raw) as ExperienceRecord & { pending_promotion?: boolean };

            if (status === 'provisional') {
              provisional_count++;
            } else if (status === 'promoted') {
              promoted_count++;
            } else if (status === 'archived') {
              archived_count++;
            }

            if (record.pending_promotion === true) {
              pending_review++;
            }

            const agent = record.source_agent ?? 'unknown';
            agentCounts[agent] = (agentCounts[agent] ?? 0) + 1;
          } catch {
            /* skip malformed */
          }
        }
      }

      const total_experiences = provisional_count + promoted_count + archived_count;
      const agents = Object.entries(agentCounts).map(([name, experience_count]) => ({
        name,
        experience_count,
      }));

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentEventsArr = await ctx.eventReader.readEvents({ fromDate: since, limit: 50 });
      const recent_events = recentEventsArr.length;

      res.json({
        status: 'ok',
        data: {
          total_experiences,
          provisional_count,
          promoted_count,
          archived_count,
          pending_review,
          agents,
          recent_events,
        },
      });
    } catch (err) {
      res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  return router;
}
