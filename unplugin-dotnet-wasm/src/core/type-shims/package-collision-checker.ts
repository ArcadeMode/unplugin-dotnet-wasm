import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { IdempotentFileWriter } from './idempotent-file-writer';

export interface CollisionSentinelFile {
  name: string;
  content: string;
}

/**
 * Guards against overwriting a real dependency that happens to share a generated
 * package's name. The sentinel file serves as a marker that the dir is ours.
 */
export class PackageCollisionChecker {
  constructor(
    private readonly writer: IdempotentFileWriter,
    private readonly sentinel: CollisionSentinelFile,
  ) {}

  async ensureCollisionFree(dir: string): Promise<boolean> {
    const sentinelPath = join(dir, this.sentinel.name);
    if (existsSync(sentinelPath)) return true; // already ours
    if (existsSync(dir) && readdirSync(dir).length > 0) return false; // foreign

    await this.writer.write(sentinelPath, this.sentinel.content);
    return true;
  }
}
