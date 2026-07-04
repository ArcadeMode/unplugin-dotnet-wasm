# `dotnet.js` Bundler Output Spec — Cross-Target Asset Imports

## Goal
Emit bundler output whose static asset imports resolve correctly under **both** browser and Node runtimes without absolute paths baked in at build time and without any consumer-side shim.

## Input (from `dotnet publish` with `WasmBundlerFriendlyBootConfig=true`)

```js
import dotnet_native_wasm  from "./dotnet.native.<hash>.wasm";
import Library_wasm        from "./Library.<hash>.wasm";
import icudt_EFIGS_dat     from "./icudt_EFIGS.<hash>.dat";
// … one static import per asset
```

Each import identifier is expected to be a **URL string** consumed by the runtime's `loadResource` / `retrieve_asset_download` hook.

## Required Output Shape

Every asset import MUST be rewritten by the bundler to a proxy that exports a URL string resolved relative to the emitted chunk's own location:

```js
// Effective replacement for each asset import
const dotnet_native_wasm =
  new URL("./dotnet.native.<hash>.wasm", import.meta.url).href;
```

Equivalently, the plugin may emit a virtual proxy module and keep the `import` form:

```js
// virtual:asset-url:dotnet.native.<hash>.wasm
export default new URL("./dotnet.native.<hash>.wasm", import.meta.url).href;
```

### Rules

1. **Emit each referenced asset** into the output directory. The bundler may rehash and rename freely — the SDK's fingerprint is not required to survive — **as long as the asset imports in the emitted chunk are rewritten to reference the new filename**. Every rollup-family bundler does this automatically via `emitFile` + `ROLLUP_FILE_URL_*` placeholder rewriting.
2. **Value type MUST be `string`** (a resolved URL `.href`), never a `WebAssembly.Module`, `URL` instance, `ArrayBuffer`, or `Promise`.
3. **URL construction MUST use `import.meta.url`** as the base — this is the only form that resolves correctly against the deployed chunk location in both runtimes.
4. **Path MUST be relative** (`./…`) — no absolute `file://`, `/`, or origin-qualified URLs baked at build time.
5. **Preserve import identifier names** so downstream runtime code that references them by variable name still works. Ordering is not constrained; side-effect asset imports must not be tree-shaken (see Tree-shaking risk below).
6. **Emit as ES module** (`format: "esm"`). CJS/UMD would lose `import.meta.url`.
7. **Chunk placement is up to the bundler.** Splitting `dotnet.js` across multiple output chunks is fine as long as each URL string still resolves against the chunk that contains it — automatic when the bundler owns the rewrite (rollup-family), manual otherwise.
8. **No inlining** of `.wasm` / `.dat` payloads via `data:` URLs by default (breaks streaming compile and blows up bundle size); may be an opt-in mode.
9. **Do not transform** references to `dotnet.native.js` / `dotnet.runtime.js` as URL strings — those remain real ESM imports of JS chunks handled normally by the bundler.

## Resulting Runtime Behavior

| Runtime | `import.meta.url` example | Resolved asset URL | Loader path |
|---|---|---|---|
| Browser (served) | `https://app.example/assets/dotnet-<hash>.js` | `https://app.example/assets/Library.<hash>.wasm` | native `fetch` |
| Node (bundled ESM) | `file:///opt/app/dist/dotnet-<hash>.js` | `file:///opt/app/dist/Library.<hash>.wasm` | `fetch_like` branches on scheme → `fs.readFile` |

Both flow the URL string through the dotnet runtime's asset hook, matching the non-friendly code path.

## Runtime Compatibility Note

The URL string produced by `new URL("./asset", import.meta.url).href` resolves to a scheme the dotnet runtime's built-in `fetch_like` already handles (`http(s):` in browsers, `file:` in Node via `fs.promises.readFile`; see `_framework/dotnet.runtime.js`, `fetch_like` in the loader polyfills). No consumer-side shim is required.

## Bundler Compliance Snapshot

### Compliant — Node target supported

Produce the required shape natively. Node smoke fixtures land under M3.5b:

- **rollup** — baseline: `this.emitFile({ type: 'asset' })` + `import.meta.ROLLUP_FILE_URL_<refId>` is rewritten to `new URL('./<hashed>.wasm', import.meta.url).href` at chunk-emit time.
- **vite (build)** — rides the rollup path via `meta.framework === 'vite'`.
- **rolldown** — same placeholder scheme as rollup, verified in the M3.2 spike.
- **farm** — expected to comply through the same rollup-shaped `resolveId` + `emitFile` path, but the exact emitted shape needs a Stage-0 read of the built chunk before being locked in as compliant.

### Non-compliant — Node target deferred

Browser output is unaffected — these entries only apply when the consumer targets Node.

#### esbuild / bun

**Issue.** The default `file` loader emits a bare, `publicPath`-adjusted string, not a `new URL(..., import.meta.url).href` wrap. In Node this forces a consumer-side `withResourceLoader((_, __, defaultUri) => new URL(defaultUri, import.meta.url).href)` shim — violates the "no consumer shim" goal.

**Mitigation plan.**
1. Replace the `file` loader for `BINARY_EXTENSIONS` with a virtual-proxy approach inside `plugin.esbuild.setup` / `plugin.bun.setup`:
   - `onResolve` for known asset paths → return `{ path: originalAbs, namespace: 'dotnet-asset' }`.
   - `onLoad` on that namespace → read bytes, compute a short content hash, plan emission at `assets/${basename}-${hash}${ext}`, return `{ contents: \`export default new URL(${JSON.stringify('./' + emitPath)}, import.meta.url).href;\`, loader: 'js' }`.
   - `onEnd` → write planned assets to `initialOptions.outdir`, deduped by absolute source path.
2. Drop the current `loader['.wasm'|'.dat'|'.pdb'] = 'file'` injection.
3. Guard: if `initialOptions.format !== 'esm'`, warn (or throw when `platform === 'node'`) — `import.meta.url` is CJS-invalid.
4. Add Node fixtures once green.

#### webpack / rspack / rsbuild

**Issue.** `asset/resource` bakes a build-time string prefixed with `output.publicPath`, not a `new URL(..., import.meta.url)` wrap. The `import.meta.url`-based shape only appears when `output.module: true` + `experiments.outputModule: true` + `output.publicPath: 'auto'`, and even then it produces a `URL` **instance** (violates Rule 2's string requirement).

**Mitigation plan.**
1. When targeting Node (detectable via `target: 'node'` / equivalent) and the user hasn't opted out, push `output.module = true`, `experiments.outputModule = true`, `output.publicPath = 'auto'` from the framework hook.
2. Reconcile the `URL`-vs-`.href` gap by one of:
   - Wrap the generated asset-module runtime shim to append `.href` (via a `NormalModuleReplacementPlugin`-style intercept), or
   - Relax Rule 2 to accept `URL | string` if the .NET loader is happy with a `URL` (needs verification against `fetch_like`).
3. Keep the M3.4 scoped-rule posture: rsbuild's default `.wasm → webassembly/async` rule stays intact for user files.
4. Add Node fixtures per family (webpack, rspack; rsbuild if the mitigation carries).

### Tree-shaking risk (cross-cutting)

Asset imports in `dotnet.js` are side-effect registrations. If any bundler prunes an unused named import from the emitted chunk, an asset is silently lost. Audit per bundler when a Node fixture lands; if observed, mark the generated proxy or importing module as side-effectful (per-bundler mechanism).

## Non-Goals / Out of Scope

- Rewriting the `dotnet.runtime.js` / `dotnet.native.js` chunks (they contain no asset imports).
- Handling `WasmBundlerFriendlyBootConfig=false` output (already works via bare-string resource map).
- Emitting absolute deployment URLs (breaks portability).
- Chunk-splitting guardrails — splitting is transparent as long as bundler-driven reference rewriting is intact.
- Filename preservation — the SDK's original hashed names are expendable; bundler rehashing is expected.
