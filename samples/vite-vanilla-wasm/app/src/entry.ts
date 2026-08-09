import { dotnet } from '_framework/dotnet';
import { Counter } from 'typeshim';

async function boot(): Promise<void> {
  const runtime = await dotnet.create();
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
