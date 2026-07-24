// The polyfill import MUST be first: ESM evaluates side-effect imports in order, and the
// .NET JS initializers touch `window` at import time. ./src/polyfill sets globalThis.window.
import './src/polyfill';
import { test, expect } from 'vitest';
import { dotnet } from '_framework/dotnet';
import { TypeShimInitializer, Echo, Counter } from 'typeshim';

// Plain create() with NO .withResourceLoader(...) — the point of the harness is to prove the
// runtime boots in Vitest-node without a consumer shim once the plugin's serve-node branch lands.
test('boots .NET WASM runtime under Vitest node (dev server)', async () => {
  const runtime = await dotnet.create();
  await TypeShimInitializer.initialize(runtime);
  runtime.runMain();

  const echo = new Echo();
  expect(echo.Greet('world')).toBe('Hello, world');
  expect(echo.Add(2, 3)).toBe(5);

  const counter = new Counter(10);
  counter.Increment();
  expect(counter.Value).toBe(11);
});
