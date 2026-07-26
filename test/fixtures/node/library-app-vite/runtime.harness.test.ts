// The polyfill import MUST be first: ESM evaluates side-effect imports in order, and the
// .NET JS initializers touch `window` at import time. ./src/polyfill sets globalThis.window.
import './src/polyfill';
import { test, expect } from 'vitest';
import { dotnet } from '_framework/dotnet';
import { Echo, Counter, AsyncOps, Throws } from 'typeshim';

// Plain create() with NO .withResourceLoader(...) — the plugin's serve-node branch supplies
// file:// URLs. Proves the runtime boots in Vitest-node with no consumer shim.
test('boots .NET WASM runtime under Vitest node (dev server) and runs interop', async () => {
  const runtime = await dotnet.create();
  runtime.runMain();

  const echo = new Echo();
  expect(echo.Greet('world')).toBe('Hello, world');
  expect(echo.Add(2, 3)).toBe(5);
  expect(echo.BoolNot(true)).toBe(false);
  expect(echo.BoolNot(false)).toBe(true);
  expect(Math.abs(echo.Pi() - Math.PI)).toBeLessThan(1e-4);

  const counter = new Counter(10);
  counter.Increment();
  counter.Increment();
  expect(counter.Value).toBe(12);

  const asyncOps = new AsyncOps();
  expect(await asyncOps.DelayThenEcho('async-test', 10)).toBe('async-test');

  const thrower = new Throws();
  expect(() => thrower.Boom()).toThrow();
});
