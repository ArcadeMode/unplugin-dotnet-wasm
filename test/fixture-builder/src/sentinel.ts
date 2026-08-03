import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Sentinel file written to the app root by each bundler at end of every compile. */
const SENTINEL_FILE = '.rebuild-done';

export interface WaitForSentinelOptions {
  /** Overall timeout. Default 60_000. */
  timeoutMs?: number;
  /** How long the token must stay unchanged after a change before returning. Default 750. */
  settleMs?: number;
  /** Poll interval. Default 50. */
  pollMs?: number;
}

function sentinelPath(appDir: string): string {
  return join(appDir, SENTINEL_FILE);
}

/** Current build-done token, or `null` if the bundler has not emitted yet. */
export function readSentinel(appDir: string): string | null {
  const p = sentinelPath(appDir);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch (err) {
    // Vanished / mid-write between existsSync and read.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * Wait until the sentinel token differs from `baseline` and then stays stable
 * for `settleMs` (absorbs a double rebuild, e.g. a fingerprint rename emitting
 * twice). Pass `baseline = null` to wait for the first-ever emit.
 */
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
