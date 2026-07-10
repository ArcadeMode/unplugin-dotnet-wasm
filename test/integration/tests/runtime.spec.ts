import { test, expect, type Page } from '@playwright/test';

interface DotnetLib {
  greet(name: string): string;
  add(a: number, b: number): number;
  boolNot(value: boolean): boolean;
  pi(): number;
  incrementCounter(): number;
  delayThenEcho(value: string, delayMs: number): Promise<string>;
  boom(): void;
}

declare global {
  var __lib: DotnetLib;
  var __libReady: boolean;
}

import { readBundler, readFingerprint, readBuildMode, readPlatform } from '../test-matrix-parameters';

const currentBundler = readBundler();
const currentFingerprint = readFingerprint();
const currentBuildMode = readBuildMode();
const currentPlatform = readPlatform();
test.describe(`[${currentBundler}][${currentFingerprint}][${currentBuildMode}][${currentPlatform}] WASM interop runtime behavior`, () => {
  test.describe.configure({ mode: 'serial' });

  let page!: Page;

  test.beforeAll(async ({ browser }) => {
    test.skip(currentBuildMode === 'none', 'skipped for "none" build mode');
    test.skip(currentPlatform !== 'browser', 'skipped for non-browser platform');

    page = await browser.newPage();
    await page.goto('/');
    await page.waitForFunction(() => globalThis.__libReady === true, { timeout: 30_000 });
  });

  test.afterAll(() => page?.close());

  test('Echo.Greet returns greeting string', async () => {
    const result = await page.evaluate(() => globalThis.__lib.greet('world'));
    expect(result).toBe('Hello, world');
  });

  test('Echo.Add returns correct sum', async () => {
    const result = await page.evaluate(() => globalThis.__lib.add(2, 3));
    expect(result).toBe(5);
  });

  test('Echo.BoolNot inverts boolean', async () => {
    const t = await page.evaluate(() => globalThis.__lib.boolNot(true));
    const f = await page.evaluate(() => globalThis.__lib.boolNot(false));
    expect(t).toBe(false);
    expect(f).toBe(true);
  });

  test('Echo.Pi approximates Math.PI', async () => {
    const result = await page.evaluate(() => globalThis.__lib.pi());
    expect(result).toBeCloseTo(Math.PI, 4);
  });

  test('Counter accumulates state across calls', async () => {
    const v1 = await page.evaluate(() => globalThis.__lib.incrementCounter());
    const v2 = await page.evaluate(() => globalThis.__lib.incrementCounter());
    expect(typeof v1).toBe('number');
    expect(v2).toBe(v1 + 1);
  });

  test('AsyncOps.DelayThenEcho round-trips a string', async () => {
    const result = await page.evaluate(() =>
      globalThis.__lib.delayThenEcho('hello', 10)
    );
    expect(result).toBe('hello');
  });

  test('Throws.Boom propagates a .NET exception to JS', async () => {
    const caught = await page.evaluate(async () => {
      try {
        globalThis.__lib.boom();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    });
    expect(caught).toBeTruthy();
  });
});
