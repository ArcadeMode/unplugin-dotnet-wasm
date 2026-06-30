import { test, expect, type Page } from '@playwright/test';

test.describe('M1.6.c — WASM interop', () => {
  test.describe.configure({ mode: 'serial' });

  let pg!: Page;

  test.beforeAll(async ({ browser }) => {
    pg = await browser.newPage();
    await pg.goto('/');
    await pg.waitForFunction(() => (window as any).__libReady === true, { timeout: 30_000 });
  });

  test.afterAll(() => pg?.close());

  test('Echo.Greet returns greeting string', async () => {
    const result = await pg.evaluate(() => (window as any).__lib.greet('world'));
    expect(result).toBe('Hello, world');
  });

  test('Echo.Add returns correct sum', async () => {
    const result = await pg.evaluate(() => (window as any).__lib.add(2, 3));
    expect(result).toBe(5);
  });

  test('Echo.BoolNot inverts boolean', async () => {
    const t = await pg.evaluate(() => (window as any).__lib.boolNot(true));
    const f = await pg.evaluate(() => (window as any).__lib.boolNot(false));
    expect(t).toBe(false);
    expect(f).toBe(true);
  });

  test('Echo.Pi approximates Math.PI', async () => {
    const result = await pg.evaluate(() => (window as any).__lib.pi());
    expect(result).toBeCloseTo(Math.PI, 4);
  });

  test('Counter accumulates state across calls', async () => {
    const v1 = await pg.evaluate(() => (window as any).__lib.incrementCounter());
    const v2 = await pg.evaluate(() => (window as any).__lib.incrementCounter());
    expect(typeof v1).toBe('number');
    expect(v2).toBe(v1 + 1);
  });

  test('AsyncOps.DelayThenEcho round-trips a string', async () => {
    const result = await pg.evaluate(() =>
      (window as any).__lib.delayThenEcho('hello', 10)
    );
    expect(result).toBe('hello');
  });

  test('Throws.Boom propagates a .NET exception to JS', async () => {
    const caught = await pg.evaluate(async () => {
      try {
        (window as any).__lib.boom();
        return null;
      } catch (e: any) {
        return e?.message ?? String(e);
      }
    });
    expect(caught).toBeTruthy();
  });
});
