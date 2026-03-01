import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@hive-exp/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@hive-exp/mcp': path.resolve(__dirname, 'packages/mcp/src/index.ts'),
    },
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30000,
  },
});
