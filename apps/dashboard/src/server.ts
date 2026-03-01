import express, { type Express } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './api/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  // Serve static frontend files
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // API routes
  app.use('/api', apiRouter());

  // SPA fallback - serve index.html for all unmatched routes
  // Express 5 requires named wildcard parameters
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  return app;
}

// Only start server if run directly (not imported for tests)
const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') ||
    process.argv[1].endsWith('server.js'));

if (isMainModule) {
  const PORT = 3721;
  const HOST = '127.0.0.1';

  const app = createApp();
  app.listen(PORT, HOST, () => {
    console.log(`hive-exp dashboard: http://${HOST}:${PORT}`);
  });
}
