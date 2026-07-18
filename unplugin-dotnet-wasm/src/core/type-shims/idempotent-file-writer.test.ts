import { describe, it, expect } from 'vitest';
import { writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { IdempotentFileWriter } from './idempotent-file-writer';

describe('IdempotentFileWriter', () => {
  it('writes when the file is absent', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'writer-'));
    const filePath = join(tempDir, 'test.txt');
    const writer = new IdempotentFileWriter();

    const written = await writer.write(filePath, 'content');

    expect(written).toBe(true);
    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('content');
  });

  it('returns false and does not change mtime when content is identical', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'writer-'));
    const filePath = join(tempDir, 'test.txt');
    const writer = new IdempotentFileWriter();

    // Write initially
    await writer.write(filePath, 'content');
    const firstStat = await stat(filePath);

    // Wait a bit to ensure mtime would change if rewritten
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Write the same content again
    const written = await writer.write(filePath, 'content');

    expect(written).toBe(false);
    const secondStat = await stat(filePath);
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
  });

  it('writes and returns true when content differs', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'writer-'));
    const filePath = join(tempDir, 'test.txt');
    const writer = new IdempotentFileWriter();

    // Write initially
    await writer.write(filePath, 'original');
    const firstStat = await stat(filePath);

    // Wait a bit to ensure mtime changes
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Write different content
    const written = await writer.write(filePath, 'updated');

    expect(written).toBe(true);
    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('updated');
    const secondStat = await stat(filePath);
    expect(secondStat.mtimeMs).toBeGreaterThan(firstStat.mtimeMs);
  });

  it('creates missing parent directories', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'writer-'));
    const filePath = join(tempDir, 'nested', 'deep', 'dir', 'test.txt');
    const writer = new IdempotentFileWriter();

    const written = await writer.write(filePath, 'content');

    expect(written).toBe(true);
    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('content');
  });

  it('self-heals a corrupted (unreadable) file', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'writer-'));
    const filePath = join(tempDir, 'test.txt');
    const writer = new IdempotentFileWriter();

    // Write initial content
    await writeFile(filePath, 'original');

    // Replace with invalid/binary content that will fail to read as utf8
    await writeFile(filePath, Buffer.from([0xff, 0xfe]));

    // Attempt to write new content
    const written = await writer.write(filePath, 'healed');

    expect(written).toBe(true);
    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('healed');
  });
});
