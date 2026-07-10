import { describe, test, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBundler, readFingerprint, readBuildMode, readPlatform } from '../test-matrix-parameters';

const currentBundler = readBundler();
const currentFingerprint = readFingerprint();
const currentBuildMode = readBuildMode();
const currentPlatform = readPlatform();

const __dirname = resolve(fileURLToPath(import.meta.url), '..');

const skipSuite = currentPlatform !== 'node' || currentBuildMode === 'none';

describe(`[${currentBundler}][${currentFingerprint}][${currentBuildMode}][${currentPlatform}] Node WASM runtime interop`, { skip: skipSuite }, () => {
  test('runs .NET WASM interop scenarios end-to-end', () => {
    const fixtureDir = resolve(__dirname, `../../fixtures/node/library-app-${currentBundler}`);

    const result = spawnSync('node', ['dist/entry.js'], {
      cwd: fixtureDir,
      encoding: 'utf8',
      timeout: 60_000,
    });

    if (result.status !== 0 || !result.stdout.includes('[SUCCESS]') || result.stdout.includes('[FAILURE]')) {
      const diagnostics = [
        `Exit code: ${result.status}`,
        `\nStdout:\n${result.stdout}`,
        result.stderr ? `\nStderr:\n${result.stderr}` : '',
        result.error ? `\nSpawn error: ${result.error.message}` : '',
      ].join('');
      throw new Error(`Fixture ${currentBundler} failed:\n${diagnostics}`);
    }

    expect(result.stdout).toContain('[SUCCESS]');

    expect(result.stdout).toContain('[Echo.Greet]');
    expect(result.stdout).toContain('[Echo.Add]');
    expect(result.stdout).toContain('[Echo.BoolNot]');
    expect(result.stdout).toContain('[Echo.Pi]');
    expect(result.stdout).toContain('[Counter]');
    expect(result.stdout).toContain('[AsyncOps.DelayThenEcho]');
    expect(result.stdout).toContain('[Throws.Boom]');
  });
});
