// Loaded via Vite dev server ssrLoadModule. Polyfill import must be first (see fixture entry).
import './src/polyfill';
import { dotnet } from '_framework/dotnet';
import { TypeShimInitializer, Echo, Counter } from 'typeshim';

export async function run(): Promise<string> {
  const runtime = await dotnet.create(); // no withResourceLoader — plugin supplies file:// URLs
  await TypeShimInitializer.initialize(runtime);

  const echo = new Echo();
  if (echo.Greet('world') !== 'Hello, world') return 'FAIL: Echo.Greet';
  if (echo.Add(2, 3) !== 5) return 'FAIL: Echo.Add';

  const counter = new Counter(10);
  counter.Increment();
  if (counter.Value !== 11) return 'FAIL: Counter';

  return 'SUCCESS';
}
