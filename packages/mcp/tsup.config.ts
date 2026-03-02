import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/server.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
  },
]);
