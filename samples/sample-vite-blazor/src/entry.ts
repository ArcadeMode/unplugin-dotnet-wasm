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

// Once Blazor has upgraded the custom elements, drive their parameters from code
// (JS properties) and observe the counter's callback (a DOM CustomEvent).
function wireComponents(): void {
  const counter = document.querySelector<HTMLElement & { initial: number }>('blazor-counter');
  if (counter) {
    counter.initial = 42; // set the default count from code
    counter.addEventListener('countchanged', (event) => {
      console.log('[blazor-counter] count changed ->', (event as CustomEvent<number>).detail);
    });
  }

  const dateTime = document.querySelector<HTMLElement & { initial: string }>('blazor-date-time-now');
  if (dateTime) {
    dateTime.initial = new Date().toISOString(); // set the initial datetime from code
  }
}

start().then(wireComponents);

