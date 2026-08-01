import { test, expect } from 'vitest';
import { dotnet } from '_framework/dotnet';
import { Counter } from 'typeshim';

/**
 * Boots .NET WASM under Vitest-node (Vite SSR / serve pipeline) and asserts
 * baseline interop. Increment step is 3 when the library is unaltered.
 */
test('boots .NET WASM under Vitest node (dev server) and runs interop', async () => {
  const runtime = await dotnet.create();
  runtime.runMain();

  const counter = new Counter(0);
  counter.Increment();
  expect(counter.Value).toBe(3);
  console.log('INCREMENT:3');
  counter.Increment();
  expect(counter.Value).toBe(6);
  console.log('INCREMENT:6');
});
