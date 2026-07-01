# M3.1 spike — cross-bundler binary asset emission

Throwaway repro that proves approach **A** (bundler-conditional `load`, from `execution-plan.md` M3.1) produces a working `.wasm` asset URL through both Rollup and webpack from the **same plugin source**.

## What the plugin does

1. `resolveId('virtual:test.wasm')` → returns an absolute path to a real `.wasm` file on disk (borrowed from `test/fixtures/Library/bin/Debug/net10.0/wwwroot/_framework/Library.wasm`, an actual `WebAssembly.Module`).
2. `load(id)` branches on `meta.framework`:
   - `rollup` / `vite` → `this.emitFile({ type: 'asset' })` + `export default import.meta.ROLLUP_FILE_URL_<refId>` (current plugin behaviour).
   - `webpack` → returns `null`. The `webpack(compiler)` hook injects a `{ test: /\.wasm$/, type: 'asset/resource' }` module rule so webpack's native asset pipeline emits the file with a content hash.

## Run

```powershell
pnpm install          # installs rollup + webpack + unplugin
node run.mjs          # builds both and prints the emitted wasm reference from each bundle
```

Success criterion (M3.1 "Done when"): each build produces a `dist-*/main.js` that references a content-hashed `.wasm` file whose bytes match the source.
