import { test, expect } from 'vitest';
import { dotnet } from '_framework/dotnet';
import { Counter } from 'typeshim';

/**
 * Boots .NET WASM under Vitest-node (Vite SSR / serve pipeline) and asserts
 * interop. Increment step is 3 when unaltered, 5 when LibraryAltered=true —
 * the outer e2e suite asserts the INCREMENT:* lines on stdout.
 */
test('boots .NET WASM under Vitest node (dev server) and runs interop', async () => {
  const runtime = await dotnet.create();
  runtime.runMain();

  const tsState = (globalThis as any)[Symbol.for('@typeshim')];
  expect(typeof tsState).toBe('object');
  expect(tsState).not.toBeNull();
  console.log('NUGET_STATICWEBASSET:ok');

  const counter = new Counter(0);
  counter.Increment();
  console.log(`INCREMENT:${counter.Value}`);
  counter.Increment();
  console.log(`INCREMENT:${counter.Value}`);
});
