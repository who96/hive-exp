import { Router } from 'express';
import type { DashboardContext } from '../context.js';

export function eventsRouter(ctx: DashboardContext) {
  const router = Router();

  router.get('/events', async (_req, res) => {
    try {
      const { type: typeFilter, since: sinceStr, limit: rawLimit, offset: rawOffset } = _req.query as Record<string, string>;
      const limit = rawLimit ? parseInt(rawLimit, 10) : 100;
      const offset = rawOffset ? parseInt(rawOffset, 10) : 0;

      const options: { types?: string[]; fromDate?: Date; limit?: number } = {};
      if (typeFilter) {
        options.types = [typeFilter];
      }
      if (sinceStr) {
        options.fromDate = new Date(sinceStr);
      }
      options.limit = offset + limit;

      const events = await ctx.eventReader.readEvents(options);
      const page = events.slice(offset, offset + limit);

      res.json({
        status: 'ok',
        data: {
          total: events.length,
          items: page,
        },
      });
    } catch (err) {
      res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  return router;
}
