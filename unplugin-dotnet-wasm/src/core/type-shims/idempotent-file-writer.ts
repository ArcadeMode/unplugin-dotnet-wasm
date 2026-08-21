import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

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
