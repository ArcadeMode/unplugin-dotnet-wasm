import { dotnet } from './_framework/dotnet';
import { TypeShimInitializer, Echo, Counter, AsyncOps, Throws } from './typeshim';

export interface DotnetLib {
  greet(name: string): string;
  add(a: number, b: number): number;
  boolNot(value: boolean): boolean;
  pi(): number;
  incrementCounter(): number;
  delayThenEcho(value: string, delayMs: number): Promise<string>;
  boom(): void;
}

// Export a function that initializes and returns lib
export async function initializeLib(): Promise<DotnetLib> {
  console.log('[Node] Initializing .NET WASM runtime...');
  
  const runtimeInfo = await dotnet.create();
  await TypeShimInitializer.initialize(runtimeInfo);
  runtimeInfo.runMain();

  const echo = new Echo();
  const counter = new Counter(10);
  const asyncOps = new AsyncOps();
  const thrower = new Throws();

  return {
    greet: (name: string) => echo.Greet(name),
    add: (a: number, b: number) => echo.Add(a, b),
    boolNot: (value: boolean) => echo.BoolNot(value),
    pi: () => echo.Pi(),
    incrementCounter: () => { counter.Increment(); return counter.Value; },
    delayThenEcho: (value: string, delayMs: number) => asyncOps.DelayThenEcho(value, delayMs),
    boom: () => thrower.Boom(),
  };
}
