import { Router } from 'express';
import { resolveConfig, writeConfig } from '@hive-exp/core';
import type { DashboardContext } from '../context.js';

export function configRouter(ctx: DashboardContext) {
  const router = Router();

  router.get('/config', (_req, res) => {
    try {
      const config = resolveConfig(ctx.dataDir);
      res.json({ status: 'ok', data: config });
    } catch (err) {
      res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  router.put('/config', (req, res) => {
    try {
      const updates = req.body as Record<string, unknown>;
      const patch: Record<string, boolean> = {};
      if ('autoApprove' in updates) {
        patch.autoApprove = Boolean(updates.autoApprove);
      }
      writeConfig(ctx.dataDir, patch);
      const config = resolveConfig(ctx.dataDir);
      res.json({ status: 'ok', data: config });
    } catch (err) {
      res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  return router;
}
