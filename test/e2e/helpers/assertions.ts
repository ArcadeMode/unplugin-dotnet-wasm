import { ConsoleMessage, expect, type Page } from '@playwright/test';
import { readdirSync } from 'node:fs';

const FINGERPRINTED_LIBRARY_RE = /^Library\.[a-z0-9]+\.wasm$/;

export function expectFingerprintLayout(dir: string, fingerprint: boolean): void {
  const libraryWasms = readdirSync(dir).filter((f) => /^Library.*\.wasm$/.test(f));
  const fingerprinted = libraryWasms.filter((f) => FINGERPRINTED_LIBRARY_RE.test(f));

  if (fingerprint) {
    expect(
      fingerprinted,
      `Expected fingerprinted Library.<hash>.wasm under ${dir}, found: ${libraryWasms.join(', ') || '(none)'}`,
    ).not.toHaveLength(0);
  } else {
    expect(
      libraryWasms,
      `Expected canonical Library.wasm under ${dir}, found: ${libraryWasms.join(', ') || '(none)'}`,
    ).toContain('Library.wasm');
    expect(
      fingerprinted,
      `Expected no fingerprinted Library.<hash>.wasm under ${dir}, found: ${fingerprinted.join(', ')}`,
    ).toHaveLength(0);
  }
}

export function trackConsoleMessages(page: Page): ConsoleMessage[] {
  const seen: ConsoleMessage[] = [];
  page.on('console', (msg) => seen.push(msg));
  return seen;
}

export async function expectMessages(
  seen: ConsoleMessage[],
  expected: string[],
  timeout = 30_000,
): Promise<void> {
  await expect
    .poll(
      () => {
        const texts = seen.map((msg) => msg.text());
        return expected.every((line) => texts.includes(line));
      },
      { timeout },
    )
    .toBe(true);
}

/**
 * Wait for the `#wasm-initialized-marker` element to appear to get the init timestamp.
 * Useful for detecting page reloads (different timestamps)
 */
export async function waitForInit(
  page: Page,
  previousTs: string | null = null,
  timeout = 30_000,
): Promise<string> {
  const marker = page.locator('#wasm-initialized-marker');

  if (previousTs !== null) {
    // Automatically waits for the element to exist AND for data-ts != previousTs
    await expect(marker).not.toHaveAttribute('data-ts', previousTs, { timeout });
  } else {
    // If we don't have a previous TS, just wait for the attribute to be present
    await expect(marker).toHaveAttribute('data-ts', /.+/, { timeout });
  }

  return (await marker.getAttribute('data-ts')) ?? '';
}

/**
 * Reload until the WASM boot marker advances past `previousTs`.
 *
 * A static-served `dist/` can be mid-rewrite when we reload (e.g. a late watch
 * rebuild overlapping the reload), leaving the dotnet top-level await pending so
 * the `load` event never fires. We therefore reload with `waitUntil: 'commit'`
 * and treat a fresh init marker — not `load` — as success, retrying on timeout.
 */
export async function reloadUntilBooted(
  page: Page,
  previousTs: string,
  opts: { attempts?: number; attemptTimeout?: number } = {},
): Promise<string> {
  const attempts = opts.attempts ?? 3;
  const attemptTimeout = opts.attemptTimeout ?? 15_000;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await page.reload({ waitUntil: 'commit', timeout: attemptTimeout });
      return await waitForInit(page, previousTs, attemptTimeout);
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(
    `Page did not boot after ${attempts} reload attempts (previousTs=${previousTs}).`,
    { cause: lastErr },
  );
}
