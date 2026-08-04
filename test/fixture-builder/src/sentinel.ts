import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SENTINEL_FILE = '.rebuild-done';
const START_FILE = '.rebuild-start';

export interface WaitForSentinelOptions {
  timeoutMs?: number;
  settleMs?: number;
  pollMs?: number;
}

function sentinelPath(appDir: string): string {
  return join(appDir, SENTINEL_FILE);
}

export function readDoneSentinel(appDir: string): string | null {
  const p = sentinelPath(appDir);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export function readStartSentinel(appDir: string): number | null {
  const p = join(appDir, START_FILE);
  if (!existsSync(p)) return null;
  try {
    const n = Number(readFileSync(p, 'utf8').trim());
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

interface DoneToken {
  raw: string;
  seq: number;
  status: 'ok' | 'error';
}

function parseDone(raw: string | null): DoneToken | null {
  if (raw === null) return null;
  const idx = raw.indexOf(':');
  if (idx === -1) {
    const seq = Number(raw);
    return { raw, seq: Number.isFinite(seq) ? seq : 0, status: 'ok' };
  }
  const seq = Number(raw.slice(0, idx));
  return {
    raw,
    seq: Number.isFinite(seq) ? seq : 0,
    status: raw.slice(idx + 1) === 'error' ? 'error' : 'ok',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export async function waitForBuildSentinelFiles(
  appDir: string,
  baseline: string | null,
  opts: WaitForSentinelOptions = {},
): Promise<string> {
  let candidate: string | null = null;
  let stableSince = 0;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const settleMs = opts.settleMs ?? 500;
  const pollMs = opts.pollMs ?? 50;
  await sleep(pollMs); // Give the build a chance to start before we poll status sentinel files
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Read done first, then start: a start written in-between can only make the
    // pair look more in-progress, never falsely quiescent.
    const doneRaw = readDoneSentinel(appDir);
    const startSeq = readStartSentinel(appDir);
    const done = parseDone(doneRaw);

    if (done !== null && doneRaw !== baseline) {
      if (done.status === 'error') {
        throw new Error(`Build reported an error (done=${doneRaw}).`);
      }
      const inFlight = startSeq !== null && startSeq > done.seq;
      if (inFlight) {
        candidate = null;
        stableSince = 0;
      } else if (doneRaw !== candidate) {
        candidate = doneRaw;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= settleMs) {
        return doneRaw as string;
      }
    }

    await sleep(pollMs);
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for a quiescent rebuild` +
      ` (baseline=${baseline ?? 'none'}, last=${candidate ?? readDoneSentinel(appDir) ?? 'none'}).`,
  );
}
