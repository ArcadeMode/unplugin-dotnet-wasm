import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Write `content` to `absPath` only if it differs from what is already on disk,
 * so an unchanged rebuild does not bump the file's mtime (which would trigger
 * spurious tsserver / bundler-watch churn). Ensures the parent dir exists.
 * A read failure on an existing file falls through to a write, so a corrupted
 * or unreadable file self-heals. Returns whether a write happened.
 */
export class IdempotentFileWriter {
  async write(absPath: string, content: string): Promise<boolean> {
    if (existsSync(absPath)) {
      try {
        const existing = await readFile(absPath, 'utf8');
        if (existing === content) return false;
      } catch {
        // Read failed → write to be safe (ensures a corrupted file self-heals).
      }
    }

    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, content, 'utf8');
    return true;
  }
}
