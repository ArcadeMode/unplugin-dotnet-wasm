# Execution Plan: `unplugin-dotnet-static-assets`

Companion to `plan.md`. Milestone build order. **M1 + M2 shipped; the sections below are historical — key decisions and outcomes only.**

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

- **Repo scaffolding.** pnpm monorepo, TypeScript strict/ESM/Node 20, `tsup` for the package build, Vitest as the runner, ESLint + Prettier. Workspaces: `packages/unplugin-dotnet-static-assets`, `packages/samples/*`, `test/fixtures/*`, `test/integration`.
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

## M2 — Consolidated `dotnet publish` output

**Outcome:** the same Vite consumer can be pointed at a consolidated publish output by passing `dotnetOutputDir` and builds with no other config changes. The plugin transparently falls back to seeding the VFS from the endpoints manifest when the runtime manifest is absent.

There is **no** `mode` option and **no** `publishDir` option. VFS construction is determined by whether `{Project}.staticwebassets.runtime.json` exists at the discovered (or explicitly supplied) location — see `plan.md` §2.1. The discriminated `DotnetAssetsOptions` union already encodes the two ways a caller addresses the manifests: discovery (`projectRoot` + axes) or explicit (`dotnetOutputDir`). Callers wire dev vs prod through the bundler's own mode (e.g. Vite's `defineConfig(({ mode }) => ...)`).

### M2.1 — Generate a publish fixture

- `dotnet publish ./test/fixtures/Library -c Release -o ./test/fixtures/library-publish` produced on demand; committed to `.gitignore` and regenerated by a root script (`build:library:publish`).
- Verify the layout matches what `Microsoft.NET.Sdk.WebAssembly` actually emits on publish (flat directory containing `_framework/`, `{Project}.staticwebassets.endpoints.json`, no `*.runtime.json`).

### M2.2 — Endpoints-seeded VFS (no runtime manifest)

The existing `discoverManifests` already returns `runtimeManifestPath: null` when only the endpoints manifest is present. M2.2 wires that through the rest of the pipeline:

- In `unplugin/index.ts` `buildStart`, branch on `manifests.runtimeManifestPath`:
  - non-null → parse + `buildVfs` from the runtime manifest (existing path).
  - null → build the VFS from the endpoints manifest's `AssetFile` entries, with a single content root (= `dirname(endpointsManifestPath)`).
- When the runtime manifest is absent, `buildEmptyVfs(endpointsManifestPath, { logger? }): VirtualFileSystem` is used: it derives a single content root from the endpoints manifest location (using `wwwroot/` subdirectory when present), registers a single `**` catch-all pattern against it, and delegates to `buildVfs` — the same `resolve` / `resolveFile` interface works in both setups without branches in callers.
- Resolver behaviour (`resolveId` / `load`) is unchanged — it talks to the VFS through the same interface.
- Unit test: build the VFS from a publish fixture's endpoints manifest, assert `_framework/dotnet.js` resolves to a real file under the publish dir, assert canonical-name imports (`_framework/Library.wasm`) resolve through the same endpoint-alias path the M1.7 work added.

### M2.3 — E2E integration test for the consolidated publish layout

- New consumer fixture `test/fixtures/library-publish-consumer` (or a second build script on the existing `library-build` fixture) that wires the plugin with `defineConfig(({ mode }) => ({ plugins: [DotnetAssets({ projectName: 'Library', ...(mode === 'production' ? { dotnetOutputDir: '../library-publish' } : { projectRoot: '../Library', targetFramework: 'net10.0' }) })] }))`.
- Same Playwright assertions as M1.6, run against `vite build --mode production`.
- Plus: deleting the publish dir then re-running fails with the expected discovery error (not a stack trace).

### M2.4 — README + sample consumer

Final item before cutting `0.1.0-rc`. The original M3 milestone (SRI propagation + configurable `resolveExtensions` + API freeze + README) was pruned entirely: SRI emission has been dropped from the project (the .NET loader does its own internal hash check on `.wasm` / `.dll` / `.dat` content, browser SRI would only protect the entry `<script>` tag, and the spec no longer carries it); `resolveExtensions` can't be inherited from Rollup so adding it speculatively is unused complexity; and an "API freeze" ceremony is moot before any external consumer exists. The endpoints parser landed inside M1.7. What remains worth doing is the README + sample, relocated here.

- A short README at the package root with both wiring recipes the spec drafts:
  - **Scattered build output** (`projectRoot` + `configuration` + `targetFramework`).
  - **Consolidated publish output** (`dotnetOutputDir`).
  - The `defineConfig(({ mode }) => …)` recipe for switching between them per Vite mode.
  - Note that the endpoints manifest is parsed end-to-end and the `EndpointLookup` is exposed for downstream tooling, but the plugin itself does not currently emit preload tags — that's downstream work.
- One working sample consumer (either the existing `library-build` fixture documented as a sample, or a minimal npm-workspaces variant from `plan.md` §9.3 if it fits in <50 LOC of glue).
- TS docstrings on the user-facing types (`DotnetAssetsOptions`, both discriminated-union variants) are tightened where they're thin.

### M2 acceptance summary

- Both `dotnet build` and `dotnet publish` outputs work; the same plugin source resolves both layouts based purely on what's present on disk at the configured path.
- The discriminated `DotnetAssetsOptions` union makes dev/prod wiring a Vite-mode conditional, not a plugin-mode option.
- README + sample show the two wiring recipes; the exported TypeScript types are the public API surface for `0.1.0-rc`.
- Still: no endpoints.json behaviour beyond resolution (no preload tags), no dev server, no IDE emission, still Vite-only.

---

## ⏸ Checkpoint — decide before M3

After M2 we have a usable production-only plugin for Vite (build-time only, scattered + consolidated layouts, fingerprint-aware, README + sample, ready to cut `0.1.0-rc`). Before we keep going, we pick from the open backlog. Possible next bites, **roughly in order of likely value**:

- **M3 — Webpack adapter**: second bundler, requires cross-bundler binary-asset emission strategy (Rollup's `emitFile` + `ROLLUP_FILE_URL_*` doesn't exist in webpack) and a `BUNDLER` axis on the test matrix. Validates the unplugin abstraction. **Decided — full plan in the M3 section below.**
- **M4 — Dev server (Vite first)**: `configureServer` middleware that streams VFS files with the right `Content-Type` (`application/wasm` etc.), applies `ResponseHeaders` from endpoints.json verbatim (with stale-`Content-Length` recomputation), and handles fingerprinted route aliases.
- **M5 — Change detection / watch**: `addWatchFile` for every VFS asset, debounced manifest re-read on change, dev HMR invalidation when `dotnet build` rewrites the bin output.
- **M6 — IDE-parity emission**: the quiet `node_modules/.dotnet-vfs/` cache with `tsconfig.json` + `dotnet-vfs.d.ts`; layout-flip cleanup; one-shot info-level `extends` hint.
- **M7 — Preload `<link>` injection**: emit preload tags from `EndpointProperties.Preload*` for the `webassembly` group, ordered by `PreloadOrder`, via `transformIndexHtml`. Endpoint lookup already carries everything needed.
- **M8 — Rollup / esbuild / Rspack adapters** (round out unplugin coverage once webpack is proven).
- **M9 — IDE-parity language-service test**: automated TS server probe to prove cross-root Go-to-Definition (companion to M6).

Each of these is its own milestone-sized chunk. **Plan out M3/M4/M5 (or whichever combination we want) at that checkpoint** — we'll know more once M1 and M2 are real code in someone's hands.

---

## M3 — Webpack adapter

**Outcome:** the same plugin source resolves the `Library/` fixture through webpack build with all four `[TSExport]` classes (Echo, Counter, AsyncOps, Throws) callable from the browser. Both fingerprint and no-fingerprint shapes green. No dev-server work (that's M4 later).

### M3.1 — Design spike: binary-asset emission on both Rollup and webpack

The current `load` hook uses Rollup-native `this.emitFile({ type: 'asset' })` + `import.meta.ROLLUP_FILE_URL_<refId>` (see `packages/unplugin-dotnet-static-assets/src/unplugin/index.ts`). That placeholder is Rollup-only — webpack has no equivalent, and unplugin does **not** unify it.

Three viable strategies; pick one before writing fixture code:

- **A. Bundler-conditional `load`.** Inject a webpack `module.rules` entry (`{ test: /\.(wasm|dat|pdb)$/, type: 'asset/resource' }`) via unplugin's `webpack(compiler)` hook. In `load`, detect framework (`meta.framework === 'webpack'`) and return raw buffers; on Rollup/Vite, keep the current emit-and-reference code path. Two code paths, but each bundler uses its idiomatic pipeline.
- **B. `new URL('./x.wasm', import.meta.url)` pattern.** Portable across webpack 5, Rollup, and esbuild. Works only when the module id survives as an absolute physical path so `import.meta.url` resolves correctly — currently true. Single code path but relies on all bundlers implementing the static-analysis pattern correctly.
- **C. Bundler-agnostic via unplugin's `context.emitFile` shim.** unplugin claims to normalize `emitFile`, but the *reference-back* mechanism from `load` is not portable — so this doesn't cleanly solve the problem.

Recommendation: **A** as the primary path; **B** as fallback if webpack's `asset/resource` rule injection is fragile. Write a throwaway spike that produces a `dist/main.js` referencing an emitted `.wasm` file for each candidate; whichever ships in ≤50 LOC of plugin code wins. Done when the chosen approach is captured as a short comment on the `load` hook and both a Rollup and a webpack minimal repro produce a correct URL to a `.wasm` file.

### M3.2 — Verify manifest/VFS core is bundler-agnostic

Sanity check with `grep`: `discoverManifests`, `parseRuntimeManifest`, `parseEndpointsManifest`, `buildVfs`, `buildEmptyVfs`, `buildEndpointLookup`, `AssetResolver` must contain zero references to `vite`, `rollup`, `webpack`, or `ROLLUP_`. If any leaked, extract them into `unplugin/index.ts`. **Expected to be a no-op** given the current split, but confirming now avoids surprise later.

### M3.3 — Webpack consumer fixture

- New folder `test/fixtures/library-build-webpack/` mirroring `test/fixtures/library-build-vite/`:
  - `package.json` — name `@dotnet-wasm-bundler/library-build-webpack-fixture`, deps `webpack`, `webpack-cli`, `unplugin-dotnet-static-assets` (workspace link), `ts-loader` or `swc-loader` for the `.ts` entry.
  - `webpack.config.ts` — wires `DotnetAssets` from `unplugin-dotnet-static-assets/webpack`, `mode: 'production'`, `target: 'web'`, `experiments.asyncWebAssembly: true`, `output.publicPath: 'auto'`, `output.assetModuleFilename: 'assets/[name]-[hash][ext]'` to mirror Vite's asset layout.
  - `index.html` + `src/entry.ts` — copied verbatim from the Vite fixture. If webpack needs a `<script src>` reference the Vite fixture doesn't have, `html-webpack-plugin` handles it; keep it minimal.
  - `tsconfig.json` — same shape as the Vite fixture.
- Add pnpm workspace entry.

### M3.4 — Extend the test matrix with a `BUNDLER` dimension

- `test/integration/test-matrix.ts`: `Bundler = 'vite' | 'webpack'`. Add `webpack` to `VALID_BUNDLERS`. `readBundler()` reads `process.env.BUNDLER`, defaults to `vite`.
- `currentBundler` is already threaded into the fixture path convention: `FIXTURE_DIR = resolve(__dirname, '../../fixtures/library-build-${currentBundler}')` (see `test/integration/tests/publish.test.ts`) — no code change needed inside the specs, they follow the naming.
- `describeWhen({ bundlers: ['webpack'] })` gates for bundler-specific quirks (e.g. asset filename regex tweaks). Confirm existing regex assertions like `/^Library[.-][^/]+\.wasm$/` still match webpack's default hash filenames; adjust the regex to accept both or set `assetModuleFilename` in webpack config to align.

### M3.5 — Bundler-neutral build helper

- `test/integration/bundler-build-helper.ts` currently exposes `IsolatedViteBuild`. Introduce `IsolatedBundlerBuild` interface: `{ dist: string; assets: string; entryChunk: string; warnings: string[] }` returned by a `runBuild(bundler: Bundler, fixtureDir: string)` factory. Two implementations: existing Vite-programmatic-API driver, new webpack-Node-API driver (`webpack(config, (err, stats) => …)`).
- Warnings surface via `stats.warnings` for webpack, `logger.warn` capture for Vite (already wired).

### M3.6 — Root script parameterization

Add BUNDLER-parameterized scripts to root `package.json`:

```jsonc
{
  "build:fixture:vite":     "pnpm --filter @dotnet-wasm-bundler/library-build-vite-fixture build",
  "build:fixture:webpack":  "pnpm --filter @dotnet-wasm-bundler/library-build-webpack-fixture build",

  "test:integration:vite:fingerprint":      "cross-env BUNDLER=vite    DOTNET_FIXTURE_SHAPE=fingerprint    pnpm --filter @dotnet-wasm-bundler/integration-tests test",
  "test:integration:vite:nofingerprint":    "cross-env BUNDLER=vite    DOTNET_FIXTURE_SHAPE=nofingerprint  pnpm --filter @dotnet-wasm-bundler/integration-tests test",
  "test:integration:webpack:fingerprint":   "cross-env BUNDLER=webpack DOTNET_FIXTURE_SHAPE=fingerprint    pnpm --filter @dotnet-wasm-bundler/integration-tests test",
  "test:integration:webpack:nofingerprint": "cross-env BUNDLER=webpack DOTNET_FIXTURE_SHAPE=nofingerprint  pnpm --filter @dotnet-wasm-bundler/integration-tests test",

  "test:fingerprint-enabled":  "pnpm clean:library && pnpm build:plugin && pnpm build:library:fingerprint  && pnpm build:fixture:vite && pnpm build:fixture:webpack && pnpm test:unit && pnpm test:integration:vite:fingerprint  && pnpm test:integration:webpack:fingerprint  && pnpm test:e2e:vite && pnpm test:e2e:webpack",
  "test:fingerprint-disabled": "pnpm clean:library && pnpm build:plugin && pnpm build:library:nofingerprint && pnpm build:fixture:vite && pnpm build:fixture:webpack && pnpm test:unit && pnpm test:integration:vite:nofingerprint && pnpm test:integration:webpack:nofingerprint && pnpm test:e2e:vite && pnpm test:e2e:webpack"
}
```

Matrix cardinality: `{fingerprint, nofingerprint, none} × {vite, webpack} = 6` fixture-shape × bundler combinations. `none` runs once (bundler-independent), so total integration invocations per full test run is 5.

### M3.7 — Playwright per-bundler

- `test/integration/playwright.config.ts` reads `BUNDLER` env, points `webServer` at the correct fixture (`library-build-${BUNDLER}/dist`).
- Interop assertions (`test/integration/tests/runtime.spec.ts`) are bundler-blind — they only touch `window.__lib` — so nothing changes there.
- One new spec `webpack-boot.spec.ts` (or reuse `runtime.spec.ts` under different BUNDLER env) asserts the webpack-emitted bundle boots identically. Same Playwright pattern: `page.goto('/')`, `waitForFunction(() => __libReady)`, evaluate each `[TSExport]` call.
- Root scripts: `test:e2e:vite`, `test:e2e:webpack`, `test:e2e` chains both.

### M3.8 — Docs

- Bump `packages/unplugin-dotnet-static-assets/README.md` webpack section from "Supported" to "Tested" once green.
- One paragraph in this file noting the M3.1 decision (which of A/B/C won and why) and the matrix cardinality change.

### M3 acceptance summary

- `pnpm test` (which chains both fingerprint states + `test:no-build`) runs the full 5-cell matrix and exits 0.
- The plugin core (`src/core/*` + `src/unplugin/index.ts`) contains exactly one bundler-conditional branch — the M3.1 asset-emission split — living inside `unplugin/index.ts` at ~20–30 LOC.
- `test/fixtures/library-build-webpack/dist/` contains a bootable bundle whose `Library.<fp>.wasm` matches the source bytes.
- Playwright interop spec passes against both bundlers unchanged.

**Non-goals for M3** (deliberate): webpack-dev-server (that's M4), HMR, source-map fidelity, Rspack (M8 even though it shares 90% of webpack's config surface).

---

## ⏸ Checkpoint — decide before M4

After M3 the plugin has a proven cross-bundler build-time abstraction. Pick the next bite from the remaining backlog (unchanged from the pre-M3 checkpoint, renumbered):

- **M4 — Dev server (Vite first)** — see the pre-M3 checkpoint entry.
- **M5 — Change detection / watch** — see the pre-M3 checkpoint entry.
- **M6 — IDE-parity emission** — see the pre-M3 checkpoint entry.
- **M7 — Preload `<link>` injection** — see the pre-M3 checkpoint entry.
- **M8 — Rollup / esbuild / Rspack adapters** — round out unplugin coverage.
- **M9 — IDE-parity language-service test** — companion to M6.

Re-read `plan.md` and this file together before committing to the next one.

---

## What we are deliberately *not* doing in M1–M3

- Webpack, Rollup, esbuild, Rspack — Vite only.
- Dev server, MIME headers, HMR.
- IDE-parity emission (`node_modules/.dotnet-vfs/`).
- Preload `<link>` tags.
- Boot-manifest rewriting.
- Compression siblings.
- npm-package synthesis from emitted `package.json` (see Non-Goals in spec).
- Playwright browser boot tests.

Documented as "out of scope for now" in every PR description, with a link back to this file.

---

## Operating mode for the implementation

- One PR per sub-milestone (M1.1, M1.2, …). Each PR ships passing tests for *its* slice.
- After M2, we re-read `plan.md` and this file together, prune anything that didn't survive contact with reality, and pick the next milestone.
- Whenever a real-world quirk shows up that the spec didn't anticipate (very likely — see `OutputPath=./bin/` flat layout already), file it as a follow-up against M1.3's discovery and add a regression fixture in the same PR that fixes it.
