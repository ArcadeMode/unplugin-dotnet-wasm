# Execution Plan: `unplugin-dotnet-wasm`

Companion to `plan.md`. Milestone build order. **M1 + M2 + M3 shipped; the sections below are historical — key decisions and outcomes only.**

## Anchor fixture (M1–M3)

`test/fixtures/Library/` — `Microsoft.NET.Sdk.WebAssembly` net10.0 project with:

- `WasmBundlerFriendlyBootConfig=true` → native `import dotnet_native_wasm from "./dotnet.native.wasm"` pattern.
- `WasmFingerprintAssets` toggled per test run by build scripts (`build:library:fingerprint` / `:nofingerprint`); the csproj stays neutral.
- Multiple content roots (`Library/wwwroot/` source + `bin/…/wwwroot/` build output + `obj/…/TypeShim/staticwebassets/wwwroot/` for `typeshim.ts`) with glob fall-through on the source root. Cross-root resolution is a day-one requirement.
- Minimal `[TSExport]` surface for tests: `Echo` (sync), `Counter` (ctor + mutable state), `AsyncOps` (Task marshalling), `Throws` (exception marshalling).

---

## M1 — Vite + scattered build output (shipped)

**Outcome:** the plugin resolves and bundles a `dotnet build` output through Vite; consumer imports use canonical names (`_framework/dotnet`, `_framework/Library.wasm`) even under `WasmFingerprintAssets=true`. Playwright E2E proves `[TSExport]` calls round-trip in a real browser.

### Key decisions

- **Repo scaffolding.** pnpm monorepo, TypeScript strict/ESM/Node 20, `tsup` for the package build, Vitest as the runner, ESLint + Prettier. Workspaces: `packages/unplugin-dotnet-wasm`, `packages/samples/*`, `test/fixtures/*`, `test/integration`.
- **Runtime-manifest parser** (`src/core/manifest-runtime.ts`). Zod schema over the full `ContentRoots / Root(Node) / Asset / Patterns` shape; `parseRuntimeManifest(raw): RuntimeManifest` with JSON-path-friendly errors. No `any`.
- **Discovery** (`src/core/discover.ts`). `discoverManifests({ projectRoot, configuration='Debug', targetFramework?, dotnetOutputDir? })` returning `{ runtimeManifestPath, endpointsManifestPath }`. `dotnetOutputDir` is a discriminated-union alternative to `projectRoot`+axes; unset axes are inferred by unique-directory globs and hard-fail with the candidate list on ambiguity. Runtime path may be `null` (publish output has none).
- **VFS** (`src/core/vfs.ts`). Map-based lookup, POSIX-normalised, case-insensitive keys, case-preserving physical paths. Contains only what the manifest declares; a `resolve()` miss signals "delegate to host resolver". Pattern fall-through does **exactly one `statSync`** per candidate — the plugin never enumerates directories. `.ts` shadows `.d.ts` warnings routed through the injected `Logger`. Two entry points: `resolve(virtualPath)` (with ext/index probing) and `resolveFile(assetFile)` (cross-root FS probe, no probing).
- **Shared infra** (`src/core/logger.ts`, `src/core/extension-probes.ts`). `Logger` interface + `createConsoleLogger(level)` + `NULL_LOGGER`. No `console.*` outside `logger.ts`. Extension probe order shared by the resolver and VFS.
- **Unplugin shell** (`src/unplugin/index.ts`). `enforce: 'pre'`. `resolveId` treats `source` as an importer-blind virtual path (strip leading `./`, POSIX-normalise, ignore importer entirely). `load` handles binary extensions (`.wasm`, `.dat`, `.pdb`) via Rollup's `this.emitFile({ type: 'asset' })` + `import.meta.ROLLUP_FILE_URL_<refId>`; text files fall through to Vite's transformers.
- **Fingerprint-aware resolution.** The endpoints manifest is parsed (`src/core/manifest-endpoints.ts`) and reduced to `EndpointLookup: ReadonlyMap<route, { assetFile, fingerprint?, label? }>` (`src/core/endpoint-lookup.ts`), keyed by POSIX route with compressed-selector rows filtered out (compression covered in a later milestone). The resolver applies the endpoint alias **both** on the exact normalised specifier **and** during the bare-specifier extension-probe loop — so `_framework/Library.wasm` (extension-qualified) and `_framework/dotnet` (bare) both resolve to their fingerprinted physical files. `AssetResolver` (`src/core/asset-resolver.ts`) owns the algorithm.
- **Test orchestration.** Root scripts `build:library:fingerprint` / `:nofingerprint` set `-p:WasmFingerprintAssets=true|false`; the csproj stays neutral. `test:fingerprint-enabled` / `:disabled` chain plugin build → dotnet build → fixture build → unit → integration → E2E. The full `test` script runs both fingerprint states plus a `none` (no-build) negative shape.
- **Playwright E2E** (`test/integration/tests/runtime.spec.ts`). Drives `vite build` + `sirv` on `dist/`, waits for `window.__libReady`, asserts each `[TSExport]` call round-trips. Vite dev is intentionally out of scope; the plugin is build-only through M3. Justification: Rollup's `ROLLUP_FILE_URL_*` placeholder doesn't exist in Vite's dev pipeline, so vitest-browser mode / `vite dev` would receive the literal placeholder and fail.

### Rejected in M1

- **SRI emission** — the .NET loader hashes `.wasm`/`.dll`/`.dat` internally; browser SRI only covers `<script>` tags. Marginal value in supporting it
- **Configurable `resolveExtensions`** — can't be inherited from Rollup, speculative.

---

## M2 — Consolidated `dotnet publish` output (shipped)

**Outcome:** the same consumer works against `dotnet publish` output by passing `dotnetOutputDir`. VFS construction branches on the presence of `{Project}.staticwebassets.runtime.json` — no `mode` option, no `publishDir` option. Dev/prod wiring is a Vite-mode conditional on the caller side (e.g. `defineConfig(({ mode }) => …)`), not a plugin option.

### Key decisions

- **Publish fixture on-demand.** `build:library:fingerprint` / `:nofingerprint` chain a `dotnet publish -c Release`; `bin/Release/net10.0/publish/` is gitignored and regenerated per test run.
- **Endpoints-seeded VFS.** When `runtimeManifestPath` is `null`, `buildEmptyVfs(endpointsManifestPath, { logger })` (`src/core/vfs.ts`) derives a single content root from the endpoints manifest location (using `wwwroot/` subdir when present) and registers a `**` catch-all pattern. Callers see the same `VirtualFileSystem` interface; the resolver is unchanged.
- **Publish E2E** (`test/integration/tests/publish.test.ts`) covers `fingerprint`, `nofingerprint`, and `none` (negative-path: publish dir cleaned → discovery must fail with a message, not a stack).
- **Public API.** [`packages/unplugin-dotnet-wasm/README.md`](packages/unplugin-dotnet-wasm/README.md) documents both wiring recipes and the `defineConfig(({ mode }) => …)` dev/prod switch. Sample consumer lives at `packages/samples/{SampleLibrary,sample-vite}`.

### Still out of scope after M2

Vite dev server, HMR, IDE-parity emission, preload `<link>` tags, other bundlers (webpack/rollup/esbuild adapters exist as re-exports but are untested — see M3).

---

## ⏸ Checkpoint — decide before M3

After M2 we have a usable production-only plugin for Vite (build-time only, scattered + consolidated layouts, fingerprint-aware, README + sample, ready to cut `0.1.0-rc`). Before we keep going, we pick from the open backlog. Possible next bites, **roughly in order of likely value**:

- **M3 — All build-time bundlers**: broaden from Vite/Rollup to every unplugin-supported build-time bundler (webpack, rspack, rsbuild, esbuild, rolldown, farm, bun; vite build rides on rollup). Requires per-bundler asset-emission strategies and a `BUNDLER` axis on the test matrix. Also gates on an unplugin 2 → 3 upgrade (Bun landed in v3.0.0, dedicated rsbuild adapter in v3.3.0). Hybrid execution: spike all bundlers first (parallel, throwaway), split the plugin once, then batch fixtures + matrix. **Decided — full plan in the M3 section below.**
- **M4 — Dev server (Vite first)**: `configureServer` middleware that streams VFS files with the right `Content-Type` (`application/wasm` etc.), applies `ResponseHeaders` from endpoints.json verbatim (with stale-`Content-Length` recomputation), and handles fingerprinted route aliases.
- **M5 — Change detection / watch**: `addWatchFile` for every VFS asset, debounced manifest re-read on change, dev HMR invalidation when `dotnet build` rewrites the bin output.
- **M6 — IDE-parity emission**: the quiet `node_modules/.dotnet-vfs/` cache with `tsconfig.json` + `dotnet-vfs.d.ts`; layout-flip cleanup; one-shot info-level `extends` hint.
- **M7 — Preload `<link>` injection**: emit preload tags from `EndpointProperties.Preload*` for the `webassembly` group, ordered by `PreloadOrder`, via `transformIndexHtml`. Endpoint lookup already carries everything needed.
- **M8 — IDE-parity language-service test**: automated TS server probe to prove cross-root Go-to-Definition (companion to M6).

Each of these is its own milestone-sized chunk. **Plan out M3/M4/M5 (or whichever combination we want) at that checkpoint** — we'll know more once M1 and M2 are real code in someone's hands.

---

## M3 — All build-time bundlers (shipped)

**Outcome:** the same plugin source now targets every unplugin-supported build-time bundler. **Browser: all 9** (`vite`, `rollup`, `rolldown`, `webpack`, `rspack`, `rsbuild`, `esbuild`, `farm`, `bun`) — each has a fixture, byte-identical `.wasm` emission, and passing Playwright interop for all four `[TSExport]` classes. **Node: 4** (`vite`, `rollup`, `rolldown`, `farm`) with `runtime-node.e2e.test.ts` interop; `esbuild`/`bun`/`webpack`/`rspack`/`rsbuild` on node are scaffolded but deferred — reasons and mitigation plans live in [`node-browser-import-compatibility.md`](node-browser-import-compatibility.md). Fingerprint + no-fingerprint shapes green on every shipped cell.

### Key decisions

- **Design shape: bundler-conditional plugin (Approach A).** One `meta.framework` dispatch in `src/unplugin/index.ts` re-exporting per-family modules; core VFS/manifest layer stays bundler-agnostic. Verified by grep against `vite|rollup|webpack|rspack|rsbuild|esbuild|rolldown|farm|bun|ROLLUP_` in `core/`.
- **Bundler families:**
  - **Rollup-family** (`rollup`, `vite`, `rolldown`): existing `load` + `this.emitFile({ type: 'asset' })` + `import.meta.ROLLUP_FILE_URL_<refId>`. Vite build rides the rollup path with zero vite-specific code.
  - **Webpack-family** (`webpack`, `rspack`): omit `load` entirely (unplugin's webpack load-loader is not `raw: true` → returning `null` still round-trips bytes through UTF-8 and corrupts binaries). Inject an `asset/resource` `module.rules` entry from the `webpack(compiler)` / `rspack(compiler)` hook, **scoped by absolute `include` paths** sourced from `AssetResolver` — never a naked `/\.wasm$/` (would steal user assets).
  - **rsbuild:** same scoped asset-module rule but **`unshift`**'d into `config.module.rules` from `rsbuild.setup(api).modifyRspackConfig`. rsbuild's built-in `.wasm → webassembly/async` rule runs ahead of appended user rules, so ours must come first for our files. `experiments.asyncWebAssembly` / `syncWebAssembly` stay at defaults — scoped `include` wins per-file without touching them, and disabling would break downstream `import { foo } from './their.wasm'`.
  - **esbuild-family** (`esbuild`, `bun`): **drop `resolveId`** on this branch — unplugin's resolveId return lands in a plugin-scoped namespace that defeats the bundler's native `.wasm → file` loader. Register `build.onResolve` directly inside `plugin.esbuild.setup(build)` / `plugin.bun.setup(build)` so the file stays in the default namespace. Note: `plugin.esbuild` / `plugin.bun` in unplugin 3.x are `{ setup, config, onResolveFilter, onLoadFilter, loader }` objects, not bare functions.
  - **Farm:** rollup-shaped `resolveId` + Farm-config opt-in `compilation.assets.include: ['wasm']` (documented as a consumer-side config change since it's not a plugin hook).
- **Extension coverage.** `.wasm`, `.dat`, `.pdb` via the existing `BINARY_EXTENSIONS` set — same rule shape for all three, no per-extension branching. `.js` loader files (`dotnet.js`, `dotnet.native.js`, `dotnet.runtime.js`) get no special handling; `resolveId` returns the physical path and the bundler's normal JS pipeline processes them.
- **No name preservation, no manifest rewriting.** `WasmBundlerFriendlyBootConfig=true` emits `dotnet.js` with real `import "./<asset>"` per asset, so bundler reference-rewriting carries the runtime lookup end-to-end. Bundlers are free to rehash / relocate.
- **unplugin 2.3.11 → 3.3.0.** Required for `bun` (v3.0.0) and the dedicated `rsbuild` adapter (v3.3.0). ESM-only + Node 20+ already matched us. `acorn` removal was a no-op — we don't call `this.parse()`.
- **Node subset via URL-shape audit.** [`node-browser-import-compatibility.md`](node-browser-import-compatibility.md) documents the required output shape (`new URL('./asset', import.meta.url).href` → resolved string). Rollup-family + farm produce it natively; esbuild/bun emit bare strings, webpack/rspack/rsbuild produce `URL` instances only under `output.module: true` — mitigations for both families are captured there for a future milestone.
- **Test matrix (M3.6+M3.7).** Flag-driven [`test/integration/run-test-matrix.mjs`](test/integration/run-test-matrix.mjs) with `--fingerprint=<true|false|none>` (required) + optional `--bundler` / `--platform` / `--integration` / `--e2e`. Sets `BUNDLER` / `PLATFORM` / `DOTNET_FIXTURE_SHAPE` per cell. [`test/integration/test-matrix.ts`](test/integration/test-matrix.ts) exposes `describeWhen({ shapes, bundlers })` and `getFixtureDir(platform, bundler)`; per-bundler `IsolatedBundlerBuild` implementations under [`test/integration/bundlers/`](test/integration/bundlers/). `BUNDLERS_SUPPORT` in the runner gates cells per platform — unsupported combos skip with a warning rather than fail. **Rejected:** per-bundler `build:fixture:*` / `test:integration:*` / `test:e2e:*` script aliases — the flag-driven runner covers them with a single command line.
- **Root chains (`scripts/run-tests.mjs`).** `test:fingerprint-enabled`, `test:fingerprint-disabled`, `test:no-build`; `pnpm test` runs all three. Each chain does clean → plugin build → library build → `build:fixtures` → unit → matrix integration → matrix e2e. `build:fixtures` uses a single glob-filter script (`pnpm --filter "@dotnet-wasm-bundler/library-app-*-<bundler>-fixture" build`). Matrix runner does **not** rebuild fixtures — iteration is `cd test/fixtures/<platform>/library-app-<bundler>; npm run build`.
- **E2E dispatch.** [`test/integration/run-e2e.mjs`](test/integration/run-e2e.mjs) branches on `PLATFORM`: node → `vitest run --config vitest.e2e.config.ts` (runs `*.e2e.test.ts`); browser → `playwright test` (runs `runtime.spec.ts`). Integration vitest config excludes `*.e2e.test.ts` to avoid double-running. Playwright config reads `BUNDLER` + `DOTNET_FIXTURE_SHAPE`, points `webServer` at the matching fixture `dist/`, writes per-cell JSON reports.
- **Interop specs stay bundler-blind.** One `runtime.spec.ts` covers every browser bundler; one `runtime-node.e2e.test.ts` covers every node bundler.
- **Fixture regex widened** to `/^Library([.-][^/]+)?\.wasm$/` to accept both `.` and `-` hash separators across bundler defaults.

### Non-obvious findings recorded during spike (M3.2)

- **webpack load-loader is not `raw: true`** in unplugin 3.3.0 either — the "omit `load` on webpack" workaround stays.
- **esbuild's `plugin.esbuild` return shape changed** in unplugin 3.x from `(build) => void` to `{ setup, config, onResolveFilter, onLoadFilter, loader }`.
- **rsbuild default `experiments.asyncWebAssembly`** interferes with naked `.wasm` rules; scoped `include` + `unshift` was the fix. Verified non-interference in-spike via a mixed scenario importing both our virtual specifier and a user-owned `other.wasm` with named exports.
- **Farm requires `compilation.assets.include: ['wasm']`** in the consumer config — not something the plugin can inject.

### Rejected in M3

- Per-bundler `assetNames` / `output.assetFileNames` / `generator.filename` overrides to preserve .NET's original filenames — unnecessary and fights user output conventions.
- Disabling `experiments.asyncWebAssembly` / `syncWebAssembly` globally on rspack/rsbuild — would break downstream user `.wasm` imports.
- Boot-config JSON rewriting — no `blazor.boot.json` in this project.
- Per-bundler root-script aliases — see above.

### Still out of scope after M3

Dev servers (M4), HMR, watch (M5), IDE-parity emission (M6), preload `<link>` tags (M7), source-map fidelity. Node targets for esbuild/bun/webpack/rspack/rsbuild pending the mitigations in [`node-browser-import-compatibility.md`](node-browser-import-compatibility.md).

---

## ⏸ Checkpoint — decide before M4

After M3 the plugin has a proven build-time abstraction across every unplugin-supported bundler that survived the M3.2 spike. Pick the next bite from the remaining backlog (unchanged from the pre-M3 checkpoint):

- **M4 — Dev server (Vite first)** — see the pre-M3 checkpoint entry.
- **M5 — Change detection / watch** — see the pre-M3 checkpoint entry.
- **M6 — IDE-parity emission** — see the pre-M3 checkpoint entry.
- **M7 — Preload `<link>` injection** — see the pre-M3 checkpoint entry.
- **M8 — IDE-parity language-service test** — companion to M6.

Re-read `plan.md` and this file together before committing to the next one.

---

## What we are deliberately *not* doing in M1–M3

- Dev server, MIME headers, HMR (M4).
- IDE-parity emission (`node_modules/.dotnet-vfs/`) (M6).
- Preload `<link>` tags (M7).
- Boot-manifest rewriting.
- Compression siblings.
- npm-package synthesis from emitted `package.json` (see Non-Goals in spec).

Documented as "out of scope for now" in every PR description, with a link back to this file.

---

## Operating mode for the implementation

- One PR per sub-milestone (M1.1, M1.2, …). Each PR ships passing tests for *its* slice.
- After M2, we re-read `plan.md` and this file together, prune anything that didn't survive contact with reality, and pick the next milestone.
- Whenever a real-world quirk shows up that the spec didn't anticipate (very likely — see `OutputPath=./bin/` flat layout already), file it as a follow-up against M1.3's discovery and add a regression fixture in the same PR that fixes it.
