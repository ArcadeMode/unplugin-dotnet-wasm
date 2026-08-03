import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SENTINEL_FILE = '.rebuild-done';

export interface WaitForSentinelOptions {
  timeoutMs?: number;
  settleMs?: number;
  pollMs?: number;
}

function sentinelPath(appDir: string): string {
  return join(appDir, SENTINEL_FILE);
}

export function readSentinel(appDir: string): string | null {
  const p = sentinelPath(appDir);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export async function waitForSentinel(
  appDir: string,
  baseline: string | null,
  opts: WaitForSentinelOptions = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const settleMs = opts.settleMs ?? 750;
  const pollMs = opts.pollMs ?? 50;
  const deadline = Date.now() + timeoutMs;

  let changedTo: string | null = null;
  let stableSince = 0;

  while (Date.now() < deadline) {
    const current = readSentinel(appDir);

    if (current !== null && current !== baseline) {
      if (current !== changedTo) {
        changedTo = current;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= settleMs) {
        return current;
      }
    }

    await sleep(pollMs);
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for the build-done sentinel` +
      ` (baseline=${baseline ?? 'none'}, last=${changedTo ?? readSentinel(appDir) ?? 'none'}).`,
  );
}
