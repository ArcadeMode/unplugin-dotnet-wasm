import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface DistFileMeta {
  mtimeMs: number;
  size: number;
}

/** Relative posix path under `dist/` → file meta. */
export type DistInventory = Map<string, DistFileMeta>;

export interface WaitForDistOptions {
  /** Overall timeout. Default 60_000. */
  timeoutMs?: number;
  /** How long the inventory must stay unchanged after a change. Default 400. */
  quietMs?: number;
  /** Poll interval. Default 100. */
  pollMs?: number;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Recursive walk of `distDir`; empty map if the directory does not exist yet. */
export function snapshotDist(distDir: string): DistInventory {
  const out: DistInventory = new Map();
  if (!existsSync(distDir)) return out;

  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      // Dist may be mid-clean during a watch rebuild.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const st = statSync(abs);
        out.set(toPosix(relative(distDir, abs)), { mtimeMs: st.mtimeMs, size: st.size });
      } catch (err) {
        // File vanished between readdir and stat (webpack/vite `clean` / rename).
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
    }
  };
  walk(distDir);
  return out;
}

export function inventoryEqual(a: DistInventory, b: DistInventory): boolean {
  if (a.size !== b.size) return false;
  for (const [key, meta] of a) {
    const other = b.get(key);
    if (!other || other.mtimeMs !== meta.mtimeMs || other.size !== meta.size) return false;
  }
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * Wait until `dist/` differs from `baseline` and then remains unchanged for
 * `quietMs` (covers multi-file non-atomic emits).
 */
export async function waitForDistChange(
  distDir: string,
  baseline: DistInventory,
  opts: WaitForDistOptions = {},
): Promise<DistInventory> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const quietMs = opts.quietMs ?? 400;
  const pollMs = opts.pollMs ?? 100;
  const deadline = Date.now() + timeoutMs;

  let sawChange = false;
  let quietSince: number | null = null;
  let last: DistInventory = snapshotDist(distDir);

  while (Date.now() < deadline) {
    const current = snapshotDist(distDir);
    if (!sawChange) {
      if (!inventoryEqual(current, baseline)) {
        sawChange = true;
        quietSince = Date.now();
        last = current;
      }
    } else if (!inventoryEqual(current, last)) {
      quietSince = Date.now();
      last = current;
    } else if (quietSince !== null && Date.now() - quietSince >= quietMs) {
      return current;
    }

    await sleep(pollMs);
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for dist/ to change and stabilize` +
      ` (sawChange=${sawChange}, files=${last.size}).`,
  );
}

/**
 * Wait until `dist/` is non-empty and stays unchanged for `quietMs`
 * (initial watch emit).
 */
export async function waitForDistReady(
  distDir: string,
  opts: WaitForDistOptions = {},
): Promise<DistInventory> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const quietMs = opts.quietMs ?? 400;
  const pollMs = opts.pollMs ?? 100;
  const deadline = Date.now() + timeoutMs;

  let quietSince: number | null = null;
  let last: DistInventory = snapshotDist(distDir);

  while (Date.now() < deadline) {
    const current = snapshotDist(distDir);
    if (current.size === 0) {
      quietSince = null;
      last = current;
    } else if (!inventoryEqual(current, last)) {
      quietSince = Date.now();
      last = current;
    } else if (quietSince !== null && Date.now() - quietSince >= quietMs) {
      return current;
    } else if (quietSince === null) {
      quietSince = Date.now();
      last = current;
    }

    await sleep(pollMs);
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for initial dist/ emit.`);
}
