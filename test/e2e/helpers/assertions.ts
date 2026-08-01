import { ConsoleMessage, expect, type Page } from '@playwright/test';

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
