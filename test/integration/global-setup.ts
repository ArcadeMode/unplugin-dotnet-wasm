import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBundler, readFingerprint, readBuildMode, readServeMode } from './test-matrix-parameters';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default async function globalSetup(): Promise<void> {
  if (readServeMode() === 'server') return; // dev server builds on demand; no dist/ to check

  const bundler = readBundler();
  const fingerprint = readFingerprint();
  const buildMode = readBuildMode();

  const distDir = process.env.DIST_DIR
    ?? resolve(__dirname, `../fixtures/browser/library-app-${bundler}/dist`);

  if (!existsSync(distDir)) {
    throw new Error(
      `[global-setup] dist directory not found: ${distDir}\n` +
      `  Build the fixture before running e2e tests (bundler=${bundler}, fingerprint=${fingerprint}, build-mode=${buildMode}).`,
    );
  }
}
