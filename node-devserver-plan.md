# Node dev-server + broadened Node bundling — execution plan

Status: planning. Owner-driven prototype. Update checkboxes as phases land.

## Goal

Make every bundler emit an asset-import value the .NET WASM runtime's `fetch_like` can
consume in **both** browser and Node, with **no consumer-side shim**, and make **Node dev
servers** (specifically Vitest running in `environment: 'node'`, which is a Vite dev server
under the hood) boot the runtime.

Contract (see `docs/architecture.md` "Cross-target output contract"): `dotnet.js` does a
literal `import "./<asset>"` per asset; the bound value must resolve to a URL string
(`http(s):` in browser, `file:` in Node).

## Verified facts (from the Vitest spike, keep as ground truth)

- Vitest node mode runs Vite with `command === 'serve'` → our plugin's `isServe` path.
- `configureServer` is called but `httpServer === false` (middleware mode, **no listening
  port**) → the connect asset middleware **cannot** deliver assets to node-mode Vitest.
- `import.meta.url` in an SSR-transformed module is a **`file://` source path**, not an
  http dev-server URL.
- The Vite/Rollup `load` hook receives `{ ssr }` and unplugin forwards it verbatim
  (`toRollupPlugin`: `handler.apply(this, args)`), so `ssr` is a reliable discriminator
  **when the runner uses the SSR environment**. Real Vitest `environment: 'node'` (via
  `ssrLoadModule`) does → `ssr=true`. `vite-node`@6 (latest, the vite-8 line) does **not**:
  on vite 8 it loads through the *client* environment (`options.ssr=false`,
  `environment.name='client'`), never reaching `isServe && ssr`. → vite-node was evaluated and
  **rejected** as the serve-node guard; the harness runs real Vitest instead.
- The binary `load` hook `id` is already the **resolved physical path** (resolveId mapped
  it via the VFS), so `pathToFileURL(id)` yields the correct absolute `file://` URL.
- Exact failure reproduced: serve value `/_framework/dotnet.native.wasm` → Node `fetch`
  → `TypeError: Failed to parse URL` (no origin base).

## Design primitives

**Mode → emitted asset module (the only thing that changes):**

| Mode | Discriminator | Emitted `export default` | Base mechanism | Portable? |
|---|---|---|---|---|
| build | not serve | `new URL('./<rel>', import.meta.url).href` (rollup: via `ROLLUP_FILE_URL`) | `import.meta.url` | yes (copy in dist) |
| serve + node | `isServe && ssr` | `"<pathToFileURL(physical)>"` | `pathToFileURL` | dev-only (reads live `bin/`) |
| serve + browser | `isServe && !ssr` | `"/_framework/<name>"` | page origin + middleware | dev-only |

Key points:
- `pathToFileURL` (serve-node) and `import.meta.url` (build) are **different branches for
  different requirements**, never a runtime switch. Serve-node bakes an absolute literal, so
  it is ESM/CJS-agnostic. The ESM/CJS `import.meta.url` fallback (auto-detect output format)
  applies **only** to the build/relative branch.
- Absolute `file://` never leaks into a deployed dist: it is emitted only in the serve
  branch, and nothing is written/deployed from a dev/Vitest run.

## Ordering rationale (grill outcome)

1. Infra first so Phase 1 has a shared helper + a regression net.
2. vite node-serve first — the immediate Vitest dogfood blocker, isolated `load` branch.
3. esbuild **and bun together** — one shared esbuild-family `setup`; prototype the universal
   build proxy on the simplest targets and drop the `withResourceLoader` shim.
4. webpack/rspack/rsbuild last (before farm) — highest risk: needs `output.module`, emits a
   URL **instance** (unverified), different mechanism (module rule/loader, not `onLoad`).
5. farm reconcile — README claims node but matrix omits it; verify/align.
6. docs + matrix support-list + roadmap as a consolidation pass.

---

## Phase 0 — Infra (shared helper + node-serve harness)

Changes:
- [ ] Add core helper `unplugin-dotnet-wasm/src/core/asset-resolution/asset-url-module.ts`
      exporting pure builders used by every family:
  - `buildFileUrlModule(physicalPath): string` → `export default "<pathToFileURL>";`
  - `buildOriginPathModule(name): string` → `export default "/_framework/<name>";`
  - `buildImportMetaUrlModule(innerSpecifier): string` →
        `import u from '<inner>'; export default new URL(u, import.meta.url).href;`
      (build proxy; `<inner>` re-imports the real asset via the bundler's native emitter)
  - unit tests for each in `asset-url-module.test.ts`.
  - Note: **not yet extracted.** The serve-node branch (Phase 1) currently *inlines*
        `pathToFileURL(id).href` and `'/_framework/' + basename(id)` (shipped in `3a55e55`
        before these helpers existed). Kept because Phases 2–3 still want
        `buildImportMetaUrlModule` for the build proxy; retrofit the serve branch onto
        `buildFileUrlModule`/`buildOriginPathModule` when the helpers land.
- [ ] Node-serve test harness: allow `SERVE_MODE=server` + `PLATFORM=node`.
  - Lift the `serverIllegal` guard in `test/integration/matrix-lib.mjs` for the
        `platform=node && type=e2e` case (keep it illegal for build-mode=none).
  - Add `DEV_SERVER_NODE_BUNDLERS = ['vite']` (extend later).
  - **Fixture owns the run via a stable npm-script contract** (mirrors `build:debug` /
        `build:release`): every node dev-server fixture exposes `serve:debug` and
        `serve:release`. For vite these are `vitest run --mode development|production --config
        vitest.harness.config.ts`; other bundlers may implement them with whatever runner fits.
        The fixture gains a `vitest` devDep so the script is self-contained/runnable standalone
        (`pnpm --filter <fixture> serve:debug`). All bundler/runner/config/mode details are
        hidden behind these two script names — the surface contract stays identical across
        fixtures.
  - Add `test/integration/tests/runtime-node-serve.e2e.test.ts`: mirrors the dist harness
        (`runtime-node.e2e.test.ts`) in **shape** — `spawnSync` a CLI in the fixture dir,
        assert exit code. It is **bundler-agnostic**: it picks the script by build mode
        (`publish` → `serve:release`, else `serve:debug`) and runs `pnpm run <script>` in the
        fixture. No `serveInvocation` per-bundler switch, no `createServer`/`ssrLoadModule`, no
        config paths or `--mode` in the test. Interop assertions live in the fixture's
        `runtime.harness.test.ts`; the e2e only checks vitest's exit code. (`vite-node` was
        evaluated and rejected — on vite 8 it loads via the *client* environment, `ssr=false`,
        never reaching the `isServe && ssr` branch.)
  - **Debug/Release parameterization** lives inside the fixture: `vitest.harness.config.ts`
        becomes `defineConfig(({ mode }) => …)` mirroring `vite.config.ts` (`production` →
        `Release` + `isPublish: true`); the `serve:debug`/`serve:release` scripts pass the
        matching `--mode`. Release requires the Library published first (same prerequisite as
        the matrix). Root convenience scripts `test:vitest:debug` / `test:vitest:release`
        delegate to the fixture scripts (single source of truth).
  - Fixture cleanup: delete the now-dead `runtime-serve-runner.ts` (it only fed the
        `ssrLoadModule` spike).

Validation:
- [ ] `pnpm build:plugin` and `pnpm test:unit` green (new helper unit tests included).
- [ ] `pnpm test:vitest:debug` green (fixture harness boots the runtime shimless).

Exit criteria: harness exists and is **GREEN** — real Vitest (`test:vitest:debug`) boots the
runtime shimless via the fixture's `serve:debug` script. (The core helpers are still pending;
see the note above.)

## Phase 1 — vite node dev server (the Vitest blocker)

Changes:
- [x] `src/unplugin/families/rollup-family.ts`: `load` handler widened to
      `handler(id, options?: { ssr?: boolean })`. In the `isServe` branch:
  - `options?.ssr` → absolute `file://` to the live asset (currently inlined
        `pathToFileURL(id).href`; retrofit onto `buildFileUrlModule` when Phase 0 helpers land)
  - else → `/_framework/<name>` (browser). **Landed in `3a55e55`.**
- [x] Confirmed no change needed to `resolveId`/VFS (already returns physical path).

Validation:
- [x] Node **serve** passes: `runtime-node-serve.e2e.test.ts` green for vite (debug + release,
      via `serve:debug`/`serve:release`; release confirmed reading the `Release` publish output).
- [ ] Node build still passes (regression): matrix node dist e2e (green in the latest run; keep
      as the standing regression net).
- [ ] Browser serve unaffected: vite browser `--serve-mode=server` e2e still green (plugin is
      byte-identical to HEAD, so unaffected — re-run to confirm before close-out).

Exit criteria: **met** — Vitest-in-node boots the .NET runtime through vite with no consumer
shim (`ssr=true` path), validated by the green harness.

## Phase 2 — esbuild + bun (browser + node build proxy)

Changes:
- [ ] `src/unplugin/families/esbuild-family.ts`: replace reliance on the bare `file` loader
      value with a proxy using `buildImportMetaUrlModule`:
  - `onResolve(BINARY)` → resolve to physical, put in `namespace: 'dotnet-url-proxy'`
        (skip when it is our own inner re-import).
  - `onLoad({ namespace })` → return `buildImportMetaUrlModule(physical)` as `loader: 'js'`,
        with `resolveDir` set so the inner `import u from '<physical>'` hits esbuild's `file`
        loader (which emits the copy and yields a chunk-relative path).
  - Verify the recursion guard: confirm whether `onLoad` `pluginData` propagates to the child
        `onResolve`; if not, guard via a path marker instead.
- [ ] Drop `.withResourceLoader(...)` from `test/fixtures/node/library-app-esbuild/src/entry.ts`.
- [ ] Add `test/fixtures/node/library-app-bun/` node fixture (mirror esbuild node fixture).

Validation:
- [ ] esbuild browser e2e green (no regression from routing through the proxy).
- [ ] esbuild node e2e green **without** `withResourceLoader`.
- [ ] bun browser + node e2e green.
- [ ] Assert emitted `file`-loader path is chunk-relative (inspect a built fixture once).

Exit criteria: esbuild+bun node works shimless; browser unaffected.

## Phase 3 — webpack / rspack / rsbuild (node)

Pre-work (verify the unconfirmed fact FIRST):
- [ ] Build one node webpack fixture with `experiments.outputModule` + ESM target and inspect
      the emitted asset import: confirm it is a `URL` **instance** (not a string). Decide fix:
      append `.href` via a chained loader, or route through the same proxy helper.

Changes:
- [ ] `src/unplugin/families/webpack-family.ts`: for node/module output, wrap asset modules so
      the exported value is a URL **string** (`.href`) via `buildImportMetaUrlModule` or a
      minimal loader. Keep browser `asset/resource` path unchanged.
- [ ] Add node fixtures: `library-app-webpack`, `-rspack`, `-rsbuild` under `test/fixtures/node/`.
- [ ] For node **dev-server** coverage (if in scope for these bundlers): each fixture
      implements the `serve:debug` / `serve:release` script contract (with a
      `runtime.harness.test.ts` + config, or whatever runner fits) and is added to
      `DEV_SERVER_NODE_BUNDLERS`. The bundler-agnostic e2e needs **no** change — it just runs
      the fixture scripts.

Validation:
- [ ] node e2e green for webpack, rspack, rsbuild.
- [ ] browser e2e for the three unaffected.

Exit criteria: webpack-family node builds run shimless.

## Phase 4 — farm reconcile

- [ ] Determine actual farm node status (README claims support; matrix `BUNDLERS_SUPPORT.node`
      omits it). Either add a farm node fixture + enable, or correct the README footnote.
- [ ] If farm gets node dev-server coverage, have its fixture implement the
      `serve:debug`/`serve:release` script contract + add it to `DEV_SERVER_NODE_BUNDLERS`
      (same pattern as Phase 3; the bundler-agnostic e2e needs no change).

## Phase 5 — docs, matrix support list, roadmap

- [ ] `test/integration/matrix-lib.mjs`: expand `BUNDLERS_SUPPORT.node` and dev-server-node list.
- [ ] `unplugin-dotnet-wasm/README.md`: update the support table (Node column) + remove/adjust
      the esbuild `withResourceLoader` note and the webpack/bun "rewrite pending" footnotes.
- [ ] `docs/architecture.md`: update "Cross-target output contract" to describe the implemented
      rewrite + the serve-node `file://` branch; add a short "Node dev server" note.
- [ ] Roadmap: move "Node targets for esbuild, bun, webpack, rspack, rsbuild" from Planned to Done.

---

## Risks / open questions

- esbuild `onLoad` `pluginData` propagation to child `onResolve` (recursion guard) — verify.
- esbuild/bun `file`-loader path must be chunk-relative for `new URL(u, import.meta.url)` to
  land on the emitted copy — verify against a built fixture.
- webpack/rspack/rsbuild URL-instance-vs-string under `output.module` — unverified; Phase 3 gate.
- CJS output for a node build (rare; `dotnet.js` is ESM) — build proxy auto-detects format and
  falls back to `pathToFileURL(__filename)` base only if a real consumer needs it.
- Node-serve reads live `bin/` output directly (by design for dev). Confirmed acceptable.
- Node-serve e2e runs **real Vitest** (`environment: 'node'`) against the fixture harness, so
  it guards the exact runner Vitest users hit (`ssr=true`, the `isServe && ssr` branch).
  `vite-node` was rejected: on vite 8 it loads via the *client* environment (`ssr=false`), so
  it never reaches the serve-node branch and can only pass by corrupting the browser path.
- `vitest.harness.config.ts` hardcoding a single configuration would break Release cells; it
  reads vite `--mode` instead so `--build-mode=publish` maps to `Release`/`isPublish` (needs a
  published Library present).

## Handy commands

- Build plugin: `pnpm build:plugin`  ·  Unit: `pnpm test:unit`
- Build library (debug/nofp): `pnpm build:library:nofingerprint`
- Build one fixture: `cd test/fixtures/node/library-app-<b>; npm run build`
- Node build e2e: `pnpm test:matrix -- --e2e --bundler=<b> --platform=node --fingerprint=false --build-mode=debug`
- Node serve e2e (new): `pnpm test:matrix -- --e2e --bundler=vite --platform=node --serve-mode=server --fingerprint=false --build-mode=debug`
- Fixture Vitest harness directly: `pnpm test:vitest:debug` · `pnpm test:vitest:release`
      (release needs `pnpm publish:library:nofingerprint` first)
- Format before finishing: `pnpm format`
