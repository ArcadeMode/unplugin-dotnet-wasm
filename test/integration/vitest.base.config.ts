import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { readBundler, readPlatform, readShape } from './test-matrix-parameters';

const bundler = readBundler();
const platform = readPlatform();
const fixtureShape = readShape();

export function createVitestConfig(include: string[] | undefined, type: 'integration' | 'e2e-node') {
  const configName = `${type}-${bundler}-${platform}-${fixtureShape}`;
  return defineConfig({
    test: {
      globals: false,
      environment: 'node',
      include,
      testTimeout: 60_000,
      reporters: ['default', 'junit'],
      outputFile: {
        junit: resolve(__dirname, `test-results/${configName}.junit.xml`),
      },
    },
  });
}
