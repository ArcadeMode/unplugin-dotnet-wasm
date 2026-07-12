import { describe, it, expect } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { NodeModulesLocator } from './node-modules-locator';

describe('NodeModulesLocator', () => {
  it('returns <root>/node_modules when it exists', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'locator-'));
    const nodeModulesDir = join(tempDir, 'node_modules');
    await mkdir(nodeModulesDir, { recursive: true });

    const locator = new NodeModulesLocator(tempDir);
    const resolved = locator.resolve();

    expect(resolved).toBe(nodeModulesDir);
  });

  it('walks up to an ancestor\'s node_modules', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'locator-'));
    const ancestorDir = tempDir;
    const nodeModulesDir = join(ancestorDir, 'node_modules');
    await mkdir(nodeModulesDir, { recursive: true });

    const deepDir = join(tempDir, 'deep', 'nested', 'dir');
    await mkdir(deepDir, { recursive: true });

    const locator = new NodeModulesLocator(deepDir);
    const resolved = locator.resolve();

    expect(resolved).toBe(nodeModulesDir);
  });

  it('falls back to <root>/node_modules when none exists', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'locator-'));

    const locator = new NodeModulesLocator(tempDir);
    const resolved = locator.resolve();

    expect(resolved).toBe(join(tempDir, 'node_modules'));
  });

  it('caches the result (second call returns the same value without re-probing)', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'locator-'));
    const nodeModulesDir = join(tempDir, 'node_modules');
    await mkdir(nodeModulesDir, { recursive: true });

    const locator = new NodeModulesLocator(tempDir);
    const first = locator.resolve();
    const second = locator.resolve();

    expect(second).toBe(first);
  });
});
