import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const bundler = process.env.BUNDLER ?? 'vite';
const fixtureShape = process.env.DOTNET_FIXTURE_SHAPE ?? 'fingerprint';
const configName = `${bundler}-${fixtureShape}`;

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['**/*.test.ts'],
    testTimeout: 60_000,
    reporters: ['default', 'json'],
    outputFile: {
      json: resolve(__dirname, `test-results/${configName}.json`),
    },
  },
});
