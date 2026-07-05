import { describe, test, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBundler, readShape, readPlatform } from '../test-matrix-parameters';

const currentBundler = readBundler();
const currentShape = readShape();
const currentPlatform = readPlatform();

const __dirname = resolve(fileURLToPath(import.meta.url), '..');

// Skip entire suite if not node platform or if shape is 'none'
const skipSuite = currentPlatform !== 'node' || currentShape === 'none';

describe(`[${currentBundler}][${currentShape}][${currentPlatform}] Node WASM runtime interop`, { skip: skipSuite }, () => {
  test('runs .NET WASM interop scenarios end-to-end', () => {
    const fixtureDir = resolve(__dirname, `../../fixtures/node/library-app-${currentBundler}`);
    
    const result = spawnSync('node', ['dist/entry.js'], {
      cwd: fixtureDir,
      encoding: 'utf8',
      timeout: 60_000,
    });

    // On error, include stdout and stderr in the error message for diagnostics
    if (result.status !== 0 || !result.stdout.includes('[SUCCESS]') || result.stdout.includes('[FAILURE]')) {
      const diagnostics = [
        `Exit code: ${result.status}`,
        `\nStdout:\n${result.stdout}`,
        result.stderr ? `\nStderr:\n${result.stderr}` : '',
        result.error ? `\nSpawn error: ${result.error.message}` : '',
      ].join('');
      throw new Error(`Fixture ${currentBundler} failed:\n${diagnostics}`);
    }

    // Verify success marker is present
    expect(result.stdout).toContain('[SUCCESS]');
    
    // Verify all test assertions were executed
    expect(result.stdout).toContain('[Echo.Greet]');
    expect(result.stdout).toContain('[Echo.Add]');
    expect(result.stdout).toContain('[Echo.BoolNot]');
    expect(result.stdout).toContain('[Echo.Pi]');
    expect(result.stdout).toContain('[Counter]');
    expect(result.stdout).toContain('[AsyncOps.DelayThenEcho]');
    expect(result.stdout).toContain('[Throws.Boom]');
  });
});
