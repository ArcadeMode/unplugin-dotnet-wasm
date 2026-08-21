// The .NET SDK (10.0.x) emits `blazor.webassembly.js` without exports
import '_framework/blazor.webassembly.js';

let blazorStart: Promise<void> | null = null;

export function startBlazor(): Promise<void> {
  if (!blazorStart) {
    blazorStart = window.Blazor.start();
  }
  return blazorStart;
}
