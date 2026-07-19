/**
 * Ambient declaration for the Blazor WebAssembly boot module emitted by the
 * .NET SDK under `_framework/` when `WasmBundlerFriendlyBootConfig=true`.
 * `unplugin-dotnet-wasm` resolves this virtual specifier to the physical file.
 */
declare module '_framework/blazor.webassembly.js';

interface BlazorGlobal {
  start(options?: Record<string, unknown>): Promise<void>;
}

interface Window {
  Blazor: BlazorGlobal;
}
