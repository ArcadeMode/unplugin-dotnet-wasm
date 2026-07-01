import wasmUrl from 'dotnet-asset-test';

// Rollup emits ESM by default; webpack emits CJS by default. Log via a global
// so `run.mjs` can grep for the URL/module id in both bundles.
globalThis.__spikeWasmUrl = wasmUrl;
