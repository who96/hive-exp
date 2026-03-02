import { Router } from 'express';
import type { DashboardContext } from '../context.js';
import { overviewRouter } from './overview.js';
import { experiencesRouter } from './experiences.js';
import { eventsRouter } from './events.js';
import { statsRouter } from './stats.js';
import { configRouter } from './config.js';

export function apiRouter(ctx: DashboardContext) {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });

  router.use(overviewRouter(ctx));
  router.use(experiencesRouter(ctx));
  router.use(eventsRouter(ctx));
  router.use(statsRouter(ctx));
  router.use(configRouter(ctx));

  return router;
}
