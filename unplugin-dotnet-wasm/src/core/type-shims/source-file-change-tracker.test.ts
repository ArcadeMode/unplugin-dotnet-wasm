import { describe, it, expect } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { SourceFileChangeTracker } from './source-file-change-tracker';

describe('SourceFileChangeTracker', () => {
  it('returns true for a newly-seen file', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tracker-'));
    const filePath = join(tempDir, 'test.ts');
    await writeFile(filePath, 'content');

    const tracker = new SourceFileChangeTracker();
    const changed = await tracker.hasChanged(filePath);

    expect(changed).toBe(true);
  });

  it('returns false when the file mtime is unchanged', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tracker-'));
    const filePath = join(tempDir, 'test.ts');
    await writeFile(filePath, 'content');

    const tracker = new SourceFileChangeTracker();
    const first = await tracker.hasChanged(filePath);
    expect(first).toBe(true); // first call is always "changed"

    const second = await tracker.hasChanged(filePath);
    expect(second).toBe(false); // mtime unchanged
  });

  it('returns true when the file mtime is bumped', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tracker-'));
    const filePath = join(tempDir, 'test.ts');
    await writeFile(filePath, 'content');

    const tracker = new SourceFileChangeTracker();
    const first = await tracker.hasChanged(filePath);
    expect(first).toBe(true);

    // Rewrite the file with a slight delay to ensure mtime changes.
    await new Promise(resolve => setTimeout(resolve, 10));
    await writeFile(filePath, 'updated content');

    const second = await tracker.hasChanged(filePath);
    expect(second).toBe(true);
  });

  it('returns true on stat failure (file not found)', async () => {
    const tracker = new SourceFileChangeTracker();
    const nonExistentPath = '/nonexistent/path/to/file.ts';
    const changed = await tracker.hasChanged(nonExistentPath);

    expect(changed).toBe(true);
  });

  it('records mtime even when file is first-seen', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tracker-'));
    const filePath = join(tempDir, 'test.ts');
    await writeFile(filePath, 'content');

    const tracker = new SourceFileChangeTracker();
    await tracker.hasChanged(filePath);

    // Second call should return false (mtime unchanged).
    const second = await tracker.hasChanged(filePath);
    expect(second).toBe(false);
  });

  it('handles multiple files independently', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tracker-'));
    const file1 = join(tempDir, 'file1.ts');
    const file2 = join(tempDir, 'file2.ts');
    await writeFile(file1, 'content1');
    await writeFile(file2, 'content2');

    const tracker = new SourceFileChangeTracker();
    const changed1 = await tracker.hasChanged(file1);
    expect(changed1).toBe(true);

    const changed2 = await tracker.hasChanged(file2);
    expect(changed2).toBe(true);

    // On subsequent calls, both should be unchanged.
    const unchanged1 = await tracker.hasChanged(file1);
    expect(unchanged1).toBe(false);

    const unchanged2 = await tracker.hasChanged(file2);
    expect(unchanged2).toBe(false);
  });
});
