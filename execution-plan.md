# Execution Plan: `unplugin-dotnet-static-assets`

Companion to `plan.md`. The spec describes the full target system; this file is the **build order**. Each milestone is small enough to ship and verify on its own. We stop at M3 and decide whether to continue, change scope, or rip something out.

## Anchor fixture

`./Library/` — `Microsoft.NET.Sdk.WebAssembly` project (`net10.0`) using **default SDK conventions**:

- Standard output layout: `Library/bin/<Configuration>/<TargetFramework>/` (so after `dotnet build` the manifests land at `Library/bin/Debug/net10.0/Library.staticwebassets.runtime.json` and `….staticwebassets.endpoints.json`). The plugin must handle this canonical path on day one.
- `WasmBundlerFriendlyBootConfig=true` → `_framework/dotnet.js` emits native `import dotnet_native_wasm from "./dotnet.native.wasm"` etc. This is the bundler-friendly path the plugin exists to support.
- `WasmFingerprintAssets=false` and `CompressionEnabled=false` → no `.br/.gz` siblings, no hashed filenames in this fixture. Both of those are deferred features.
- Two content roots: `Library/wwwroot/` (source) and `Library/bin/Debug/net10.0/wwwroot/` (build output). They overlap on `main.ts`, `wasm-bootstrap.ts`, `TypeShimProvider.tsx`; `typeshim.ts` and the whole `_framework/` runtime exist only in the bin root. **Cross-root resolution is required from the first commit.**
- `Patterns: [{ ContentRootIndex: 0, Pattern: "**", Depth: 0 }]` → glob fall-through to source root for files not enumerated.

End-to-end success for M1 means: a Vite project imports `./Library/wwwroot/main.ts`, `vite build` succeeds, and `dist/_framework/dotnet.native.wasm` (and every other assembly the runtime asks for) is present with correct bytes.

---

## M1 — Vite + Mode A + `dotnet build` only

**Outcome:** `pnpm --filter consumer build` produces a working WASM-loading bundle from the `Library/` fixture. Zero dev-server, zero endpoints, zero IDE emission, zero other bundlers.

### M1.1 — Repo scaffolding

- pnpm workspace at repo root: `packages/unplugin-dotnet-static-assets`, `test/fixtures/library-build` (Vite consumer), `test/integration`.
- TypeScript strict, ESM, Node 20 target, `tsup` for the package build.
- Vitest as the runner. ESLint + Prettier minimal config.
- One npm script per workspace: `build`, `test`, `typecheck`.
- `.gitignore` covers `dist/`, `node_modules/`, `node_modules/.dotnet-vfs/`, plus the `Library/bin/` and `Library/obj/` (we keep `Library/wwwroot/` source under version control; the build output is a regenerated artifact).

**Done when:** `pnpm install && pnpm -r build && pnpm -r test` exits 0 with an empty test suite.

### M1.2 — Runtime-manifest parser

- File: `src/core/manifest-runtime.ts`.
- Zod schemas mirroring the real shape: `ContentRoots: string[]`, `Root: Node` with `Children | null`, `Asset: { ContentRootIndex; SubPath } | null`, `Patterns: { ContentRootIndex; Pattern; Depth }[] | null`.
- `parseRuntimeManifest(buffer | string): RuntimeManifest` with friendly errors that point at the offending JSON path.
- Unit test reads `Library/bin/Debug/net10.0/Library.staticwebassets.runtime.json` verbatim and asserts: three content roots, `_framework/dotnet.d.ts` belongs to root 0, `typeshim.ts` to root 1 (generated `obj/Debug/net10.0/TypeShim/staticwebassets/wwwroot/` dir), `_framework/dotnet.js` and `_framework/Library.wasm` to root 2, fall-through pattern at the root node points at root 0.

**Done when:** `vitest run` parses the real manifest with zero allocations of `any`.

### M1.3 — Discovery (standard `bin/<Configuration>/<TargetFramework>/` layout)

- File: `src/core/discover.ts`.
- `discoverRuntimeManifest(opts): { manifestPath, projectName, resolvedConfiguration, resolvedTargetFramework }`.
- **Explicit options exposed from M1** (mirrors `plan.md` §8):
  - `projectRoot: string` — required for M1; the .NET project directory (the one containing the `.csproj`).
  - `configuration?: string` — default `'Debug'`. The full default-resolution chain (env var, bundler mode, etc.) lands in M2.4.
  - `targetFramework?: string` — if omitted, the discovery globs `<projectRoot>/bin/<configuration>/*/` and requires exactly one TFM directory; else hard-fail with the enumerated candidates.
  - `manifestPath?: string` — if set, used verbatim and the other axes are ignored.
- Algorithm for M1:
  1. If `manifestPath` is set, take it verbatim.
  2. Otherwise construct `<projectRoot>/bin/<configuration>/<targetFramework>` from supplied/defaulted options, filling each unset axis with the unique-directory rule above. Glob `*.staticwebassets.runtime.json` inside it.
  3. On zero hits, throw with a clear message naming the directory searched and the resolved axes.
  4. On multiple hits in the *same* directory (unlikely but possible), throw with the candidate list.
- Ranking across siblings (e.g. Debug vs Release both present), mtime-based staleness warnings, env-var resolution: **deferred to M2.4**. M1 just needs deterministic behaviour given the options.

**Done when:** unit tests prove:
- Default options (`{ projectRoot: 'Library' }`) resolve to `Library/bin/Debug/net10.0/Library.staticwebassets.runtime.json` against the fixture.
- Explicit `{ configuration: 'Debug', targetFramework: 'net10.0' }` resolves identically.
- A synthetic fixture with two TFMs under `bin/Debug/` fails with a message enumerating them and hinting at the `targetFramework` option.
- A missing manifest fails with a message naming the searched directory.

### M1.4 — VFS builder + lookup

- File: `src/core/vfs.ts`.
- `buildVfs(manifest): VirtualFileSystem` returning:
  ```ts
  {
    contentRoots: string[];               // POSIX, trailing slash
    lookup: Map<string, ResolvedAsset>;   // O(1) virtual → physical
    shadowedPairs: Set<string>;           // .ts / .d.ts pairs for one-shot debug log
    list(virtualDir: string): string[];   // for dir listings later
    resolve(virtualPath: string): ResolvedAsset | undefined;
  }
  ```
- **The VFS contains only what the manifest declares to be virtual.** Every explicit `Asset` node is ingested into `lookup` at construction time. Files that exist on disk but are not enumerated and do not fall under a matching `Patterns` entry are *not* part of the VFS — callers treat a `resolve()` miss as a signal to delegate to the host bundler's native resolver.
- POSIX normalisation internally, case-insensitive lookup key (lowercase), case-preserving `physicalPath`.
- Extension probe order **hard-coded for M1**: `['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json']`. `index.<ext>` lookup uses the same list. (Configurable in M3.)
- `.ts` shadows `.d.ts` rule (one-shot debug log per pair, deferred to M1.5; M1.4 only populates `shadowedPairs`).
- Pattern fallthrough: when the map lookup + probes miss, evaluate each `Patterns` entry against the remaining virtual path; for each match, do **one `statSync`** against `join(ContentRoots[i], candidate)` (literal + per probe extension + `index.<ext>`). Hits are cached back into `lookup`. **No directory enumeration anywhere** — the plugin never lists a directory; it only reads files the manifest names or the patterns point at.

**Done when:** tests prove:
- `resolve('_framework/dotnet.js')` → root 2 absolute path.
- `resolve('_framework/dotnet.d.ts')` → root 0 absolute path.
- `resolve('wasm-bootstrap')` (extensionless) → `wwwroot/wasm-bootstrap.ts`.
- `resolve('typeshim')` → root 1 absolute path (`typeshim.ts` is explicitly enumerated in the manifest at ContentRootIndex 1, the generated `obj/Debug/net10.0/TypeShim/staticwebassets/wwwroot/` directory).
- `resolve('main')` → `wwwroot/main.ts` (root 0, as declared in the manifest).
- An unlisted user file dropped under `wwwroot/foo.txt` resolves via the fall-through `Patterns` entry (single stat against root 0).

### M1.5 — Vite unplugin shell

- Files: `src/unplugin/index.ts`, `src/vite.ts`.
- Use `unplugin@^2` to wrap a single factory; only the Vite adapter is exported in M1.
- Hooks:
  - `buildStart`: run discovery + VFS construction; throw if it fails.
  - `resolveId(source, _importer)`:
    1. Treat `source` as a virtual path verbatim (strip a leading `./` or `/`, POSIX-normalise). The importer is intentionally not consulted — the VFS is an importer-blind overlay; relative-path semantics belong to the host bundler.
    2. Call `vfs.resolve(source)`; on hit, return the absolute physical path.
    3. On miss, return `null` so the host resolver carries on. The bundler will resolve relative imports against the importer's physical directory; that is the correct behaviour for non-virtual files, sibling build-output files, and consuming-project imports alike.
  - `load(id)`: only handles binary extensions (`.wasm`, `.dat`, `.pdb`). For those, read bytes and return via Vite's standard asset API (`this.emitFile({ type: 'asset' })` then `export default __VITE_ASSET__<hash>`). Text files (`.ts`, `.tsx`, `.js`, `.json`) flow through unchanged so Vite's own transformers handle them.
- Options exposed in M1 (all forwarded to `discoverRuntimeManifest`; defaults documented in M1.3):
  - `projectRoot: string` — required for now; we don't auto-walk above the consumer yet.
  - `configuration?: string` — explicit override; default `'Debug'`.
  - `targetFramework?: string` — explicit override; auto-detected when exactly one TFM directory exists.
  - `manifestPath?: string` — absolute-or-relative bypass; when set, the discovery skips path construction entirely.
- The Vite adapter registers with `enforce: 'pre'` so the importer-blind overlay runs before Vite's built-in resolvers; otherwise virtual specifiers like `./_framework/dotnet` would be resolved against the importer's physical directory and miss the build-output root.

**Done when:** a consumer with:
```ts
// test/fixtures/library-build/src/entry.ts
import { dotnet } from './_framework/dotnet';
import { TypeShimInitializer } from './typeshim';

async function initializeWasmRuntime(): Promise<void> {
  const runtimeInfo = await dotnet.create();
  await TypeShimInitializer.initialize(runtimeInfo);
  runtimeInfo.runMain();
  console.log('WASM runtime initialized successfully.');
}

initializeWasmRuntime();
```
…builds without errors. `./_framework/dotnet` and `./typeshim` are importer-blind virtual specifiers: the plugin strips the leading `./`, and the VFS resolves them to `bin/Debug/net10.0/wwwroot/_framework/dotnet.js` (root 2) and `obj/Debug/net10.0/TypeShim/staticwebassets/wwwroot/typeshim.ts` (root 1) respectively — even though neither directory exists next to `entry.ts`.

### M1.6 — Playwright E2E with real WASM interop

M1.6 proves the end-to-end M1 outcome: a `dotnet`-built WASM project bundled by Vite via this plugin actually boots in a real browser and `[TSExport]` classes are callable from JS. It builds on M1.5 by adding (a) a minimal, test-shaped Library, (b) build-time smoke assertions on the bundle, and (c) Playwright-driven interop tests against the built bundle.

**Why static-serve + Playwright (and not vitest browser mode):**
- The M1.5 plugin only implements the **build-time** Rollup pipeline: `this.emitFile()` + `import.meta.ROLLUP_FILE_URL_*`. That placeholder is rewritten at chunk-emit time and does not exist in Vite's dev pipeline. Vitest browser mode and Vite dev server route imports through the dev pipeline, so they would receive the literal placeholder and fail.
- Wiring the plugin into the dev pipeline (`configureServer`, dev-mode `load`, dev `_framework/*` URL handling) is a milestone of its own and is out of scope here. M1 stays "build-only".
- Building the fixture once with `vite build`, then serving `dist/` over plain HTTP and pointing Playwright at it, exercises the actual M1 deliverable without expanding plugin scope.

#### M1.6.a — Restructure: move the .NET fixture under `test/`

Mirrors the `TypeShim.E2E.Wasm` + `TypeShim.E2E.vitest` sibling pattern.

- Move `Library/` → `test/fixtures/library/` (csproj, `wwwroot/`, `Properties/`, source files).
- Replace the current Library contents (`PeopleApiClient.cs`, `PeopleProvider.cs`, `PeopleApp.cs`, `RandomEntityGenerator.cs`, `Models.cs`, `Dtos.cs`, `Program.cs`) with a minimal `[TSExport]` surface designed for tests:
  - `Echo` — sync methods (`Greet(string) → string`, `Add(int, int) → int`, `BoolNot(bool) → bool`, `Pi() → double`).
  - `Counter` — `ctor(int initial)`, `Increment() → void`, `Value { get; }` — covers constructor + mutable state.
  - `AsyncOps` — `DelayThenEcho(string, int delayMs) → Task<string>` — covers Task marshalling.
  - `Throws` — `Boom() → void` (throws) — covers exception marshalling.
  - Trim `Program.cs` to a no-op entry point.
- Update every workspace reference to the old path:
  - `test/fixtures/library-build/vite.config.ts` → `projectRoot: '../library'`.
  - `LIBRARY_ROOT` constants in `packages/unplugin-dotnet-static-assets/src/core/vfs.test.ts`, `manifest-runtime.test.ts`, `discover.test.ts`, `unplugin/index.test.ts`.
  - `Directory.Build.props` / `Directory.Packages.props` if they reference the path.
  - `plan.md` examples and the M1.5 snippet's quoted paths.
- Regenerate the manifest (`dotnet build test/fixtures/library`) and re-baseline the manifest-snapshot fixture committed under the plugin's tests.

#### M1.6.b — Bundle build-time smoke assertions

A small vitest spec that drives `vite build` programmatically and asserts the bundle is shaped correctly. This is the cheap, no-browser-needed safety net that catches breakage before paying Playwright's startup cost.

- File: `test/integration/m1-vite-build.test.ts`.
- Programmatically invoke `vite build` (via `vite`'s Node API) against `test/fixtures/library-build`; assert:
  - no "Could not resolve" warnings from the build logger;
  - `dist/assets/dotnet.native-*.wasm` exists and its byte length matches the source at `bin/Debug/net10.0/wwwroot/_framework/dotnet.native.wasm`;
  - at least 20 distinct `.wasm` assets land in `dist/assets/` (Vite emits all binary assets to `assets/` with a content-hash suffix via `basename + emitFile`);
  - `dist/assets/Library-*.wasm` is present (proves user-assembly emission, not just runtime);
  - the entry chunk at `dist/assets/entry-*.js` contains at least one `*.wasm` reference (proves the `ROLLUP_FILE_URL_*` placeholder was resolved and inlined).

#### M1.6.c — Playwright interop suite

- New consumer fixture or extension of `test/fixtures/library-build`:
  - `wwwroot/test-entry.ts` — same `dotnet.create()` + `TypeShimInitializer.initialize()` + `runMain()` sequence as M1.5's `entry.ts`, then assigns the typeshim-generated exports onto `window.__lib` and sets `window.__libReady = true`.
  - `index.html` — already exists; ensure it loads `test-entry.ts` (or add a second `test.html` if we want `entry.ts` and `test-entry.ts` to coexist).
- New folder: `test/integration/browser/`:
  - `playwright.config.ts` — Chromium only, headless by default (headed locally via env), `baseURL` from `process.env.BUNDLE_URL`, `webServer` block that runs `pnpm --filter @repo/library-build-fixture build` and then a tiny static server (e.g. `sirv-cli` or `serve-handler`) on `dist/`.
  - `m1-interop.spec.ts` — Playwright `test()` cases that:
    - `await page.goto('/')`;
    - `await page.waitForFunction(() => (window as any).__libReady === true, { timeout: 15_000 })`;
    - assert via `page.evaluate(...)`:
      - `Echo.Greet('world')` returns `'Hello, world'`;
      - `Echo.Add(2, 3) === 5`;
      - `new Counter(10)` after two `Increment()` calls reports `Value === 12`;
      - `AsyncOps.DelayThenEcho('hi', 10)` resolves to `'hi'`;
      - (if included) `Throws.Boom()` rejects/throws with a message that survives marshalling.
- Dev dependencies (added to `test/integration/package.json`):
  - `@playwright/test`, `playwright`, `sirv-cli` (or `serve-handler` + `http`).
- New scripts:
  - root: `pnpm test:e2e` → runs the build smoke spec + the Playwright spec.
  - `test/integration`: `test:e2e` (vitest + playwright orchestrator), `e2e:install` → `npx playwright install chromium --with-deps`.

**Done when:**
- `pnpm --filter @repo/integration test:e2e` builds the fixture, serves it, launches headless Chromium, and runs all interop specs green on Windows and Linux CI runners.
- The Playwright suite catches a regression if the plugin emits a broken `_framework/*.wasm` URL, fails to wire up `typeshim.ts`, or doesn't ship the runtime manifest assets.

### M1 acceptance summary

- One bundler (Vite), one mode (Manifest), one fixture (under `test/fixtures/library/`), no dev-server integration.
- A reviewer can clone the repo, run `pnpm install && pnpm test` (and `pnpm test:e2e` once Playwright is installed locally), and see a real `dotnet`-built WASM project compile through Vite **and** boot in a real headless browser with `[TSExport]` calls round-tripping into .NET and back.

---

## M2 — Mode B (`dotnet publish`) + discovery hardening

**Outcome:** the same Vite consumer can be pointed at a consolidated publish output and build with `mode: 'consolidated'` (or auto-detected). Discovery handles multi-config layouts and produces useful errors.

### M2.1 — Generate a publish fixture

- `dotnet publish ./Library -c Release -o ./test/fixtures/library-publish` (committed as a fixture, regenerated occasionally; the runtime manifest is typically absent, the endpoints manifest typically present).
- Verify the layout matches what `Microsoft.NET.Sdk.WebAssembly` actually emits on publish (flat directory containing `_framework/`, `*.staticwebassets.endpoints.json`, possibly the app's HTML).

### M2.2 — Mode option + consolidated resolver path

- Add `mode: 'auto' | 'manifest' | 'consolidated'` and `publishDir?: string` to options. `publishDir` is the .NET-flavoured name for the consolidated assets directory (it is the same concept the spec previously called `assetsDir`; the rename matches what `dotnet publish -o` produces and is the obvious term for a .NET developer).
- New file: `src/core/resolver-consolidated.ts` exposing the same `resolve()`/`list()` shape as the VFS but backed by a single-directory `fs.statSync` probe with the same extension list.
- The unplugin layer dispatches once at `buildStart`; downstream hooks don't know which mode is active.

### M2.3 — Auto mode detection

- If `mode === 'auto'` (default): run `discoverRuntimeManifest`; on hit → Mode A. On miss, look for a `_framework/` directory under `publishDir ?? <projectRoot>/bin/<configuration>/<targetFramework>/publish/` (or the path the publish fixture justifies); on hit → Mode B.
- Hard-fail on ambiguity (both manifest AND a sibling flat `_framework/` present in different places).

### M2.4 — Discovery hardening (ranking, fallback defaults, staleness)

The option *surface* (`configuration`, `targetFramework`) was already exposed in M1.3, but M1 keeps the algorithm strict: unique-candidate-or-fail. M2.4 makes the algorithm intelligent when options are partial or absent:

- Implement the ranked search from `plan.md` §2.2: explicit-tightest-path → loose glob with axis ranking → mtime tiebreaker.
- Expand the `configuration` default-resolution chain: option ▸ `process.env.DOTNET_CONFIGURATION` ▸ Vite `config.mode === 'production' ? 'Release' : 'Debug'` ▸ `Debug` fallback.
- Staleness warning when the chosen manifest's mtime is older than a sibling under `bin/`.
- New synthetic fixtures (no real builds needed): `bin/Debug/net8.0/…/runtime.json`, `bin/Release/net8.0/…/runtime.json` (newer), multi-TFM (`net8.0 + net9.0`).

### M2.5 — E2E integration test for Mode B

- New consumer fixture `test/fixtures/library-publish-consumer` that points the plugin at the publish dir via `publishDir: '../library-publish'`.
- Same assertions as M1.6, plus: starting in Mode B, then deleting the publish dir, then re-running, fails with the expected error (not a stack trace).

### M2 acceptance summary

- Both `dotnet build` and `dotnet publish` outputs work.
- Discovery makes good choices in standard repos and complains clearly when it can't.
- Still: no endpoints.json behaviour, no dev server, no IDE emission, still Vite-only.

---

## M3 — Endpoints manifest (build-time only) + ergonomics polish

**Outcome:** the endpoints manifest is consumed where it materially affects the production build (SRI hashes propagated to emitted `<script>` / `<link>` tags). No dev-server work yet. Plus the small bits of polish that make a public release usable.

### M3.1 — Endpoints parser

- File: `src/core/manifest-endpoints.ts`. Zod schema for `Version`, `ManifestType`, `Endpoints[]` (`Route`, `AssetFile`, `Selectors`, `ResponseHeaders`, `EndpointProperties`).
- `buildEndpointsIndex`: `Map<route, Endpoint>` plus reverse index `Map<assetFile, Endpoint[]>` for fingerprinted variants.
- Auto-discover alongside the runtime manifest / assets dir; `endpointsPath?: string | false` option.

### M3.2 — SRI propagation in the production bundle

- Pull `EndpointProperties.integrity` for each asset that the plugin emits, store it on the asset's metadata.
- Vite-only path for now: hook `transformIndexHtml` to add `integrity` and `crossorigin` to emitted `<script>` / `<link>` tags when the URL maps to a known endpoint.
- Integration test: assert the produced `index.html` contains the expected `integrity="sha256-…"` attribute for `dotnet.js`.

### M3.3 — Configurable resolveExtensions + public API freeze

- Add `resolveExtensions?: string[]` option; default unchanged.
- Document the API surface (TS doc comments + a generated `api.md`); freeze it for `0.1.0`.

### M3.4 — Readme + sample consumer

- A short README with the M1 Mode A and M2 Mode B recipes (the spec already drafts these).
- Wire the npm workspaces fixture from `plan.md` §9.3 if it can be built in <50 LOC of glue.

### M3 acceptance summary

- Endpoints metadata participates in production output (SRI), but no runtime/dev coupling.
- API is stable enough to publish a `0.1.0`.

---

## ⏸ Checkpoint — decide before M4

After M3 we have a usable production-only plugin for Vite. Before we keep going, we pick from the open backlog. Possible next bites, **roughly in order of likely value**:

- **M4 — Dev server (Vite first)**: `configureServer` middleware that streams VFS files with the right `Content-Type` (`application/wasm` etc.), applies `ResponseHeaders` from endpoints.json verbatim (with stale-`Content-Length` recomputation), and handles fingerprinted route aliases.
- **M5 — Change detection / watch**: `addWatchFile` for every VFS asset, debounced manifest re-read on change, dev HMR invalidation when `dotnet build` rewrites the bin output.
- **M6 — Webpack adapter**: second bundler, requires `asset/resource` rule injection and chunk-splitting opt-out. Validates the unplugin abstraction.
- **M7 — IDE-parity emission**: the quiet `node_modules/.dotnet-vfs/` cache with `tsconfig.json` + `dotnet-vfs.d.ts`; Mode-flip cleanup; one-shot info-level `extends` hint.
- **M8 — Preload `<link>` injection**: emit preload tags from `EndpointProperties.Preload*` for the `webassembly` group, ordered by `PreloadOrder`.
- **M9 — Compression sibling pass-through** (`.br` / `.gz` next to each asset).
- **M10 — Boot-manifest rewrite** when the host bundler hashes `.wasm`/`.dll` outputs (`blazor.boot.json` / `mono-config.json`).
- **M11 — Rollup / esbuild / Rspack adapters**.
- **M12 — Playwright E2E**: headless-Chromium boot that proves the runtime actually executes a managed call.
- **M13 — IDE-parity language-service test**: automated TS server probe to prove cross-root Go-to-Definition.

Each of these is its own milestone-sized chunk. **Plan out M4/M5/M6 (or whichever combination we want) at that checkpoint** — we'll know more once M1–M3 are real code.

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
- After M3, we re-read `plan.md` and this file together, prune anything that didn't survive contact with reality, and pick the next milestone.
- Whenever a real-world quirk shows up that the spec didn't anticipate (very likely — see `OutputPath=./bin/` flat layout already), the discovery in M1.3 becomes the test case for M2.4's hardened version.
