import { Router } from 'express';
import type { DashboardContext } from '../context.js';
import { overviewRouter } from './overview.js';
import { experiencesRouter } from './experiences.js';
import { eventsRouter } from './events.js';

export function apiRouter(ctx: DashboardContext) {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });

  router.use(overviewRouter(ctx));
  router.use(experiencesRouter(ctx));
  router.use(eventsRouter(ctx));

  return router;
}
