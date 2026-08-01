import { dotnet } from '_framework/dotnet';
import { Counter } from 'typeshim';

/**
 * The normal build increments by 3, the 'altered' build increments by 5 (to assert updated build works).
 *
 * In browser render a `<div id="wasm-initialized-marker" data-ts="...">` element to
 * enable tests to detect load and reloads.
 */
async function main(): Promise<void> {
  const runtimeInfo = await dotnet.create();
  runtimeInfo.runMain();

  const counter = new Counter(0);
  counter.Increment();
  console.log(`INCREMENT:${counter.Value}`);
  counter.Increment();
  console.log(`INCREMENT:${counter.Value}`);

  if (typeof document !== 'undefined') {
    const marker = document.createElement('div');
    marker.id = 'wasm-initialized-marker';
    marker.dataset.ts = String(Date.now());
    document.body.appendChild(marker);
  }
}

main();
