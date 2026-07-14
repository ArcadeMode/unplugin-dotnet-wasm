# Dev-server support plan

Bring `unplugin-dotnet-wasm` to bundler **dev servers**, starting with Vite and extending to the
other dev-server-capable bundlers. Each part below is a **functional, independently shippable,
minimally sized deliverable**.

## Context

The plugin is build-time only today. Investigation (see the spikes summarised below) established:

- **`vite dev` already boots the app when every .NET asset is in-tree** — the runtime's `locateFile`
  fallback requests assets relative to `dotnet.js`'s served URL, and Vite's `/@fs/` static handler
  serves them. No middleware needed for that happy path.
- **It breaks when any asset resolves outside the Vite workspace root.** Proven end-to-end: pointing
  the plugin at an output on `C:\` (outside the repo) makes every download fail
  (`instantiate_wasm_module() failed … TypeError: Failed to fetch`) because Vite refuses `/@fs/`
  paths outside `server.fs.allow`. Two real triggers:
  1. **Out-of-tree output** — a shared .NET lib built in a separate repo, or `UseArtifactsOutput`
     pointing outside the JS project.
  2. **NuGet-contributed static web assets** — in `dotnet build` mode, an RCL's `_content/<pkg>/*`
     assets are **not** copied into `bin/wwwroot`; their content root points into
     `%USERPROFILE%\.nuget\packages\…`, always out-of-tree. (Managed assemblies, by contrast,
     consolidate into `bin/wwwroot/_framework`, so those stay in-tree.)
- **A dev-server middleware is the fix and the portable foundation.** unplugin has no dev-server
  abstraction, but the serving *core* — resolve route → read physical file via the VFS → stream with
  manifest headers — is a plain connect `(req,res,next)` handler reusable across every connect-based
  dev server (Vite, webpack-dev-server, rspack, rsbuild); Farm needs a thin Koa adapter. Vite's
  `server.fs.allow` was considered and rejected: it's Vite-only and would have to be re-solved per
  bundler anyway.
- **No watch/HMR in this plan.** Restarting the dev server after a `dotnet build` that changes the
  asset set is an accepted limitation (README Planned #2 covers watch/HMR + live type-shim regen).

### Design (shared across all bundlers)

1. **Serve-mode `load` branch.** In dev, the binary `load` hook returns an explicit middleware route
   (`export default "/_framework/<hashedName>"`) instead of the build-only
   `import.meta.ROLLUP_FILE_URL_*` placeholder. This populates the runtime's `resolvedUrl` with an
   absolute route (independent of `scriptDirectory`), so the runtime fetches our middleware instead
   of falling back to `/@fs/`.
2. **`createAssetMiddleware(resolver, logger)`** — bundler-agnostic connect handler. Owns any route
   the resolver recognises **except** the dotnet runtime JS modules (`FRAMEWORK_JS_REGEX`), which
   must pass through to the bundler for the `BundlerCompatRewriter` transform. So it serves
   `_framework/*.{wasm,dat,pdb}` **and** `_content/**` (the NuGet case), streaming from the true
   physical path with the endpoints manifest's `Content-Type`/`Cache-Control`/`ETag`/`Last-Modified`.
3. **Header pass-through is safe.** Fingerprinted routes carry `immutable`, which is correct even in
   dev because content changes change the hash → change the URL. The runtime requests the
   fingerprinted routes, so stale caching is a non-issue.

Essential code shapes for (1)+(2) live in the conversation that produced this plan; reproduce them
during Part 1.

---

## Part 1 — Vite dev server (+ shared core)

**Deliverable:** `vite dev` boots the .NET WASM app, including out-of-tree assets, via a middleware.

**Changes**
- `src/core/asset-resolution/endpoint-lookup.ts` — add `responseHeaders: readonly ResponseHeader[]`
  to `EndpointMatch`; populate from `endpoint.ResponseHeaders` in `extractMatch`. (+ test update)
- `src/core/asset-resolution/asset-resolver.ts` — add `headersFor(route)` returning the endpoint's
  response headers.
- `src/core/dev-server/asset-middleware.ts` **(new)** — `createAssetMiddleware(resolver, logger)`;
  connect `(req,res,next)`; ownership rule per Design §2; 304 on matching `If-None-Match`; HEAD
  support; `next()` on miss / on `FRAMEWORK_JS_REGEX`. (+ `asset-middleware.test.ts`: header
  pass-through, body bytes, 304, `_framework/dotnet.js` → `next()`, unknown → `next()`.)
- `src/unplugin/index.ts` (Vite/Rollup-family branch):
  - Outer closure: `let isServe = false`.
  - `vite.configResolved(config)` — also set `isServe = config.command === 'serve'`.
  - `vite.configureServer(server)` — `server.middlewares.use(...)` delegating to
    `createAssetMiddleware(assetResolver, logger)` (guard until `assetResolver` is built in
    `buildStart`, which runs before requests are served). Prefix routes with `config.base` when not
    `/`.
  - Binary `load` handler — `if (isServe) return 'export default ' + JSON.stringify('/_framework/' +
    basename(id))`; else the existing `emitFile`/`ROLLUP_FILE_URL` path.
- README: add a **Dev server** column to the support matrix (Part 7 finalises); mark Vite ✅.

**Verify**
- `pnpm build:plugin && pnpm test:unit` green (incl. new tests).
- Manual boot (in-tree): `cd test/fixtures/browser/library-app-vite && npx vite`, browser →
  `window.__libReady === true`, methods return correct values.
- Manual acceptance (out-of-tree): re-run the `C:\` spike (copy the `_framework` output outside the
  repo, point a throwaway config's `dotnetOutputDir` at it) → app now boots. Delete artifacts.
- `pnpm typecheck && pnpm lint`.

---

## Part 2 — Out-of-tree regression fixture (NuGet static web asset) + Vite dev e2e

**Deliverable:** an automated Vite dev e2e proving an out-of-tree, NuGet-sourced asset is served —
the regression guard reused by every later bundler part.

**Open decision (make it in this step): which NuGet package.**
Criteria: an RCL (or package) that ships at least one **JS static web asset** under `wwwroot`; builds
cleanly under the `Microsoft.NET.Sdk.WebAssembly` (`net10.0`) browser SDK; minimal transitive
footprint; and — confirm by inspecting the built `Library.staticwebassets.runtime.json` — its
`_content/<pkg>/*.js` asset gets a **content root in the NuGet cache** (not copied into
`bin/wwwroot`) under plain `dotnet build`.
Candidates to evaluate (pick one):
- **Blazored.LocalStorage** — single small JS file, JS-interop themed (fits a WASM interop demo),
  widely used/stable. *Leading candidate.*
- **BlazorApplicationInsights** — ships JS (user's suggestion); heavier.
- A lighter pure-static-web-assets RCL if one is found during the step.
If a suitable package proves impractical (e.g. drags in an un-trimmable Blazor runtime), fall back to
authoring a tiny local NuGet package that only ships a `wwwroot/*.js` static web asset and consume it
via a local feed — still exercises the NuGet-cache content root.

**Changes**
- `test/fixtures/Library/*.csproj` — add the chosen `PackageReference`. Rebuild fixtures.
- Confirm out-of-tree: assert a content root under `.nuget/packages` in `runtime.json`.
- Fixture app references the package asset at its canonical URL so it is actually requested — prefer
  a runtime `fetch('/_content/<pkg>/<file>.js')` or a `<script>` tag so it skips the module graph and
  exercises the middleware route directly (not Vite's transform). Set a `window.__contentAssetOk` flag.
- `test/fixtures/browser/library-app-vite/package.json` — add `"dev": "vite --port <fixed> --strictPort"`.
- `test/integration/` — a dev-mode Playwright config (or a `webServer.command` parameter) that
  launches `vite` dev instead of `sirv`, reusing the `__libReady` contract and adding an assertion
  that the `_content` asset loaded (`__contentAssetOk`). Wire a dev variant into
  `test/integration/matrix-lib.mjs` (`runConfig` dispatch + `parseMatrixArgs`), e.g. a new
  `config.type`/mode; keep it opt-in.

**Verify**
- The dev e2e passes; temporarily reverting the Part 1 `load`/middleware change makes it fail
  (guards the regression).
- Full in-tree matrix still green.

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
  - Add a short **Dev server** subsection under Usage (works out of the box; out-of-tree/NuGet assets
    handled by the middleware).
  - Move dev-server middleware from **Planned #1** to **Done**; keep watch/HMR (#2) in Planned and
    note the restart-on-asset-set-change limitation.
- `docs/architecture.md`: brief note on the dev-server middleware + the serve-mode route mechanism.

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
- `unplugin-dotnet-wasm/src/core/asset-resolution/{endpoint-lookup,asset-resolver}.ts`
- `unplugin-dotnet-wasm/src/core/dev-server/asset-middleware.ts` (new, + test)
- `unplugin-dotnet-wasm/src/unplugin/index.ts` (per-bundler dev registration)
- `test/fixtures/Library/*.csproj` (NuGet dep)
- `test/fixtures/browser/library-app-<bundler>/` (`dev` script)
- `test/integration/` (dev Playwright config + matrix dev variant)
- `unplugin-dotnet-wasm/README.md`, `docs/architecture.md`

## Limitations & follow-ups
- No watch/HMR (README #2) — restart after a `dotnet build` that changes the asset set.
- esbuild/bun/standalone rollup/rolldown have no dev-server injection point — out of scope.
- Node dev targets follow the existing browser/Node support constraints (unchanged here).
