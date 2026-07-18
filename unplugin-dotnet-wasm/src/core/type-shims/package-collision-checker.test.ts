import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IdempotentFileWriter } from './idempotent-file-writer';
import { PackageCollisionChecker, type CollisionSentinelFile } from './package-collision-checker';

const TEST_SENTINEL: CollisionSentinelFile = {
  name: '.test-sentinel',
  content: 'marker\n',
};

describe('PackageCollisionChecker.ensureCollisionFree', () => {
  it('creates sentinel in absent subdir and returns true', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'collision-'));
    const pkgDir = join(tmpDir, 'pkg');

    const writer = new IdempotentFileWriter();
    const checker = new PackageCollisionChecker(writer, TEST_SENTINEL);

    const result = await checker.ensureCollisionFree(pkgDir);

    expect(result).toBe(true);
    expect(existsSync(join(pkgDir, '.test-sentinel'))).toBe(true);
    expect(readFileSync(join(pkgDir, '.test-sentinel'), 'utf8')).toBe('marker\n');
  });

  it('creates sentinel in empty existing dir and returns true', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'collision-'));
    const pkgDir = join(tmpDir, 'pkg');
    mkdirSync(pkgDir);

    const writer = new IdempotentFileWriter();
    const checker = new PackageCollisionChecker(writer, TEST_SENTINEL);

    const result = await checker.ensureCollisionFree(pkgDir);

    expect(result).toBe(true);
    expect(existsSync(join(pkgDir, '.test-sentinel'))).toBe(true);
    expect(readFileSync(join(pkgDir, '.test-sentinel'), 'utf8')).toBe('marker\n');
  });

  it('returns true for dir already containing our sentinel (no clobber of sibling files)', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'collision-'));
    const pkgDir = join(tmpDir, 'pkg');
    mkdirSync(pkgDir);
    const dummyPath = join(pkgDir, 'dummy.txt');
    const dummyContent = 'dummy file content\n';
    writeFileSync(dummyPath, dummyContent);
    const sentinelPath = join(pkgDir, '.test-sentinel');
    writeFileSync(sentinelPath, TEST_SENTINEL.content);

    const writer = new IdempotentFileWriter();
    const checker = new PackageCollisionChecker(writer, TEST_SENTINEL);

    const result = await checker.ensureCollisionFree(pkgDir);

    expect(result).toBe(true);
    expect(readFileSync(dummyPath, 'utf8')).toBe(dummyContent); // unchanged
    expect(readFileSync(sentinelPath, 'utf8')).toBe(TEST_SENTINEL.content); // unchanged
  });

  it('returns false for foreign dir (non-empty without sentinel) and writes nothing', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'collision-'));
    const pkgDir = join(tmpDir, 'pkg');
    mkdirSync(pkgDir);
    const pkgJsonPath = join(pkgDir, 'package.json');
    const pkgJsonContent = '{"name":"typeshim","version":"9.9.9"}\n';
    writeFileSync(pkgJsonPath, pkgJsonContent);
    const dummyPath = join(pkgDir, 'dummy.js');
    const dummyContent = 'module.exports = {};\n';
    writeFileSync(dummyPath, dummyContent);

    const writer = new IdempotentFileWriter();
    const checker = new PackageCollisionChecker(writer, TEST_SENTINEL);

    const result = await checker.ensureCollisionFree(pkgDir);

    expect(result).toBe(false);
    expect(readFileSync(pkgJsonPath, 'utf8')).toBe(pkgJsonContent); // unchanged
    expect(readFileSync(dummyPath, 'utf8')).toBe(dummyContent); // unchanged
    expect(existsSync(join(pkgDir, '.test-sentinel'))).toBe(false); // sentinel not written
    expect(readdirSync(pkgDir)).toEqual(['dummy.js', 'package.json']); // same files
  });
});
