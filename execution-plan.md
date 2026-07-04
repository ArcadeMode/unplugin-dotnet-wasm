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

## M2 — Consolidated `dotnet publish` output (shipped)

**Outcome:** the same consumer works against `dotnet publish` output by passing `dotnetOutputDir`. VFS construction branches on the presence of `{Project}.staticwebassets.runtime.json` — no `mode` option, no `publishDir` option. Dev/prod wiring is a Vite-mode conditional on the caller side (e.g. `defineConfig(({ mode }) => …)`), not a plugin option.

### Key decisions

- **Publish fixture on-demand.** `build:library:fingerprint` / `:nofingerprint` chain a `dotnet publish -c Release`; `bin/Release/net10.0/publish/` is gitignored and regenerated per test run.
- **Endpoints-seeded VFS.** When `runtimeManifestPath` is `null`, `buildEmptyVfs(endpointsManifestPath, { logger })` (`src/core/vfs.ts`) derives a single content root from the endpoints manifest location (using `wwwroot/` subdir when present) and registers a `**` catch-all pattern. Callers see the same `VirtualFileSystem` interface; the resolver is unchanged.
- **Publish E2E** (`test/integration/tests/publish.test.ts`) covers `fingerprint`, `nofingerprint`, and `none` (negative-path: publish dir cleaned → discovery must fail with a message, not a stack).
- **Public API.** [`packages/unplugin-dotnet-static-assets/README.md`](packages/unplugin-dotnet-static-assets/README.md) documents both wiring recipes and the `defineConfig(({ mode }) => …)` dev/prod switch. Sample consumer lives at `packages/samples/{SampleLibrary,sample-vite}`.

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

## M3 — All build-time bundlers

**Outcome:** the same plugin source resolves the `Library/` fixture through every unplugin-supported build-time bundler that survives the M3.2 spike, with all four `[TSExport]` classes callable from the browser. Both fingerprint and no-fingerprint shapes green on every shipped bundler. No dev-server work (that's M4).

**Bundler scope.** Direct targets requiring their own adapter and fixture: `webpack`, `rspack`, `rsbuild`, `esbuild`, `rolldown`, `farm`, `bun`. Indirect targets that ride on a direct adapter and need no separate fixture: `vite` build → rollup path. Explicitly deferred: `vite` dev (M4).

**Prerequisite: unplugin 2.3.11 → 3.3.0.** Bun support landed in v3.0.0; the dedicated rsbuild adapter in v3.3.0 (2026-06-29). v3.0.0 is a major bump: ESM-only, drops Node 18 (we're on 20 — fine), removes the acorn dependency (we don't call `this.parse()`, so also fine). Ship the version bump as part of M3.4; keep the current webpack spike's "omit `load` on webpack" workaround unless a quick re-verification under 3.x shows the load-loader was made `raw: true` (cheap to check while doing the split).

**Execution shape.** Hybrid: spike every direct target in parallel with throwaway code (M3.2), then split the plugin once informed by all spike outcomes (M3.4), then batch fixtures + matrix expansion (M3.5+). Any bundler whose spike fails is dropped from M3 and filed as a follow-up — acceptance is bounded by what passed the spike, not an all-or-nothing gate.

### M3.1 — Design spike: webpack (shipped)

Approach A ("bundler-conditional plugin shape") won. Non-obvious finding: unplugin's webpack load-loader is not `raw: true`, so a `load` hook returning `null` still round-trips the file bytes through UTF-8 and corrupts binaries. Fix: **omit `load` entirely for webpack** and rely on an `asset/resource` `module.rules` entry injected via the `webpack(compiler)` hook. Choice captured as a comment on the `load` hook in `packages/unplugin-dotnet-static-assets/src/unplugin/index.ts`. Throwaway spike at `test/spikes/asset-emission/`.

### M3.2 — Spike the remaining bundlers (parallel)

One throwaway spike per remaining direct target, same shape as M3.1: `plugin.mjs` + `run.mjs` that emits one hashed `.wasm` referenced from the entry chunk, byte-identical to source. All spikes independent; can be interrupted; a red spike drops that bundler from M3. **Do these under unplugin 3.3.0** — don't spike on 2.x since the plugin itself is bumping to 3.x in M3.4.

Rather than one spike folder per bundler, the actual spike collapsed to a single `test/spikes/asset-emission/` with a shared `plugin.mjs` factory that branches on `meta.framework`, one config per bundler, and a `run.mjs` runner that drives all bundlers (or a subset via CLI args) and asserts exactly one `.wasm` emitted per bundler with byte-identical content to source. Simpler than N parallel folders and made the branch shapes directly comparable.

#### M3.2 spike outcomes (all 9 direct targets PASS, byte-identical 17173B)

| Bundler | Time | Emit path | Notable finding |
|---|---|---|---|
| `rollup` | 0.2s | `this.emitFile({type:'asset'})` + `import.meta.ROLLUP_FILE_URL_<refId>` | baseline; unchanged from M3.1 |
| `vite` (build) | 0.2s | rollup path | works with zero vite-specific code — rides `meta.framework === 'vite'` through the same rollup-family branch |
| `webpack` | 0.7s | `{test:/\.wasm$/,type:'asset/resource'}` rule injected via `webpack(compiler)` | keep the M3.1 "omit `load` for webpack" workaround under unplugin 3.3.0 — the load-loader is still not `raw: true` |
| `esbuild` | <0.1s | esbuild-native `.wasm` → `file` loader; register `build.onResolve` inside `esbuild.setup(build)` | **must drop `resolveId` for esbuild-family** — unplugin's resolveId return is placed in unplugin's own namespace, defeating esbuild's extension-loader mapping. Also: `plugin.esbuild` in unplugin 3.x is an object `{ setup, config, onResolveFilter, onLoadFilter, loader }`, not a bare `(build) => void` function |
| `rspack` | 0.1s | same as webpack (asset-module rule via `rspack(compiler)`) | mirrors webpack — no additional workaround needed |
| `rsbuild` | 0.1s | asset-module rule scoped by absolute path via `rsbuild.setup(api).modifyRspackConfig` | **rsbuild enables `experiments.asyncWebAssembly` by default**, and its built-in `.wasm → webassembly/async` rule runs ahead of a rule appended via `push`. Fix: (a) scope our rule with `include: <resolved abs path>` instead of a naked `test: /\.wasm$/`, so we only claim files our `resolveId` actually returned; (b) `unshift` (not `push`) into `config.module.rules` from the rsbuild hook so we take priority over the default rule for those specific files. Do **not** disable `experiments.asyncWebAssembly` — the scoped rule wins per-file without that, and disabling it would break any downstream `import { foo } from './their.wasm'`. **Verified non-interference in-spike**: a `rsbuild-mixed` scenario builds an entry that imports both our virtual specifier and a user-owned `other.wasm` (with named export `f`). rsbuild produces `static/assets/Library.<hash>.wasm` (17173B, byte-identical) *and* `static/wasm/<hash>.module.wasm` (30B, rsbuild's wasm-ESM chunk) — the named `{ f }` import links successfully, which is only possible if the default `webassembly/async` path is still handling the user file. |
| `rolldown` | <0.1s | rollup path | placeholder rewrite for `ROLLUP_FILE_URL_*` works as-of rolldown 1.1.3 |
| `farm` | 1.3s | rollup-shaped `resolveId` + `compilation.assets.include:['wasm']` in farm config | Farm needs the compilation config opt-in to treat `.wasm` as an emittable asset; the plugin's resolveId return is honored |
| `bun` | 0.2s (installed 1.3.14) | esbuild-shaped path — mirrors esbuild; `plugin.bun.setup(build)` also object-shaped in unplugin 3.x | verified against Bun 1.3.14 on this machine via `Bun.build({loader:{'.wasm':'file'}, naming:{asset:'assets/[name]-[hash].[ext]'}})` |

Result: **all 9 direct targets green** — no bundler dropped from the M3 roster. Spike lives at `test/spikes/asset-emission/` outside pnpm workspace globs; `node run.mjs` runs all 9 and prints a per-bundler pass/fail summary.

### M3.3 — Verify manifest/VFS core is bundler-agnostic

Sanity check with `grep`: `discoverManifests`, `parseRuntimeManifest`, `parseEndpointsManifest`, `buildVfs`, `buildEmptyVfs`, `buildEndpointLookup`, `AssetResolver` must contain zero references to `vite`, `rollup`, `webpack`, `rspack`, `rsbuild`, `esbuild`, `rolldown`, `farm`, `bun`, or `ROLLUP_`. If any leaked, extract them into `unplugin/index.ts`. Expected to be a no-op given the current split.

### M3.4 — Plugin split + unplugin 3.x upgrade (one refactor, informed by all spike outcomes)

Bundle two changes into one focused edit:

1. Bump `unplugin` dep in `packages/unplugin-dotnet-static-assets/package.json` from `^2.3.11` to `^3.3.0`. Confirm no CJS consumers rely on the old dual build (we're ESM-only already). Re-run the webpack spike briefly under 3.x; if the load-loader is now `raw: true`, drop the "omit `load` on webpack" workaround, otherwise keep it.
2. Rewrite `packages/unplugin-dotnet-static-assets/src/unplugin/index.ts` to return a plugin object shaped per `meta.framework`, informed by the M3.2 spike:
   - Rollup-family (`rollup`, `vite`, `rolldown`): existing `load` path (emit + `ROLLUP_FILE_URL_*`).
   - webpack-family (`webpack`, `rspack`): no `load` for binary extensions; the framework hook injects an `asset/resource` module rule via `webpack(compiler)` / `rspack(compiler)`. **Scope the rule** with `include` (VFS-known absolute paths) or `test` (function over VFS membership), or append a `?dotnet-static-asset` marker in `resolveId` and match `resourceQuery` — don't use a naked `/\.wasm$/` regex, which would steal every `.wasm` in a downstream project.
   - `rsbuild`: same scoped rule, but **`unshift`** it into `config.module.rules` from inside `rsbuild.setup(api).modifyRspackConfig` (not `push`) — rsbuild's built-in `.wasm` rule runs ahead of appended user rules, so ours has to come first to win for our files. `experiments.asyncWebAssembly` and `syncWebAssembly` stay at their defaults; the scoped rule wins per-file without touching them, and disabling them would break downstream `import { foo } from './their.wasm'`.
   - esbuild-family (`esbuild`, `bun`): **drop `resolveId`** for binary extensions on this branch (unplugin's resolveId return is placed in a plugin-scoped namespace, which defeats the bundler's native extension-loader mapping). Register `build.onResolve` directly inside `plugin.esbuild.setup(build)` / `plugin.bun.setup(build)` so the file lands in the default namespace and the bundler's `.wasm` → `file` loader takes over. Note the object hook shape: `plugin.esbuild` and `plugin.bun` in unplugin 3.x are `{ setup, config, onResolveFilter, onLoadFilter, loader }` objects, not bare functions.
   - `farm`: rollup-shaped `resolveId` + Farm-config opt-in `compilation.assets.include:['wasm']` (surfaced via plugin option docs since it's a farm-config change, not a plugin hook).

Framework-specific re-exports at `src/{rollup,vite,webpack,esbuild}.ts` already exist; add `src/{rspack,rsbuild,rolldown,farm,bun}.ts` matching the same shape, guarded on whichever bundlers passed M3.2.

**Decisions locked after M3.2 discussion:**

- **Extension coverage:** the scoped rule / esbuild loader map / farm asset list covers `.wasm`, `.dat`, `.pdb` — the existing `BINARY_EXTENSIONS` set is authoritative. Same rule shape for all three; no per-extension branching.
- **`.js` loader files (`dotnet.js`, `dotnet.native.js`, `dotnet.runtime.js`):** no special handling. `resolveId` returns the physical path; the bundler's normal JS pipeline processes them. Empirically verified on the shipping Vite sample/fixture.
- **Text sidecars (`.js.map`, `.js.symbols.json`):** decide per-file when they surface; assume they ride the import graph the same as `.js` loader files. Not blocking M3.4.
- **Rule scoping shape:** exact-path `include: [absolute path, ...]` sourced from `AssetResolver` — no regex predicates or query-string markers. This aligns with the "be exact" posture and shares the same file list the endpoints-manifest work in the next bullet will need.
- **Endpoints-manifest treatment:** separate subtask, tracked before M3.5 (see below). Anything that comes in via the import graph works for asset emission; the *manifest* side may need extra work to record bundler-renamed asset paths so `staticwebassets` metadata (integrity, content-type) stays coherent.
- **No name-preservation, no manifest rewriting.** `WasmBundlerFriendlyBootConfig=true` emits `dotnet.js` with real `import "./<asset>"` per asset, so bundler reference-rewriting carries the runtime lookup end-to-end. Verified: the shipping Vite fixture emits `Library-<hash>.wasm` / `dotnet.native-<hash>.wasm` / `icudt_EFIGS-<hash>.dat` and Playwright round-trips pass.
- **File layout:** family-split under `src/unplugin/` — one file per family (`rollup.ts`, `webpack.ts`, `esbuild.ts`, `farm.ts` or similar) re-exported from `index.ts`. `meta.framework` dispatch lives in `index.ts`. Mirrors the fixture/sample-per-bundler convention.
- **Base-path handling:** VFS/manifest core ignores base path. Verifying non-root `base` / `publicPath` / `output.publicPath` is a test-suite concern (M3.5+), not an M3.4 code concern.
- **Bundler support scope:** ship all 9 in M3.4. Drop only if a specific one becomes unsustainable in practice; that decision is made per-bundler when observed, not up front.

**Non-goals (do not reintroduce):**

- Per-bundler `assetNames` / `output.assetFileNames` / `generator.filename` overrides to preserve `.NET`'s original filenames — unnecessary, and would fight users' output conventions.
- Disabling `experiments.asyncWebAssembly` / `syncWebAssembly` globally on rspack/rsbuild — would break downstream `import { foo } from './their.wasm'`. Scoped `include` matches only our files and leaves the defaults intact.
- Boot-config JSON rewriting — there is no `blazor.boot.json` in this project; the SDK emits `dotnet.js` with JS imports instead.

**Endpoints-manifest / bundler-renamed assets (open subtask, pre-M3.5):** investigate how the staticwebassets endpoints manifest should reflect assets after the bundler hashes and relocates them. Options: (a) leave manifest untouched and rely on the runtime import bindings for lookup; (b) post-process manifest with bundler-produced rename table. Decide before M3.5 fixtures land so integration tests exercise the correct expectation.

**Done when:** one focused edit lands both the dep bump and the split; existing Vite tests still pass; the bundler-conditional branch is ~40–60 LOC and confined to `unplugin/` (may be split across family files, still counted as one region).

### M3.5 — Browser fixture batch

One browser fixture per bundler that passed M3.2, following the new `test/fixtures/browser/library-app-${bundler}/` convention. Each fixture:

- `package.json` — name `@dotnet-wasm-bundler/library-app-browser-${bundler}-fixture`, deps for the bundler + `unplugin-dotnet-static-assets` (workspace link) + minimal loader deps (`ts-loader`/`swc-loader`/etc. as needed).
- `${bundler}.config.ts` (or `.mjs`) — wires `DotnetAssets` from the matching entry point, `mode: 'production'` equivalent, `target: 'web'`, hashed asset filename template aligned with Vite's `assets/[name]-[hash][ext]` shape where the bundler supports it.
- `index.html` + `src/entry.ts` — copied verbatim from the Vite fixture.
- `tsconfig.json` — same shape as the Vite fixture.
- pnpm workspace entry.

All browser fixtures ship in one PR — they're structurally identical. Directory structure: `test/fixtures/browser/` is the platform parent, with one `library-app-{bundler}/` sibling per bundler.

### M3.5b — Node smoke fixture (esbuild only)

**Rationale:** Bundling for Node is niche — esbuild/webpack/rollup have idiomatic Node targets with real ecosystem usage, while vite/rsbuild/farm/rolldown have Node support that's browser-first or SSR-only. Rather than duplicate all 9 fixtures on a node axis, ship one smoke test (esbuild) to prove:
- The plugin doesn't hardcode browser assumptions (e.g. `window` references).
- The .NET WASM runtime can boot outside a browser.
- Assets resolve correctly in a Node.js execution context.

Expand to additional bundlers only if a real use case surfaces.

**One fixture:** `test/fixtures/node/library-app-esbuild/`

- `package.json` — name `@dotnet-wasm-bundler/library-app-node-esbuild-fixture`; same bundler deps as the browser sibling; `"build"` runs the bundler, `"test"` runs `node dist/entry.js` and exits 0 on success, non-zero on failure.
- `esbuild.build.mjs` — identical to browser config except `platform: 'node'`. No `index.html`, no `publicPath` override.
- `src/entry.ts` — no `window` dependency; calls the same `[TSExport]` surface (`Echo`, `Counter`, `AsyncOps`, `Throws`) and logs results to stdout. Exits `process.exitCode = 0` on success.
- `tsconfig.json` — same as browser sibling.

**Matrix impact:** adds a `PLATFORM` axis to M3.6 — `{browser, node}` — but the node cells are sparse (only esbuild). Full matrix: `{fingerprint, nofingerprint} × {9 browser bundlers} + {fingerprint, nofingerprint} × {1 node bundler} + 1 none`. The `node` cell skips Playwright and asserts `node dist/entry.js` exits 0 with expected stdout.

**Non-goals for M3.5b:** no dev server, no HMR, no full matrix duplication, no Node support for all bundlers (defer per-request).

### M3.6 — Test matrix + bundler-neutral build helper

- `test/integration/test-matrix.ts`: `Bundler` union covers every direct target that passed M3.2. `readBundler()` reads `process.env.BUNDLER`, defaults to `vite`. Add `Platform` type (`'browser' | 'node'`) and `readPlatform()` reading `PLATFORM` env (defaults to `'browser'`). `FIXTURE_DIR` pattern: `test/fixtures/${platform}/library-app-${currentBundler}`.
- `test/integration/bundler-build-helper.ts`: `IsolatedBundlerBuild` interface `{ dist: string; assets: string; entryChunk: string; warnings: string[] }` returned by a `runBuild(bundler, fixtureDir)` factory. One implementation per bundler (existing Vite driver + N new drivers, each ~10–30 LOC calling the bundler's Node API). Warnings surface via each bundler's native diagnostics.
- `describeWhen({ bundlers: [...] })` gates for bundler-specific quirks. Confirm existing `/^Library[.-][^/]+\.wasm$/` assertion matches every bundler's default hash filename; adjust the regex or align each bundler's asset-filename template.

### M3.7 — Root scripts + Playwright per-platform-bundler

- Root `package.json`: `build:fixture:browser:{bundler}` and `build:fixture:node:esbuild` (smoke only). `test:integration:browser` / `test:integration:node` chain the matrix for each platform. `test:fingerprint-enabled` / `-disabled` remain as the top-level chains covering all platforms.
- `test/integration/playwright.config.ts` reads `BUNDLER` env, points `webServer` at the matching fixture's `dist/`.
- Interop spec (`test/integration/tests/runtime.spec.ts`) stays bundler-blind — one shared spec covers every bundler.
- `test:e2e:${bundler}` + `test:e2e` chain.

**Matrix cardinality:** `{fingerprint, nofingerprint} × N_bundlers + 1 (`none`)` integration invocations per full test run.

### M3.8 — Docs

- Bump `packages/unplugin-dotnet-static-assets/README.md`: each shipped bundler moves to "Tested"; deferred bundlers listed as "Not yet supported" with the M3.2 reason.
- One paragraph in this file recording spike outcomes and the final bundler roster.

### M3 acceptance summary

- `pnpm test` runs the full `{fingerprint, nofingerprint} × N_bundlers` matrix + the single `none` cell and exits 0.
- Plugin core contains exactly one bundler-conditional region — the M3.4 split — confined to `unplugin/index.ts`.
- Each shipped bundler's fixture produces a bootable bundle whose `Library.<fp>.wasm` matches source bytes.
- Playwright interop passes against every shipped bundler.

**Non-goals for M3** (deliberate): dev servers (M4), HMR, source-map fidelity.

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
