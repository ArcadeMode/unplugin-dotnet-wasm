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
  /** How long the inventory must stay unchanged after a change. Default 2000. */
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

/**
 * Entry chunk shapes across fixture bundlers (mirrors e2e `entryChunkPath`):
 * - `entry.js` (node; browser esbuild/bun)
 * - `assets/entry.js` (webpack/rspack/rollup/rolldown)
 * - `assets/index.js` / `assets/index[-._]<hash>.js` (vite/farm/rsbuild)
 */
function hasEntryBundle(inv: DistInventory): boolean {
  if (inv.has('entry.js') || inv.has('assets/entry.js')) return true;
  for (const key of inv.keys()) {
    if (/^assets\/index([._-][^/]+)?\.js$/.test(key)) return true;
  }
  return false;
}

const MIN_WASM_ASSETS = 5;

function wasmAssetCount(inv: DistInventory): number {
  let n = 0;
  for (const key of inv.keys()) {
    if (key.endsWith('.wasm')) n += 1;
  }
  return n;
}

export function isDistReady(inv: DistInventory): boolean {
  return hasEntryBundle(inv) && wasmAssetCount(inv) >= MIN_WASM_ASSETS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export async function waitForDistChange(
  distDir: string,
  baseline: DistInventory,
  opts: WaitForDistOptions = {},
): Promise<DistInventory> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const quietMs = opts.quietMs ?? 2_000;
  const pollMs = opts.pollMs ?? 100;
  const deadline = Date.now() + timeoutMs;

  let sawChange = false;
  let quietSince: number | null = null;
  let last: DistInventory = snapshotDist(distDir);

  while (Date.now() < deadline) {
    const current = snapshotDist(distDir);

    if (!isDistReady(current)) {
      if (!inventoryEqual(current, baseline)) sawChange = true;
      quietSince = null;
      last = current;
    } else if (!sawChange) {
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
      ` (sawChange=${sawChange}, ready=${isDistReady(last)}, files=${last.size},` +
      ` wasm=${wasmAssetCount(last)}).`,
  );
}

export async function waitForDistReady(
  distDir: string,
  opts: WaitForDistOptions = {},
): Promise<DistInventory> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const quietMs = opts.quietMs ?? 2_000;
  const pollMs = opts.pollMs ?? 100;
  const deadline = Date.now() + timeoutMs;

  let quietSince: number | null = null;
  let last: DistInventory = snapshotDist(distDir);

  while (Date.now() < deadline) {
    const current = snapshotDist(distDir);
    if (!isDistReady(current)) {
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

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for initial dist/ emit` +
      ` (ready=${isDistReady(last)}, files=${last.size}, wasm=${wasmAssetCount(last)}).`,
  );
}
