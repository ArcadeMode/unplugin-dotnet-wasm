import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const bundler = process.env.FIXTURE_BUNDLER ?? 'all';
const configName = `e2e-vitest-${bundler}-node-${process.platform}`;

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/vitest/**/*.test.ts'],
    globalSetup: ['./setup/vitest-global.ts'], // also teardown
    // .NET restore + build on first materialization can be slow.
    testTimeout: 200_000,
    hookTimeout: 200_000,
    fileParallelism: false,
    maxWorkers: 1,
    reporters: ['default', 'junit'],
    outputFile: {
      junit: resolve(__dirname, `test-results/node/${bundler}/${configName}.junit.xml`),
    },
  },
});
