import { Router } from 'express';

const STUB = { status: 'ok' as const, data: null, message: 'not_implemented' };

export function apiRouter(): Router {
  const router = Router();

  // Health check
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });

  // System overview
  router.get('/overview', (_req, res) => {
    res.json(STUB);
  });

  // List experiences (paginated)
  router.get('/experiences', (_req, res) => {
    res.json(STUB);
  });

  // Single experience detail
  router.get('/experience/:id', (_req, res) => {
    res.json(STUB);
  });

  // Promote action
  router.post('/experience/:id/promote', (_req, res) => {
    res.json(STUB);
  });

  // Quarantine action
  router.post('/experience/:id/quarantine', (_req, res) => {
    res.json(STUB);
  });

  // Strategy statistics
  router.get('/stats', (_req, res) => {
    res.json(STUB);
  });

  // Recent events (audit log)
  router.get('/events', (_req, res) => {
    res.json(STUB);
  });

  return router;
}
