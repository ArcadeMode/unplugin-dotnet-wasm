import { dotnet } from './_framework/dotnet';
import { TypeShimInitializer, Counter } from './typeshim';

async function boot(): Promise<void> {
  const runtime = await dotnet.create();
  await TypeShimInitializer.initialize(runtime);
  runtime.runMain();

  const counter = new Counter(0);
  const btn = document.getElementById('inc')!;
  const display = document.getElementById('count')!;

  btn.addEventListener('click', () => {
    counter.Increment();
    display.textContent = String(counter.Value);
  });
}

boot();