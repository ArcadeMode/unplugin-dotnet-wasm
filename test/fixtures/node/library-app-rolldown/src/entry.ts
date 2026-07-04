import { dotnet } from './_framework/dotnet';
import { TypeShimInitializer, Echo, Counter, AsyncOps, Throws } from './typeshim';

async function runTests(): Promise<void> {
  console.log('[Node] Initializing .NET WASM runtime...');
  
  const runtimeInfo = await dotnet.create();
  await TypeShimInitializer.initialize(runtimeInfo);
  runtimeInfo.runMain();

  const echo = new Echo();
  const counter = new Counter(10);
  const asyncOps = new AsyncOps();
  const thrower = new Throws();

  try {
    // Test Echo (sync)
    const greet = echo.Greet('Node');
    console.log('[Echo.Greet] Result:', greet);
    if (!greet.includes('Node')) {
      throw new Error(`Echo.Greet('Node') returned unexpected value: ${greet}`);
    }

    const sum = echo.Add(2, 3);
    console.log('[Echo.Add] 2 + 3 =', sum);
    if (sum !== 5) {
      throw new Error(`Echo.Add(2, 3) returned ${sum}, expected 5`);
    }

    // Test Counter (mutable state)
    console.log('[Counter] Initial value:', counter.Value);
    if (counter.Value !== 10) {
      throw new Error(`Counter initialized with 10, got ${counter.Value}`);
    }
    
    counter.Increment();
    counter.Increment();
    console.log('[Counter] After 2 increments:', counter.Value);
    if (counter.Value !== 12) {
      throw new Error(`Counter.Value should be 12 after 2 increments, got ${counter.Value}`);
    }

    // Test AsyncOps
    const delayResult = await asyncOps.DelayThenEcho('async-test', 100);
    console.log('[AsyncOps.DelayThenEcho] Result:', delayResult);
    if (delayResult !== 'async-test') {
      throw new Error(`AsyncOps.DelayThenEcho returned unexpected value: ${delayResult}`);
    }

    // Test Throws — expect it to throw
    console.log('[Throws] Attempting to call Boom()...');
    try {
      thrower.Boom();
      throw new Error('Throws.Boom() should have thrown an exception');
    } catch (ex) {
      if ((ex as Error).message.includes('should have thrown')) {
        throw ex;
      }
      console.log('[Throws] Boom() threw as expected:', (ex as Error).message.substring(0, 50));
    }

    console.log('[SUCCESS] All tests passed in Node environment.');
    process.exitCode = 0;
  } catch (error) {
    console.error('[FAILURE]', error);
    process.exitCode = 1;
  }
}

runTests();
