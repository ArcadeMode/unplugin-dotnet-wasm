import wasmUrl from 'dotnet-asset-test';
import { f } from '../other.wasm';

globalThis.__spikeWasmUrl = wasmUrl;
globalThis.__userWasmFn = f;
