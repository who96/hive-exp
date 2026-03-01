import express from 'express';
import * as path from 'node:path';
import * as url from 'node:url';
import { createDashboardContext } from './context.js';
import { apiRouter } from './api/index.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export function createApp(dataDir?: string) {
  const app = express();
  app.use(express.json());

  const ctx = createDashboardContext(dataDir);

  app.use('/api', apiRouter(ctx));

  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}

const isMain = process.argv[1] === url.fileURLToPath(import.meta.url);
if (isMain) {
  const port = process.env.PORT ?? 3000;
  const app = createApp();
  app.listen(port, () => {
    console.log(`Dashboard running on http://localhost:${port}`);
  });
}
