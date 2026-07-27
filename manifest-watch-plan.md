# Manifest watch + dev-server reload plan

Goal: in **serve** mode, watch the endpoints + runtime manifests on disk. On change,
reinitialize the plugin context (atomic swap of `AssetResolver` + asset middleware) and
tell the active dev server to do a full reload. Start minimal on Vite, then fan out per family.

## Design

- **Central watcher** (`ManifestWatcher`) owns fs watching + debounce + single-flight. It is
  bundler-agnostic and calls two injected callbacks: `reinitialize()` and `reload()`.
- **Context** gains re-initialization: build a fresh resolver + middleware pair and swap it in
  atomically (only on success; keep the old instance on parse/partial-write failure).
- **Reload** is family-specific: each family registers its own full-reload trigger with the
  context; the watcher calls it after a successful reinit.
- Everything is **serve-only**. Build/watch-rebuild tooling is out of scope for stage 1+ and
  handled later via native `addWatchFile`.

## Stage 0 — Context supports atomic re-init

File: `src/unplugin/context.ts`

- Extract the resolver+middleware construction from `doInitialize()` into a pure
  `buildAssets()` that returns `{ resolver, middleware }` (reads manifests fresh each call).
- Add `reinitialize(): Promise<void>` that runs `buildAssets()` and, **on success only**,
  synchronously swaps `#assetResolver` / `#assetMiddleware`. On failure, log + keep current.
- Keep getters sync (consumers re-read them per call, so swap is transparent).
- Add `onReload(fn)` / `#reloadTriggers` so families can register a full-reload callback. A
  private `#triggerReload()` is fired inside `reinitialize()`'s try block, **after a successful
  swap only** (so consumers never reload onto failed/stale assets).
- Do **not** re-run the type-shim generator on reinit yet (decide later).

> Status: Stages 0–2 done.

## Stage 1 — Central watcher

File: `src/core/dev-server/manifest-watcher.ts` (new)

- `class ManifestWatcher` constructed with `{ paths, onChange, logger, debounceMs? }`.
- Wraps **chokidar** (v4): `ignoreInitial`, `atomic`, and `awaitWriteFinish` (handles dotnet's
  rename-replace + partial writes; replaces manual debounce).
- **Single-flight** so only one `onChange` runs at a time, re-running once if a change lands mid-run.
- `start()` / `dispose()` for lifecycle; guard against firing after dispose.

## Stage 2 — Vite (minimal, reference impl)

File: `src/unplugin/families/rollup-family.ts` (`vite.configureServer`)

- Only when `isServe`.
- Get paths from `discoverManifests(ctx.options)`; `new ManifestWatcher({ paths, onChange: () => ctx.reinitialize(), logger })`.
- `ctx.onReload(() => server.ws.send({ type: 'full-reload' }))`.
- `server.httpServer?.once('close', () => watcher.dispose())` (disposal — chokidar holds fs handles;
  also prevents duplicate watchers on Vite server restart).
- Verify against `library-app-vite`: rebuild library (`pnpm build:library:nofingerprint`),
  confirm browser reloads and refetches `_framework/*` with new bytes.

## Stage 3 — Webpack / Rspack / Rsbuild

File: `src/unplugin/families/webpack-family.ts` (serve only)

- Register `ManifestWatcher` in the dev-server setup (`onBeforeStartDevServer` / dev middleware).
- Reload: prefer the dev server's client reload (`devServer` websocket / `server.sockWrite`),
  else `compiler.watching?.invalidate()` to force a recompile.
- Dispose on server/compiler close.

## Stage 4 — Farm

File: `src/unplugin/families/farm-family.ts` (`farm.configureDevServer`)

- Register `ManifestWatcher`; reload via Farm HMR (`server.hmrEngine` / full reload).
- Dispose on server close.

## Stage 5 — esbuild / bun

File: `src/unplugin/families/esbuild-family.ts`

- esbuild serve has no HMR: run `ManifestWatcher`, reinit, and signal the reload client
  (esbuild `onEnd` / live-reload SSE) if configured; otherwise document as reinit-only.

## Stage 6 — Rollup / Rolldown watch (build tooling, no dev server)

- No central watcher; use native `this.addWatchFile(endpointsPath[, runtimePath])` in
  `buildStart` so the bundler's own watch re-runs `resolveId`/`load` against the swapped
  resolver. React in `watchChange` → `ctx.reinitialize()`.

## Cross-cutting

- **Serve gating:** reuse each family's existing `isServe` detection.
- **Fingerprint note:** full reload + swapped middleware covers runtime-fetched `_framework/*`.
  Statically-imported fingerprinted assets may need module invalidation (Vite
  `moduleGraph.invalidateModule` on binary-regex modules) — add per family only if needed.
- **Post-edit:** run `pnpm format` after touching `.ts` files.
