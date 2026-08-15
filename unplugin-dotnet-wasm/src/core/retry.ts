import { DiscoveryError } from './manifest-parsing/discover';
import { EndpointsManifestParseError } from './manifest-parsing/manifest-endpoints';
import { ManifestParseError } from './manifest-parsing/manifest-runtime';

export interface RetryIOUntilOptions {
  timeoutMs: number;
  pollMs: number;
}

export interface RetryIOUntilResult {
  ok: boolean;
  attempts: number;
  lastError: unknown;
}

const FILE_READ_ERRNO = new Set(['EBUSY', 'ENOENT', 'EACCES', 'EPERM', 'EAGAIN', 'EIO']);

export function isFileReadError(err: unknown): boolean {
  if (
    err instanceof DiscoveryError ||
    err instanceof EndpointsManifestParseError ||
    err instanceof ManifestParseError
  ) {
    return true;
  }
  const code = (err as NodeJS.ErrnoException).code;
  return typeof code === 'string' && FILE_READ_ERRNO.has(code);
}

export async function retryIOUntil(
  attempt: () => Promise<boolean>,
  opts: RetryIOUntilOptions,
): Promise<RetryIOUntilResult> {
  const deadline = Date.now() + opts.timeoutMs;
  let lastError: unknown = undefined;
  let attempts = 1;
  while (true) {
    attempts++;
    lastError = undefined;
    let ok = false;
    try {
      ok = await attempt();
    } catch (err) {
      if (!isFileReadError(err)) throw err;
      lastError = err;
    }
    if (ok) return { ok: true, attempts, lastError };
    if (Date.now() >= deadline) return { ok: false, attempts, lastError };
    await new Promise((resolve) => setTimeout(resolve, opts.pollMs));
  }
}
