import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { readBundler, readPlatform, readFingerprint, readBuildMode } from './test-matrix-parameters';

const bundler = readBundler();
const platform = readPlatform();
const fingerprint = readFingerprint();
const buildMode = readBuildMode();

export function createVitestConfig(include: string[] | undefined, type: 'integration' | 'e2e-node') {
  const configName = `${type}-${bundler}-${platform}-${fingerprint}-${buildMode}-${process.platform}`;
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
