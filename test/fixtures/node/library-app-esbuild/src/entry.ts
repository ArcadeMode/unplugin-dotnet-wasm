import { dotnet } from '_framework/dotnet';
import { TypeShimInitializer, Echo, Counter, AsyncOps, Throws } from 'typeshim';

async function runTests(): Promise<void> {
  console.log('[Node] Initializing .NET WASM runtime...');
  
  const runtimeInfo = await dotnet
    .withResourceLoader((type: string, name: string, defaultUri: string) => new URL(defaultUri, import.meta.url).href)
    .create();
  await TypeShimInitializer.initialize(runtimeInfo);
  runtimeInfo.runMain();

  const echo = new Echo();
  const counter = new Counter(10);
  const asyncOps = new AsyncOps();
  const thrower = new Throws();

  try {
    // Test Echo.Greet (sync)
    console.log('[Echo.Greet] Testing...');
    const greet = echo.Greet('world');
    if (greet !== 'Hello, world') {
      throw new Error(`Echo.Greet('world') returned '${greet}', expected 'Hello, world'`);
    }
    console.log('[Echo.Greet] ✓ Passed');

    // Test Echo.Add
    console.log('[Echo.Add] Testing...');
    const sum = echo.Add(2, 3);
    if (sum !== 5) {
      throw new Error(`Echo.Add(2, 3) returned ${sum}, expected 5`);
    }
    console.log('[Echo.Add] ✓ Passed');

    // Test Echo.BoolNot
    console.log('[Echo.BoolNot] Testing...');
    const notTrue = echo.BoolNot(true);
    const notFalse = echo.BoolNot(false);
    if (notTrue !== false || notFalse !== true) {
      throw new Error(`Echo.BoolNot returned unexpected values: true→${notTrue}, false→${notFalse}`);
    }
    console.log('[Echo.BoolNot] ✓ Passed');

    // Test Echo.Pi
    console.log('[Echo.Pi] Testing...');
    const pi = echo.Pi();
    if (Math.abs(pi - Math.PI) > 1e-4) {
      throw new Error(`Echo.Pi() returned ${pi}, expected ~${Math.PI}`);
    }
    console.log('[Echo.Pi] ✓ Passed');

    // Test Counter (mutable state)
    console.log('[Counter] Testing...');
    if (counter.Value !== 10) {
      throw new Error(`Counter initialized with 10, got ${counter.Value}`);
    }
    counter.Increment();
    counter.Increment();
    if (counter.Value !== 12) {
      throw new Error(`Counter.Value should be 12 after 2 increments, got ${counter.Value}`);
    }
    console.log('[Counter] ✓ Passed');

    // Test AsyncOps.DelayThenEcho
    console.log('[AsyncOps.DelayThenEcho] Testing...');
    const delayResult = await asyncOps.DelayThenEcho('async-test', 10);
    if (delayResult !== 'async-test') {
      throw new Error(`AsyncOps.DelayThenEcho returned '${delayResult}', expected 'async-test'`);
    }
    console.log('[AsyncOps.DelayThenEcho] ✓ Passed');

    // Test Throws.Boom (expects throw)
    console.log('[Throws.Boom] Testing...');
    try {
      thrower.Boom();
      throw new Error('Throws.Boom() should have thrown an exception');
    } catch (ex) {
      if ((ex as Error).message.includes('should have thrown')) {
        throw ex;
      }
      console.log('[Throws.Boom] ✓ Passed (threw as expected)');
    }

    console.log('[SUCCESS] All tests passed in Node environment.');
    process.exitCode = 0;
  } catch (error) {
    console.error('[FAILURE]', error);
    process.exitCode = 1;
  }
}

runTests();
