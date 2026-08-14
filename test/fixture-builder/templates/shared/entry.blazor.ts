// The .NET SDK emits `blazor.webassembly.js` without exports; the import sets `window.Blazor`.
import '_framework/blazor.webassembly.js';

interface BlazorGlobal {
  start(options?: Record<string, unknown>): Promise<void>;
}

declare global {
  interface Window {
    Blazor: BlazorGlobal;
  }
}

async function main(): Promise<void> {
  if (!document.getElementById('app')) {
    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
  }
  await window.Blazor.start();
}

main();
