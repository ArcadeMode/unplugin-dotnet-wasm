# Dev-server support plan

Bring `unplugin-dotnet-wasm` to bundler **dev servers**, starting with Vite and extending to the
other dev-server-capable bundlers. Each part below is a **functional, independently shippable,
minimally sized deliverable**.

## Context

The plugin is build-time only today. Investigation (the spikes + the Part 2 experiment) established
that "out-of-tree" is really **two distinct mechanisms with two distinct fixes**:

- **`vite dev` already boots the app when every .NET asset is in-tree** — the runtime's `locateFile`
  fallback requests assets relative to `dotnet.js`'s served URL, and Vite's `/@fs/` static handler
  serves them. No middleware needed for that happy path.
- **Runtime-fetched out-of-tree assets → the dev middleware.** The WASM runtime fetches
  `_framework/*.{wasm,dat,pdb}` (and any URL-referenced asset) at boot. When the output is
  out-of-tree (a shared lib built elsewhere, `UseArtifactsOutput`, or an out-of-tree
  `dotnetOutputDir`), Vite refuses the `/@fs/` path (`instantiate_wasm_module() failed … TypeError:
  Failed to fetch`). The serve-mode `load` hook + connect middleware own these routes.
- **Statically-imported out-of-tree modules → the shared resolver.** With
  `WasmBundlerFriendlyBootConfig`, the SDK bakes NuGet JS library initializers into `dotnet.js` as
  **static ES imports** written relative to `_framework/`, e.g.
  `import … from "./../_content/<pkg>/<pkg>.lib.module.js"`. These travel the **bundler module
  graph, not the middleware**. The importer-relative `./../` must collapse to the canonical manifest
  route `_content/<pkg>/…`; the resolver's clamp-normalisation does this. Once resolved, each bundler
  serves/bundles the module itself (Vite serves it, webpack/rspack/etc. bundle it) with **no
  middleware and no `server.fs.allow` involved**. One shared change fixes both `build` and `dev` for
  every bundler. (Managed assemblies consolidate into `bin/wwwroot/_framework`, so they stay in-tree
  regardless.)
- **The middleware is retained and is the portable foundation.** Even though the NuGet JS-initializer
  case turned out to be resolver-handled, the middleware is kept for **cross-bundler and NuGet
  out-of-tree compatibility**: (a) it is the portable way to serve runtime-fetched out-of-tree
  `_framework` binaries across every connect-based dev server (Vite, webpack-dev-server, rspack,
  rsbuild; Farm via a thin Koa adapter), and (b) NuGet packages can contribute out-of-tree files that
  are **fetched at runtime rather than statically imported** (non-JS `_content` assets,
  URL-referenced scripts), which only the middleware can serve. Its serving *core* — resolve route →
  read physical file via the VFS → stream with manifest headers — is a plain connect `(req,res,next)`
  handler. `server.fs.allow` was considered and rejected: Vite-only, re-solved per bundler.
- **No watch/HMR in this plan.** Restarting the dev server after a `dotnet build` that changes the
  asset set is an accepted limitation (README Planned #2 covers watch/HMR + live type-shim regen).

### Design (shared across all bundlers)

1. **Resolver clamp-normalisation.** `AssetResolver.resolve` normalises specifiers by collapsing
   `.`/`..` segments with root-clamping (`normalizeVirtualPath`) before lookup, so the
   bundler-friendly boot config's `./../_content/…` static imports map to their canonical manifest
   route. No guard needed: a lookup hit is definitionally ours; a miss returns `null` and the bundler
   resolves the specifier itself. Applies to build and dev, every bundler.
2. **Serve-mode `load` branch.** In dev, the binary `load` hook returns an explicit middleware route
   (`export default "/_framework/<hashedName>"`) instead of the build-only
   `import.meta.ROLLUP_FILE_URL_*` placeholder. This populates the runtime's `resolvedUrl` with an
   absolute route (independent of `scriptDirectory`), so the runtime fetches our middleware instead
   of falling back to `/@fs/`.
3. **`createAssetMiddleware(resolver, logger)`** — bundler-agnostic connect handler. Owns any route
   the resolver recognises **except** the dotnet runtime JS modules (`FRAMEWORK_JS_REGEX`), which
   pass through to the bundler for the `BundlerCompatRewriter` transform. Its primary job is
   out-of-tree `_framework/*.{wasm,dat,pdb}`; it also serves runtime-fetched `_content/**` files.
   (Statically-imported `_content` modules go through the resolver/module graph instead — see
   Context.) Streams from the true physical path with the endpoints manifest's
   `Content-Type`/`Cache-Control`/`ETag`/`Last-Modified`, and sets `Content-Length` from the real
   file size.
4. **Header pass-through is safe.** Fingerprinted routes carry `immutable`, correct even in dev
   because content changes change the hash → change the URL.

---

## Part 1 — Vite dev server + shared core — ✅ DONE

**Deliverable:** `vite dev` boots the .NET WASM app via the serve-mode `load` hook + middleware, and
out-of-tree statically-imported `_content` modules resolve via clamp-normalisation.

**Shipped**
- `src/core/path-utils.ts` — `normalizeVirtualPath()` (clamp-normalise `.`/`..`, Design §1).
- `src/core/asset-resolution/asset-resolver.ts` — `resolve()` uses `normalizeVirtualPath`; added
  `headersFor(route)` returning the endpoint's response headers.
- `src/core/asset-resolution/endpoint-lookup.ts` — `responseHeaders` on `EndpointMatch`, populated
  from `endpoint.ResponseHeaders`.
- `src/core/dev-server/asset-middleware.ts` **(new)** — `createAssetMiddleware(resolver, logger)`;
  ownership rule per Design §3; header pass-through; real-size `Content-Length`; 304 on matching
  `If-None-Match`; HEAD; `next()` on miss / on `FRAMEWORK_JS_REGEX`. (+ `asset-middleware.test.ts`
  incl. streamed body bytes.)
- `src/unplugin/index.ts` (Vite/Rollup-family): `isServe` via `configResolved`; middleware via
  `configureServer`; serve-mode binary `load` returns `/_framework/<basename>`.
- README: **Dev server** column, Vite ✅.

**Verified:** `pnpm build:plugin`, `pnpm test:unit`, plugin `typecheck`/`lint` green; manual in-tree
`vite dev` boot; out-of-tree `_content` initializer resolves+loads in `vite dev` (Part 2 experiment).

**Still open (deferred):** `config.base` prefixing (default `/` only); an automated e2e for the
out-of-tree `_framework` middleware path (trigger #1) — currently covered by unit tests + the manual
`C:\` spike.

---

## Part 2 — Out-of-tree NuGet asset regression fixture (BlazorApplicationInsights)

**What the experiment changed:** the NuGet `_content` JS asset is a **static import** baked into
`dotnet.js` (bundler-friendly boot), so it is handled by the **shared resolver clamp-normalisation**
— in build *and* dev, on *every* bundler — and never touches the middleware. So Part 2's automatable
deliverable is a **resolver regression guard**, and it runs for free in the existing browser matrix.
No dev-server e2e is needed to cover it.

**Deliverable:** an out-of-tree NuGet-sourced `_content` JS asset proven loaded across the browser
matrix (all bundlers), guarding the resolver clamp-normalisation.

**Package decided:** `BlazorApplicationInsights` 3.3.0 (verified). Ships one JS static web asset,
`_content/BlazorApplicationInsights/BlazorApplicationInsights.lib.module.js`, at the literal
nuget-cache content root
(`%USERPROFILE%\.nuget\packages\blazorapplicationinsights\3.3.0\staticwebassets\`), not copied
in-tree. It is a runtime JS library initializer the WASM runtime auto-imports during
`dotnet.create()`; the module sets `window.blazorApplicationInsights = {…}` on evaluation, giving a
clean positive signal. (Blazored.LocalStorage was rejected — ships no JS static web asset. A tiny
local RCL, ProjectReference or packed, also works and was verified, if a self-contained fixture is
ever preferred.)

**Changes**
- `Directory.Packages.props` — `<PackageVersion Include="BlazorApplicationInsights" Version="3.3.0" />`.
- `test/fixtures/Library/Library.csproj` — add `<PackageReference Include="BlazorApplicationInsights" />`
  (version via CPM), with a comment stating it exists to exercise an out-of-tree NuGet `_content` JS
  asset for the dev-server plan's resolver guard.
- Each `test/fixtures/browser/library-app-*/src/entry.ts` — after `dotnet.create()`, set
  `window.__contentAssetOk` from `typeof window.blazorApplicationInsights === 'object' &&
  window.blazorApplicationInsights !== null`, before `window.__libReady = true`.
- `test/integration/tests/runtime.spec.ts` — declare `__contentAssetOk` on the global; add a test
  asserting it is `true` (covered by the existing browser/build-mode `beforeAll` skips).
- **No dev-server dimension added to the test matrix yet.**

**Verify**
- `pnpm test:debug-fingerprint` and `pnpm test:debug-nofingerprint` green (clean → build plugin →
  build library → build fixtures → unit → integration → e2e) across all 9 bundlers.
- Regression: revert `normalizeVirtualPath` in `resolve()` → the `./../_content/…` import fails to
  resolve → fixture boot fails → the `__contentAssetOk` assertion fails across the matrix.
- Watch the integration tests (`build.test.ts`, `publish.test.ts`, `type-shims.test.ts`) for
  assumptions broken by the extra dependency (asset counts / emitted files); adjust if needed.

**Deferred (guards the *middleware*, which this fixture does not exercise):** a dev-server e2e
(launch `vite`/bundler dev instead of `sirv`) and an automated out-of-tree `_framework` guard
(trigger #1). Tracked as a later part.

---

## Part 3 — Webpack dev server

**Deliverable:** `webpack serve` boots the app (browser), out-of-tree assets served.

**Changes**
- `src/unplugin/index.ts` (webpack-family branch): reuse `createAssetMiddleware` unchanged; register
  via `webpack-dev-server` `devServer.setupMiddlewares` (prepend). Detect serve mode from the
  dev-server invocation. Apply the same serve-mode `load`/asset-URL handling as Vite adapted to the
  webpack `asset/resource` path (the runtime must fetch the middleware route in dev).
- Fixture `test/fixtures/browser/library-app-webpack`: add `dev` script + dev e2e (reuse Part 2
  fixture + assertions).
- README matrix: webpack dev ✅.

**Verify:** webpack dev e2e (in-tree boot + out-of-tree `_content` asset). Build path unchanged.

---

## Part 4 — Rspack dev server

**Deliverable:** `rspack serve` boots the app.

**Changes:** same as Part 3 via `@rspack/dev-server` (`setupMiddlewares`, shared API); reuse the
core. Fixture `library-app-rspack` `dev` script + dev e2e. README matrix: rspack dev ✅.

**Verify:** rspack dev e2e green.

---

## Part 5 — Rsbuild dev server

**Deliverable:** `rsbuild dev` boots the app.

**Changes:** register the core via Rsbuild's `dev.setupMiddlewares` (connect). Fixture
`library-app-rsbuild` `dev` script + dev e2e. README matrix: rsbuild dev ✅.

**Verify:** rsbuild dev e2e green.

---

## Part 6 — Farm dev server

**Deliverable:** `farm dev` boots the app.

**Changes:** add a thin Koa `(ctx, next)` adapter wrapping `createAssetMiddleware` (Farm's dev server
is Koa-based); register via Farm's dev-server hook (`configureDevServer` / `server.middleware`).
Fixture `library-app-farm` `dev` script + dev e2e. README matrix: farm dev ✅.

**Verify:** farm dev e2e green.

---

## Part 7 — Docs & matrix finalisation

**Deliverable:** documentation reflects dev-server support.

**Changes**
- `unplugin-dotnet-wasm/README.md`:
  - Finalise the **Dev server** column: Vite/Webpack/Rspack/Rsbuild/Farm ✅; Rollup/Rolldown
    footnoted "via Vite / no standalone dev server"; esbuild "no middleware API"; Bun "no integrated
    bundler dev server".
  - Add a short **Dev server** subsection under Usage (works out of the box; out-of-tree
    runtime-fetched assets handled by the middleware, statically-imported out-of-tree `_content`
    modules by the resolver).
  - Move dev-server middleware from **Planned #1** to **Done**; keep watch/HMR (#2) in Planned and
    note the restart-on-asset-set-change limitation.
- `docs/architecture.md`: brief note on **two out-of-tree mechanisms** — the dev-server middleware +
  serve-mode route for runtime-fetched assets, and the resolver clamp-normalisation for
  statically-imported `_content` modules (distinct paths; the middleware does *not* serve the NuGet
  JS-initializer case).

**Verify:** links/anchors resolve; matrix matches the shipped fixtures.

---

## Support matrix (target)

| Bundler | Browser | Node | Dev server |
|---|---|---|---|
| Vite | ✅ | ✅ | ✅ |
| Rollup | ✅ | ✅ | — (use Vite) |
| Rolldown | ✅ | ✅ | — (use Vite) |
| Webpack | ✅ | ❌ | ✅ |
| Rspack | ✅ | ❌ | ✅ |
| Rsbuild | ✅ | ❌ | ✅ |
| esbuild | ✅ | ⚠️ | ❌ (no middleware API) |
| Farm | ✅ | ❌ | ✅ |
| Bun | ✅ | ❌ | ❌ (no bundler dev server) |

## Files touched (recurring)
- `unplugin-dotnet-wasm/src/core/path-utils.ts` (`normalizeVirtualPath`)
- `unplugin-dotnet-wasm/src/core/asset-resolution/{endpoint-lookup,asset-resolver}.ts`
- `unplugin-dotnet-wasm/src/core/dev-server/asset-middleware.ts` (new, + test)
- `unplugin-dotnet-wasm/src/unplugin/index.ts` (per-bundler dev registration)
- `Directory.Packages.props`, `test/fixtures/Library/Library.csproj` (NuGet dep, Part 2)
- `test/fixtures/browser/library-app-<bundler>/src/entry.ts` (`__contentAssetOk` assertion; later: `dev` script)
- `test/integration/tests/runtime.spec.ts` (Part 2 assertion); `test/integration/` (later: dev Playwright config + matrix dev variant)
- `unplugin-dotnet-wasm/README.md`, `docs/architecture.md`

## Limitations & follow-ups
- No watch/HMR (README #2) — restart after a `dotnet build` that changes the asset set.
- esbuild/bun/standalone rollup/rolldown have no dev-server injection point — out of scope.
- Node dev targets follow the existing browser/Node support constraints (unchanged here).
