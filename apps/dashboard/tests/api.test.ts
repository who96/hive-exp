import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/server.js';

describe('dashboard api', () => {
  const loadedTabs = new Set<number>();
  let server: http.Server | null = null;
  let port = 0;

  const endpoints = [
    '/api/health',
    '/api/overview',
    '/api/experiences',
    '/api/stats',
    '/api/events',
    '/api/experience/test-id',
  ];

  async function request(path: string): Promise<Record<string, unknown>> {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    const data = await response.json();
    return data;
  }

  beforeAll(async () => {
    const app = createApp();
    server = http.createServer(app);

    await new Promise<void>((resolve, reject) => {
      server?.on('error', reject);
      server?.listen(0, '127.0.0.1', () => {
        const address = server?.address();
        if (address && typeof address === 'object') {
          port = address.port;
          resolve();
        } else {
          reject(new Error('Unable to determine server port'));
        }
      });
    });
  });

  afterAll(async () => {
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it('GET /api/health returns version', async () => {
    const data = await request('/api/health');
    expect(data).toEqual({ status: 'ok', version: '0.1.0' });
  });

  it('GET /api/overview returns ok', async () => {
    const data = await request('/api/overview');
    expect(data.status).toBe('ok');
  });

  it('GET /api/experiences returns ok', async () => {
    const data = await request('/api/experiences');
    expect(data.status).toBe('ok');
  });

  it('GET /api/stats returns ok', async () => {
    const data = await request('/api/stats');
    expect(data.status).toBe('ok');
  });

  it('GET /api/events returns ok', async () => {
    const data = await request('/api/events');
    expect(data.status).toBe('ok');
  });

  it('GET /api/experience/test-id returns ok', async () => {
    const data = await request('/api/experience/test-id');
    expect(data.status).toBe('ok');
  });

  it('all dashboard routes are registered', async () => {
    for (const endpoint of endpoints) {
      const response = await fetch(`http://127.0.0.1:${port}${endpoint}`);
      expect(response.status).not.toBe(404);
      loadedTabs.add(response.status);
    }

    expect(loadedTabs.size).toBeGreaterThan(0);
  });
});
