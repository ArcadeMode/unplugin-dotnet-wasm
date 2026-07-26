import { dotnet } from '_framework/dotnet';
import { Echo, Counter, AsyncOps, Throws } from 'typeshim';

async function initializeWasmRuntime(): Promise<void> {
  const runtimeInfo = await dotnet.create();
  runtimeInfo.runMain();
  const echo = new Echo();
  const counter = new Counter(10);
  const asyncOps = new AsyncOps();
  const thrower = new Throws();

  (window as any).__lib = {
    greet: (name: string) => echo.Greet(name),
    add: (a: number, b: number) => echo.Add(a, b),
    boolNot: (value: boolean) => echo.BoolNot(value),
    pi: () => echo.Pi(),
    incrementCounter: () => {
      counter.Increment();
      return counter.Value;
    },
    delayThenEcho: (value: string, delayMs: number) => asyncOps.DelayThenEcho(value, delayMs),
    boom: () => thrower.Boom(),
  };
  const ts_state = (globalThis as any)[Symbol.for('@typeshim')];
  (globalThis as any).__contentAssetOk = typeof ts_state === 'object' && ts_state !== null;
  (globalThis as any).__libReady = true;

  console.log('WASM runtime initialized successfully.');
}

initializeWasmRuntime();
