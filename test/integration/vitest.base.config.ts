import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import {
  readBundler,
  readPlatform,
  readFingerprint,
  readBuildMode,
  readServeMode,
} from './test-matrix-parameters';

const bundler = readBundler();
const platform = readPlatform();
const fingerprint = readFingerprint();
const buildMode = readBuildMode();
const serveMode = readServeMode();
export function createVitestConfig(
  include: string[] | undefined,
  type: 'integration' | 'e2e-node',
) {
  const configName = `type-${type}_bundler-${bundler}_platform-${platform}_serve-${serveMode}_fingerprint-${fingerprint}_build-${buildMode}_platform-${process.platform}`;
  const subdir = type === 'integration' ? 'integration' : 'e2e';
  return defineConfig({
    test: {
      globals: false,
      environment: 'node',
      include,
      testTimeout: 60_000,
      reporters: ['default', 'junit'],
      outputFile: {
        junit: resolve(__dirname, `test-results/${subdir}/${configName}.junit.xml`),
      },
    },
  });
}
