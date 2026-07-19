// The .NET SDK (10.0.x) emits `blazor.webassembly.js` without exports
import '_framework/blazor.webassembly.js';
const Blazor = window.Blazor; // import sets `window.Blazor`

// Starting blazor upgrades every registered custom element (<blazor-counter>, <blazor-date-time-now>)
let blazorStart: Promise<void> | null = null;
async function start(): Promise<void> {
  if (blazorStart) return blazorStart;
  blazorStart = Blazor.start();
  await blazorStart;
}

start();
