import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  banner: ({ entryPoint }) => {
    if (entryPoint.endsWith('server.ts')) {
      return { js: '#!/usr/bin/env node' };
    }
    return {};
  },
});
