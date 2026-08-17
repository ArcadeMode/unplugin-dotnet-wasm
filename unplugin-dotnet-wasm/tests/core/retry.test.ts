import { describe, it, expect } from 'vitest';
import { isFileReadError, retryIOUntil } from '@src/core/retry';
import { DiscoveryError } from '@src/core/manifest-parsing/discover';
import { EndpointsManifestParseError } from '@src/core/manifest-parsing/manifest-endpoints';
import { ManifestParseError } from '@src/core/manifest-parsing/manifest-runtime';

function errno(code: string): NodeJS.ErrnoException {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe('isFileReadError', () => {
  it.each(['EBUSY', 'ENOENT', 'EACCES', 'EPERM', 'EAGAIN', 'EIO'])('accepts errno %s', (code) => {
    expect(isFileReadError(errno(code))).toBe(true);
  });

  it('accepts missing-file and torn-parse errors', () => {
    expect(isFileReadError(new DiscoveryError('missing', {}))).toBe(true);
    expect(isFileReadError(new EndpointsManifestParseError('torn', []))).toBe(true);
    expect(isFileReadError(new ManifestParseError('torn', []))).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isFileReadError(new Error('boom'))).toBe(false);
    expect(isFileReadError(errno('EMFILE'))).toBe(false);
  });
});

describe('retryIOUntil', () => {
  it('returns ok on the first true attempt', async () => {
    const result = await retryIOUntil(async () => true, { timeoutMs: 1_000, pollMs: 0 });
    expect(result).toEqual({ ok: true, attempts: 1, lastError: undefined });
  });

  it('retries a false return until the attempt succeeds', async () => {
    let n = 0;
    const result = await retryIOUntil(
      async () => {
        n += 1;
        return n >= 3;
      },
      { timeoutMs: 1_000, pollMs: 0 },
    );
    expect(result).toEqual({ ok: true, attempts: 3, lastError: undefined });
  });

  it('treats a file-read throw as not-ready and keeps going', async () => {
    let n = 0;
    const result = await retryIOUntil(
      async () => {
        n += 1;
        if (n < 3) throw errno('EBUSY');
        return true;
      },
      { timeoutMs: 1_000, pollMs: 0 },
    );
    expect(result).toEqual({ ok: true, attempts: 3, lastError: undefined });
  });

  it('propagates a non-file-read throw immediately', async () => {
    await expect(
      retryIOUntil(
        async () => {
          throw new Error('boom');
        },
        { timeoutMs: 1_000, pollMs: 0 },
      ),
    ).rejects.toThrow('boom');
  });

  it('gives up at the deadline after false returns', async () => {
    const result = await retryIOUntil(async () => false, { timeoutMs: 0, pollMs: 0 });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.lastError).toBeUndefined();
  });

  it('gives up at the deadline after file-read throws without propagating', async () => {
    const busy = errno('EBUSY');
    const result = await retryIOUntil(
      async () => {
        throw busy;
      },
      { timeoutMs: 0, pollMs: 0 },
    );
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.lastError).toBe(busy);
  });
});
