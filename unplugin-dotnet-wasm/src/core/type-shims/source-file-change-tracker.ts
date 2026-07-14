import { stat } from 'node:fs/promises';

export class SourceFileChangeTracker {
  private readonly mtimes = new Map<string, number>();

  async hasChanged(absPath: string): Promise<boolean> {
    try {
      const s = await stat(absPath);
      const newMtime = s.mtimeMs;
      const oldMtime = this.mtimes.get(absPath);
      this.mtimes.set(absPath, newMtime);
      return oldMtime === undefined || oldMtime !== newMtime;
    } catch {
      // Stat failure, treat as changed to be safe.
      return true;
    }
  }
}
