import { describe, test, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readBundler,
  readFingerprint,
  readBuildMode,
  readPlatform,
  readServeMode,
} from '../test-matrix-parameters';

const currentBundler = readBundler();
const currentFingerprint = readFingerprint();
const currentBuildMode = readBuildMode();
const currentPlatform = readPlatform();
const currentServeMode = readServeMode();

const __dirname = resolve(fileURLToPath(import.meta.url), '..');

const skipSuite =
  currentPlatform !== 'node' ||
  currentBuildMode === 'none' ||
  currentServeMode !== 'server' ||
  currentBundler !== 'vite';

// Bundler-agnostic: each node dev-server fixture exposes a stable `serve:debug`/`serve:release`
// script contract (mirrors build:debug/build:release). All runner/config/mode details are
// hidden behind those script names, so this test never needs per-bundler changes.
describe(
  `[${currentBundler}][${currentFingerprint}][${currentBuildMode}][${currentPlatform}][server] Node dev-server WASM runtime interop`,
  { skip: skipSuite },
  () => {
    test('boots .NET WASM under the node dev server (Vitest SSR) and runs interop', () => {
      const fixtureDir = resolve(__dirname, `../../fixtures/node/library-app-${currentBundler}`);
      const script = currentBuildMode === 'publish' ? 'serve:release' : 'serve:debug';

      const result = spawnSync('pnpm', ['run', script], {
        cwd: fixtureDir,
        encoding: 'utf8',
        timeout: 90_000,
        shell: true,
      });

      if (result.status !== 0) {
        const diagnostics = [
          `Exit code: ${result.status}`,
          `\nStdout:\n${result.stdout}`,
          result.stderr ? `\nStderr:\n${result.stderr}` : '',
          result.error ? `\nSpawn error: ${result.error.message}` : '',
        ].join('');
        throw new Error(
          `Fixture ${currentBundler} serve:${currentBuildMode} failed:\n${diagnostics}`,
        );
      }

      expect(result.status).toBe(0);
    });
  },
);
