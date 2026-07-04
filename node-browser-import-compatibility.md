# `dotnet.js` Bundler Output Spec — Cross-Target Asset Imports

## Goal
Emit a single `dotnet.js` chunk whose static asset imports resolve correctly under **both** browser and Node runtimes without absolute paths baked in at build time.

## Input (from `dotnet publish` with `WasmBundlerFriendlyBootConfig=true`)

```js
import dotnet_native_wasm  from "./dotnet.native.<hash>.wasm";
import Library_wasm        from "./Library.<hash>.wasm";
import icudt_EFIGS_dat     from "./icudt_EFIGS.<hash>.dat";
// … one static import per asset
```

Each import identifier is expected to be a **URL string** consumed by the runtime's `loadResource` / `retrieve_asset_download` hook.

## Required Output Shape

Every asset import MUST be rewritten by the bundler plugin to a proxy module that exports a URL string resolved relative to the emitted chunk's own location:

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

1. **Emit each referenced asset** into the output directory with a stable, hashed filename (preserve the fingerprint the SDK already assigned; do not rehash).
2. **Value type MUST be `string`** (a resolved URL `.href`), never a `WebAssembly.Module`, `URL` instance, `ArrayBuffer`, or `Promise`.
3. **URL construction MUST use `import.meta.url`** as the base — this is the only form that resolves correctly against the deployed chunk location in both runtimes.
4. **Path MUST be relative** (`./…`) — no absolute `file://`, `/`, or origin-qualified URLs at build time.
5. **Preserve import order and identifier names** so downstream runtime code that references them by variable name still works.
6. **Emit as ES module** (`format: "esm"`). CJS/UMD would lose `import.meta.url`.
7. **Chunk placement**: assets and `dotnet.js` MUST be emitted such that the relative path is valid — either same directory, or a fixed sub-path (e.g. `./assets/`) that the plugin uses consistently for the URL string and the physical emission.
8. **No inlining** of `.wasm` / `.dat` payloads via `data:` URLs by default (breaks streaming compile and blows up bundle size); may be an opt-in mode.
9. **Do not transform** references to `dotnet.native.js` / `dotnet.runtime.js` as URL strings — those remain real ESM imports of JS chunks handled normally by the bundler.

## Resulting Runtime Behavior

| Runtime | `import.meta.url` example | Resolved asset URL | Loader path |
|---|---|---|---|
| Browser (served) | `https://app.example/assets/dotnet-<hash>.js` | `https://app.example/assets/Library.<hash>.wasm` | native `fetch` |
| Node (bundled ESM) | `file:///opt/app/dist/dotnet-<hash>.js` | `file:///opt/app/dist/Library.<hash>.wasm` | `fetch_like` branches on scheme → `fs.readFile` |

Both flow the URL string through the dotnet runtime's asset hook, matching the non-friendly code path.

## Runtime Compatibility Note

The URL string produced by `new URL("./asset", import.meta.url).href` will resolve to a scheme that the dotnet runtime's built-in `fetch_like` already handles (`http(s):` in browsers, `file:` in Node). No consumer-side shim work is required.

## Non-Goals / Out of Scope

- Rewriting the `dotnet.runtime.js` / `dotnet.native.js` chunks (they contain no asset imports).
- Handling `WasmBundlerFriendlyBootConfig=false` output (already works via bare-string resource map).
- Emitting absolute deployment URLs (breaks portability).
