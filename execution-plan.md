# Execution Plan: `unplugin-dotnet-static-assets`

Companion to `plan.md`. The spec describes the full target system; this file is the **build order**. Each milestone is small enough to ship and verify on its own. We stop at M2 and decide whether to continue, change scope, or rip something out.

## Anchor fixture

`./Library/` — `Microsoft.NET.Sdk.WebAssembly` project (`net10.0`) using **default SDK conventions**:

- Standard output layout: `Library/bin/<Configuration>/<TargetFramework>/` (so after `dotnet build` the manifests land at `Library/bin/Debug/net10.0/Library.staticwebassets.runtime.json` and `….staticwebassets.endpoints.json`). The plugin must handle this canonical path on day one.
- `WasmBundlerFriendlyBootConfig=true` → `_framework/dotnet.js` emits native `import dotnet_native_wasm from "./dotnet.native.wasm"` etc. This is the bundler-friendly path the plugin exists to support.
- `WasmFingerprintAssets=false` and `CompressionEnabled=false` → no `.br/.gz` siblings, no hashed filenames in this fixture. Both of those are deferred features.
- Two content roots: `Library/wwwroot/` (source) and `Library/bin/Debug/net10.0/wwwroot/` (build output). They overlap on `main.ts`, `wasm-bootstrap.ts`, `TypeShimProvider.tsx`; `typeshim.ts` and the whole `_framework/` runtime exist only in the bin root. **Cross-root resolution is required from the first commit.**
- `Patterns: [{ ContentRootIndex: 0, Pattern: "**", Depth: 0 }]` → glob fall-through to source root for files not enumerated.

End-to-end success for M1 means: a Vite project imports `./Library/wwwroot/main.ts`, `vite build` succeeds, and `dist/_framework/dotnet.native.wasm` (and every other assembly the runtime asks for) is present with correct bytes.

---

## M1 — Vite + scattered build output only

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
- `discoverManifests(opts): { runtimeManifestPath, endpointsManifestPath }`.
- **Explicit options exposed from M1** (mirrors `plan.md` §8):
  - `projectRoot: string` — required for M1; the .NET project directory (the one containing the `.csproj`).
  - `configuration?: string` — default `'Debug'`. Callers wire bundler-mode-based switching themselves (e.g. Vite's `defineConfig(({ mode }) => ({ ... configuration: mode === 'production' ? 'Release' : 'Debug' }))`).
  - `targetFramework?: string` — if omitted, the discovery globs `<projectRoot>/bin/<configuration>/*/` and requires exactly one TFM directory; else hard-fail with the enumerated candidates.
  - `dotnetOutputDir?: string` — if set, the other discovery axes are forbidden (enforced by the discriminated union in `DotnetAssetsOptions`). The directory must contain the endpoints manifest; the runtime manifest sibling may or may not exist (it won't, for a publish output).
- Algorithm for M1:
  1. If `dotnetOutputDir` is set, take it verbatim.
  2. Otherwise construct `<projectRoot>/bin/<configuration>/<targetFramework>` from supplied/defaulted options, filling each unset axis with the unique-directory rule above. Glob `*.staticwebassets.runtime.json` inside it.
  3. On zero hits, throw with a clear message naming the directory searched and the resolved axes.
  4. On multiple hits in the *same* directory (unlikely but possible), throw with the candidate list.

**Done when:** unit tests prove:
- Default options (`{ projectRoot: 'Library' }`) resolve to `Library/bin/Debug/net10.0/Library.staticwebassets.runtime.json` against the fixture.
- Explicit `{ configuration: 'Debug', targetFramework: 'net10.0' }` resolves identically.
- A synthetic fixture with two TFMs under `bin/Debug/` fails with a message enumerating them and hinting at the `targetFramework` option.
- A missing manifest fails with a message naming the searched directory.

### M1.4 — VFS builder + lookup

- Files: `src/core/vfs.ts`, `src/core/extension-probe-order.ts`, `src/core/logger.ts`.
- `buildVfs(manifest, opts?: { logger? }): VirtualFileSystem` returning:
  ```ts
  {
    list(virtualDir: string): string[];                 // virtual dir listing
    resolve(virtualPath: string): ResolvedAsset | undefined;  // with extension/index probing
    resolveFile(assetFile: string): ResolvedFile | undefined; // cross-root FS probe, no probing
  }
  ```
  where `ResolvedAsset = { virtualPath: string; physicalPath: string }` and `ResolvedFile = { physicalPath: string }`.
- **The VFS contains only what the manifest declares to be virtual.** Every explicit `Asset` node is ingested into an internal `lookup` map at construction time. Files that exist on disk but are not enumerated and do not fall under a matching `Patterns` entry are *not* part of the VFS — callers treat a `resolve()` miss as a signal to delegate to the host bundler's native resolver.
- POSIX normalisation internally, case-insensitive lookup key (lowercase), case-preserving `physicalPath`.
- Extension probe order lives in `src/core/extension-probe-order.ts`; imported by both `vfs.ts` and `unplugin/index.ts`.
- `.ts` shadows `.d.ts` rule: when both are enumerated, a `debug`-level warning is emitted through the injected `Logger` at construction time. The VFS does not expose a `shadowedPairs` set — logging is the only consumer.
- Pattern fallthrough: when the map lookup + probes miss, evaluate each `Patterns` entry against the remaining virtual path; for each match, do **one `statSync`** against `join(ContentRoots[i], candidate)` (literal + per probe extension + `index.<ext>`). Hits are cached back into the internal map. **No directory enumeration anywhere** — the plugin never lists a directory; it only reads files the manifest names or the patterns point at.
- `resolveFile(assetFile)` walks `ContentRoots` in declaration order, returns the first hit as `{ physicalPath }`, or `undefined`. Used for the §3.2 step-6 endpoint-aliased FS fallback in the plugin factory.

### M1.4b — Shared infrastructure

- **`src/core/extension-probe-order.ts`**: single `EXTENSION_PROBE_ORDER` constant. Consumed by `vfs.ts` and `unplugin/index.ts`.
- **`src/core/logger.ts`**: `Logger` interface (`error / warn / info / debug`) + `createConsoleLogger(level, prefix)` factory + `NULL_LOGGER` no-op constant. All future diagnostic output routes through a `Logger`; no module outside `logger.ts` calls `console.*` directly (lint rule deferred).
  - `createConsoleLogger` applies level gating internally — call sites write `logger.debug("…")` unconditionally.
  - `NULL_LOGGER` keeps unit tests quiet without per-test mock setup.
  - If/when Rollup/Vite plugin-context logging is wired up (post-0.1.0), implement a `viteLoggerAdapter(ctx): Logger`; the rest of the codebase is unchanged.

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
  - `buildStart`: run discovery + VFS construction; throw if it fails. Construct `logger = createConsoleLogger(options.logLevel ?? 'warn')` once; pass as `{ logger }` to `buildVfs` / `buildEmptyVfs`. Shadowed-pair warnings are emitted inside VFS construction.
  - `resolveId(source, _importer)`:
    1. Treat `source` as a virtual path verbatim (strip a leading `./` or `/`, POSIX-normalise). The importer is intentionally not consulted — the VFS is an importer-blind overlay; relative-path semantics belong to the host bundler.
    2. Call `vfs.resolve(source)`; on hit, return the absolute physical path.
    3. On miss, return `null` so the host resolver carries on. The bundler will resolve relative imports against the importer's physical directory; that is the correct behaviour for non-virtual files, sibling build-output files, and consuming-project imports alike.
  - `load(id)`: only handles binary extensions (`.wasm`, `.dat`, `.pdb`). For those, read bytes and return via Vite's standard asset API (`this.emitFile({ type: 'asset' })` then `export default __VITE_ASSET__<hash>`). Text files (`.ts`, `.tsx`, `.js`, `.json`) flow through unchanged so Vite's own transformers handle them.
- Options exposed in M1 (all forwarded to `discoverRuntimeManifest`; defaults documented in M1.3):
  - `projectRoot: string` — required for now; we don't auto-walk above the consumer yet.
  - `configuration?: string` — explicit override; default `'Debug'`.
  - `targetFramework?: string` — explicit override; auto-detected when exactly one TFM directory exists.
  - `dotnetOutputDir?: string` — absolute-or-relative bypass; when set, the discovery skips path construction entirely.
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

### M1.7 — Fingerprint-aware resolution via the endpoints manifest

The M1.5 fixture forces `WasmFingerprintAssets=false` so the SDK-emitted `dotnet.js` imports canonical names (`./dotnet.native.wasm`) and the runtime-manifest VFS can resolve them directly. That is not the realistic .NET production layout: in real builds `WasmFingerprintAssets` defaults to true, the SDK-emitted runtime JS uses fingerprinted imports (`./dotnet.native.veuqw8a0w9.wasm`), and the on-disk physical filenames embed those fingerprints. M1.7 makes the plugin work for that layout by consulting the sibling **endpoints manifest** (`{ProjectName}.staticwebassets.endpoints.json`) **before** the VFS to translate canonical routes into their fingerprinted asset files.

The same endpoint lookup will later drive dev-server static handling (response headers, preload hints — already described in `plan.md` §4.2), so M1.7 also establishes the parsing and lookup infrastructure that the future dev-server work will reuse.

#### Endpoints manifest schema (verified against the M1.6 fixture, 432 endpoints)

```jsonc
{
  "Version": 1,                            // currently 1
  "ManifestType": "Build",                 // "Build" | "Publish"
  "Endpoints": [
    {
      "Route":      "_framework/Library.wasm",            // public-facing virtual path
      "AssetFile":  "_framework/Library.9mhy6srgqs.wasm", // physical file, relative to a content root
      "Selectors": [
        // Empty in the M1.6 fixture (CompressionEnabled=false). With compression on, a sibling
        // endpoint exists with the same Route + a {Name:"Content-Encoding", Value:"gzip", Quality:"…"}
        // entry pointing at the .gz/.br variant.
      ],
      "ResponseHeaders": [
        // Observed Name values: Cache-Control, Content-Length, Content-Type, ETag, Last-Modified.
        { "Name": "Cache-Control",  "Value": "no-cache" },
        { "Name": "Content-Length", "Value": "17173" },
        { "Name": "Content-Type",   "Value": "application/wasm" },
        { "Name": "ETag",           "Value": "\"…\"" },
        { "Name": "Last-Modified",  "Value": "…" }
      ],
      "EndpointProperties": [
        // Observed Name values: fingerprint, label,
        // PreloadAs, PreloadCrossorigin, PreloadGroup, PreloadOrder, PreloadPriority, PreloadRel.
        { "Name": "fingerprint",        "Value": "9mhy6srgqs" }, // present on fingerprinted-route rows
        { "Name": "label",              "Value": "_framework/Library.wasm" } // canonical alias
      ]
    }
  ]
}
```

**Properties M1.7 actually consumes:** `Version`, `ManifestType`, `Endpoints[].Route`, `Endpoints[].AssetFile`, `Endpoints[].Selectors` (only to filter compressed variants), `EndpointProperties` entries whose `Name` is `fingerprint`/`label` (informational). All other headers and preload properties are parsed and preserved but not consumed until the dev-server milestone.

**Lookup-map shape:**

```ts
interface EndpointMatch {
  /** Asset path relative to a content root, POSIX, no leading slash. */
  readonly assetFile: string;
  /** Fingerprint segment when present in EndpointProperties. */
  readonly fingerprint?: string;
  /** "label" property when present (the canonical route name for a fingerprinted row). */
  readonly label?: string;
}

type EndpointLookup = ReadonlyMap<string /* route, POSIX, no leading slash */, EndpointMatch>;
```

Compressed variants (any endpoint whose `Selectors` contain a `Content-Encoding` entry) are **filtered out** of the lookup; M1.7 wants the identity row only.

#### M1.7.a — Build/test orchestration in root `package.json`

Up to M1.6 we relied on muscle memory: `dotnet build`, then `pnpm --filter unplugin-dotnet-static-assets build`, then the fixture build, then tests, in a specific order. M1.7 makes the fingerprint setting a real parameter of the build — and the only honest way to validate "the plugin works for both fingerprint states" is to actually run the full chain twice with each setting. That needs scripted, parameterised orchestration in the root `package.json`.

Add these root scripts (existing `build`, `typecheck`, `lint`, `clean` stay):

```jsonc
{
  "scripts": {
    "build:plugin":                "pnpm --filter unplugin-dotnet-static-assets build",
    "build:library":               "dotnet build test/fixtures/Library/Library.csproj -c Debug",
    "build:library:fingerprint":   "dotnet build test/fixtures/Library/Library.csproj -c Debug -p:WasmFingerprintAssets=true",
    "build:library:nofingerprint": "dotnet build test/fixtures/Library/Library.csproj -c Debug -p:WasmFingerprintAssets=false",
    "build:fixture":               "pnpm --filter @dotnet-wasm-bundler/library-build-fixture build",
    "test:unit":                   "pnpm --filter unplugin-dotnet-static-assets test",
    "test:integration":            "pnpm --filter @dotnet-wasm-bundler/integration-tests test",
    "test:e2e":                    "pnpm --filter @dotnet-wasm-bundler/integration-tests test:e2e",

    "test:fingerprint-enabled":    "pnpm build:plugin && pnpm build:library:fingerprint   && pnpm build:fixture && pnpm test:unit && pnpm test:integration && pnpm test:e2e",
    "test:fingerprint-disabled":   "pnpm build:plugin && pnpm build:library:nofingerprint && pnpm build:fixture && pnpm test:unit && pnpm test:integration && pnpm test:e2e",

    "test": "pnpm test:fingerprint-enabled && pnpm test:fingerprint-disabled"
  }
}
```

Design notes:

- **csproj stays neutral.** `test/fixtures/Library/Library.csproj` does **not** pin `WasmFingerprintAssets`; the orchestrator's `-p:` argument is the sole source of truth. (The currently-commented-out `<WasmFingerprintAssets>false</WasmFingerprintAssets>` line gets removed entirely.)
- **`&&` chaining is safe across OSes.** pnpm runs scripts through `cmd /d /s /c` on Windows and `/bin/sh` elsewhere; `&&` is supported in both, so we don't need `npm-run-all` or `cross-env`.
- **Order matters.** The plugin's `dist/` must exist before the fixture's `vite build` resolves `unplugin-dotnet-static-assets/vite`; the .NET output must exist before the plugin's manifest discovery runs at vite-build time. The chain enforces both.
- **Plugin unit tests run after the .NET build** so they read the fingerprinted manifests the orchestrated build just produced. This means the plugin's own test suite is now exercised twice (once per fingerprint state) — the catch for any regression that only shows up in one mode.
- **The unparameterised `test` script chains both fingerprint states.** That is the script CI runs; manual development uses the targeted ones.

Tests added separately in this sub-milestone:
- A short README or block in `plan.md` §10 (or wherever the dev workflow is documented) reproducing the script table so a fresh contributor doesn't have to dig through `package.json`.
- One sanity assertion in CI: each `test:fingerprint-*` script exits 0 in isolation — i.e. CI runs them as separate jobs rather than only the combined `test`, so a failure in either state is reported distinctly.

**Done when:** running `pnpm test:fingerprint-disabled` from a clean checkout reproduces the M1.6 green state, and `pnpm test:fingerprint-enabled` (intentionally) fails — the latter failure is exactly what M1.7.b–g exist to fix.

#### M1.7.b — Verify the fingerprinted-build failure mode

Confirmed findings from running `pnpm build:library:fingerprint && pnpm build:fixture`:

**Vite build error:** `Could not resolve "./_framework/dotnet" from "src/entry.ts"`. The error is at Rollup's module resolution stage — the plugin's `resolveId` hook returns `null` and no other resolver can supply the file.

**Why:** The runtime manifest now **only enumerates fingerprinted names**. Under `WasmFingerprintAssets=true`, the `_framework` tree in the runtime manifest contains `dotnet.i5jyixs8xo.js`, `dotnet.native.veuqw8a0w9.wasm`, `Library.9mhy6srgqs.wasm`, etc. — the canonical names (`dotnet.js`, `dotnet.native.wasm`, `Library.wasm`) are entirely absent from the manifest tree. So the VFS flat map has no entry for `_framework/dotnet.js`, and the extension probe in `vfs.resolve('_framework/dotnet')` misses on every extension.

**The FS fallback gap:** The endpoint manifest maps `_framework/dotnet.js` → `_framework/dotnet.i5jyixs8xo.js`, but the current plugin doesn't consult it.

**Algorithm correction (vs. plan §3.2 as originally written):** The endpoint alias was originally planned as step 2 (applied to the exact normalised key, before the VFS). That covers imports that already carry an extension (e.g. `_framework/Library.wasm`). However, bare specifiers like `_framework/dotnet` need the alias applied *during* extension probing — after appending `.js`, the now-qualified `_framework/dotnet.js` matches an endpoint route. Step 4 of the algorithm (§3.2 in `plan.md`) has been updated accordingly.

#### M1.7.c — Endpoints manifest parser

- File: `packages/unplugin-dotnet-static-assets/src/core/manifest-endpoints.ts`.
- Zod schema covering the full known shape above. Strict on top-level keys (`Version`, `ManifestType`, `Endpoints`); lenient on `EndpointProperty.Name`, `ResponseHeader.Name`, and `Selector` entries (any `{Name, Value, ...}` accepted with a permissive catch-all).
- Public surface mirrors the runtime parser: `parseEndpointsManifest(raw: string | Buffer): EndpointsManifest`, plus a `ManifestParseError` re-export.
- Tests in `manifest-endpoints.test.ts` against the real fixture:
  - parses without throwing;
  - has at least one endpoint with `Route === '_framework/Library.wasm'` and an `AssetFile` matching `/Library\.[a-z0-9]+\.wasm$/`;
  - confirms presence of `fingerprint`, `label` EndpointProperty names across the fixture;
  - rejects malformed input (missing `Endpoints`, wrong type) with `ManifestParseError`.

#### M1.7.d — Endpoint lookup transform

- File: `src/core/endpoint-lookup.ts`.
- Function `buildEndpointLookup(manifest: EndpointsManifest): EndpointLookup`.
- Rules:
  1. Strip leading `/` from `Route` and `AssetFile`, POSIX-normalise both.
  2. Skip endpoints whose `Selectors` contain any entry with `Name === 'Content-Encoding'` (compressed variants).
  3. For the surviving rows, build a `Map<route, EndpointMatch>`. If two surviving endpoints share the same `Route`, throw `EndpointLookupError` — the SDK should not emit that, and being loud now beats silent confusion later.
- Tests covering: route normalisation, compressed-selector filtering, duplicate-route throw, presence/absence of `fingerprint`/`label` properties round-tripped through the lookup.

#### M1.7.e — Discovery extension

- `src/core/discover.ts`: add `discoverEndpointsManifest({projectRoot, configuration?, targetFramework?, dotnetOutputDir?})` returning `{ endpointsManifestPath, projectName, resolvedConfiguration, resolvedTargetFramework } | null`. The file naming convention is `{ProjectName}.staticwebassets.endpoints.json`, sibling to the runtime manifest.
- The result is **optional**: if the file is absent (older SDK / unusual layout) return `null`, do not throw. The runtime manifest remains required.
- The `projectName` axis is already resolved by the runtime-manifest discovery; reuse it to keep both discoveries in lock-step (same configuration, same TFM, same project — no fan-out of independent unique-candidate searches).
- Tests:
  - real fixture finds the endpoints sibling;
  - synthetic temp tree where only the runtime manifest exists → `discoverEndpointsManifest` returns `null` and the plugin still works (covered downstream in M1.7.e tests).

#### M1.7.f — Wire into the unplugin

- `src/unplugin/index.ts`:
  - `buildStart`: after building the VFS, also call `discoverEndpointsManifest` + `parseEndpointsManifest` + `buildEndpointLookup` (skip silently if discovery returned `null`). Store the lookup on the same plugin state as `vfs`.
  - `resolveId(source)`:
    1. Strip leading `./` or `/`; POSIX-normalise → `virtualPath`. *(unchanged)*
    2. **Endpoint alias (exact path):** if `endpoints.get(virtualPath)` returns a match, resolve `match.assetFile` through the VFS (or FS fallback). *(handles extension-qualified imports like `_framework/Library.wasm`)*
    3. `vfs.resolve(virtualPath)` → physical path on hit for exact-path VFS entries.
    4. **Bare specifier extension loop:** for each extension in `RESOLVE_EXTENSIONS` (`['.ts', '.tsx', '.js', ...]`), try `virtualPath + ext` against (a) the VFS flat map and (b) the endpoint lookup. On endpoint hit, resolve `assetFile` through VFS, then FS fallback. *(this is the load-bearing case: `_framework/dotnet` → probe `_framework/dotnet.js` → endpoint hit → `_framework/dotnet.i5jyixs8xo.js` → VFS hit)*
    5. Pattern fallthrough (via `vfs.resolve`) for patterns not covered above.
    6. Otherwise return `null`. *(unchanged)*
  - `load(id)`: unchanged — keys off the absolute physical id's extension.
- Tests in `unplugin/index.test.ts`:
  - `./_framework/Library.wasm` resolves through the endpoint lookup to a `Library.<fp>.wasm` physical path.
  - `./_framework/dotnet` (extension-less, importer-blind) still resolves via VFS ext-probing — the endpoint lookup misses on the bare specifier and that's fine.
  - An endpoint route whose AssetFile lives outside the VFS-enumerated tree resolves via the FS fallback (synthetic case).

#### M1.7.g — Test rebaselining
- `unplugin/index.test.ts` — add the endpoint-lookup cases enumerated in M1.7.f.
- `m1-vite-build.test.ts` — assertions stay structurally the same; the byte-length check now matches the fingerprinted source file (compute the expected name from the endpoint lookup or use a glob).
- `m1-interop.spec.ts` — no change expected; verify in CI.

#### M1.7.h — Plan / spec edits

- `execution-plan.md` (this file): the M1.7 section above + an update to the M1 acceptance summary mentioning fingerprint-aware resolution.
- `plan.md` §3.2 (Resolution algorithm) — splice an "endpoint alias" step before the flat-map lookup so the documented algorithm matches what the plugin does after M1.7.
- `plan.md` §4.2 — note that the route↔asset-file alias is consumed by the resolver as of M1.7 (not only by the future dev middleware).

**Done when:**

- `test/fixtures/Library/Library.csproj` no longer pins `WasmFingerprintAssets` (the commented-out line is removed).
- `pnpm test:fingerprint-disabled` AND `pnpm test:fingerprint-enabled` both go green — the same plugin source resolves both fixtures correctly.
- A reviewer can grep the M1 entry imports (`./_framework/dotnet`, `./_framework/Library.wasm`, `./typeshim`) and confirm each one resolves to the actual fingerprinted file on disk under the fingerprint-enabled run, with no canonical-name physical file required.

### M1 acceptance summary

- One bundler (Vite), one mode (Manifest), one fixture (under `test/fixtures/Library/`), no dev-server integration.
- Fingerprint-aware resolution via the endpoints manifest is implemented (M1.7): consumer imports use canonical names (`_framework/dotnet`, `_framework/Library.wasm`) while the plugin transparently resolves them to fingerprinted physical files on disk.
- The endpoints manifest is parsed end-to-end (Zod schema covering `Version`, `ManifestType`, `Endpoints[].Route / AssetFile / Selectors / ResponseHeaders / EndpointProperties`) and reduced to a typed `EndpointLookup` keyed by route, with `assetFile` (plus `fingerprint`/`label` when present) carried through. Compressed variants are filtered out. The lookup is consumed by the resolver today; the same parsing + index is what any future dev-server / preload work will build on without re-parsing.
- A reviewer can clone the repo, run `pnpm install && pnpm test` (and `pnpm test:e2e` once Playwright is installed locally), and see a real `dotnet`-built WASM project — with default fingerprinting on — compile through Vite **and** boot in a real headless browser with `[TSExport]` calls round-tripping into .NET and back.

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

- **M3 — Dev server (Vite first)**: `configureServer` middleware that streams VFS files with the right `Content-Type` (`application/wasm` etc.), applies `ResponseHeaders` from endpoints.json verbatim (with stale-`Content-Length` recomputation), and handles fingerprinted route aliases.
- **M4 — Change detection / watch**: `addWatchFile` for every VFS asset, debounced manifest re-read on change, dev HMR invalidation when `dotnet build` rewrites the bin output.
- **M5 — Webpack adapter**: second bundler, requires `asset/resource` rule injection and chunk-splitting opt-out. Validates the unplugin abstraction.
- **M6 — IDE-parity emission**: the quiet `node_modules/.dotnet-vfs/` cache with `tsconfig.json` + `dotnet-vfs.d.ts`; layout-flip cleanup; one-shot info-level `extends` hint.
- **M7 — Preload `<link>` injection**: emit preload tags from `EndpointProperties.Preload*` for the `webassembly` group, ordered by `PreloadOrder`, via `transformIndexHtml`. Endpoint lookup already carries everything needed.
- **M8 — Rollup / esbuild / Rspack adapters**.
- **M9 — Playwright E2E**: headless-Chromium boot that proves the runtime actually executes a managed call.
- **M10 — IDE-parity language-service test**: automated TS server probe to prove cross-root Go-to-Definition.

Each of these is its own milestone-sized chunk. **Plan out M3/M4/M5 (or whichever combination we want) at that checkpoint** — we'll know more once M1 and M2 are real code in someone's hands.

---

## What we are deliberately *not* doing in M1–M2

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
