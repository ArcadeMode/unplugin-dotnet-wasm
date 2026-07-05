import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { readBundler, readShape } from './test-matrix-parameters';

const bundler = readBundler();
const fixtureShape = readShape();
const configName = `${bundler}-${fixtureShape}`;

export function createVitestConfig(include: string[] | undefined) {
  return defineConfig({
    test: {
      globals: false,
      environment: 'node',
      include,
      testTimeout: 60_000,
      reporters: ['default', 'json'],
      outputFile: {
        json: resolve(__dirname, `test-results/${configName}.json`),
      },
    },
  });
}
