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

test.describe('M1.6.c — WASM interop', () => {
  test.describe.configure({ mode: 'serial' });

  let pg!: Page;

  test.beforeAll(async ({ browser }) => {
    pg = await browser.newPage();
    await pg.goto('/');
    await pg.waitForFunction(() => globalThis.__libReady === true, { timeout: 30_000 });
  });

  test.afterAll(() => pg?.close());

  test('Echo.Greet returns greeting string', async () => {
    const result = await pg.evaluate(() => globalThis.__lib.greet('world'));
    expect(result).toBe('Hello, world');
  });

  test('Echo.Add returns correct sum', async () => {
    const result = await pg.evaluate(() => globalThis.__lib.add(2, 3));
    expect(result).toBe(5);
  });

  test('Echo.BoolNot inverts boolean', async () => {
    const t = await pg.evaluate(() => globalThis.__lib.boolNot(true));
    const f = await pg.evaluate(() => globalThis.__lib.boolNot(false));
    expect(t).toBe(false);
    expect(f).toBe(true);
  });

  test('Echo.Pi approximates Math.PI', async () => {
    const result = await pg.evaluate(() => globalThis.__lib.pi());
    expect(result).toBeCloseTo(Math.PI, 4);
  });

  test('Counter accumulates state across calls', async () => {
    const v1 = await pg.evaluate(() => globalThis.__lib.incrementCounter());
    const v2 = await pg.evaluate(() => globalThis.__lib.incrementCounter());
    expect(typeof v1).toBe('number');
    expect(v2).toBe(v1 + 1);
  });

  test('AsyncOps.DelayThenEcho round-trips a string', async () => {
    const result = await pg.evaluate(() =>
      globalThis.__lib.delayThenEcho('hello', 10)
    );
    expect(result).toBe('hello');
  });

  test('Throws.Boom propagates a .NET exception to JS', async () => {
    const caught = await pg.evaluate(async () => {
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
