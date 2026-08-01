# Test Architecture Execution Plan

Multi-step delivery + migration from the env-var matrix onto the fixture-builder.
Each phase lists scope, validation, and the milestone that gates the next phase.
Principle: **land infrastructure primitives first, prove one vertical slice end-to-end, then fan out,
then migrate coverage, then delete old — behind dual-green in CI throughout.**

## Phase 0 — Isolation + concurrency basics

Rationale: keep only what matters for correctness under parallelism; skip the heavy machinery
(no process-tree kill gate, no build cache, no build semaphore).

Scope:
- **Unique materialized dirs:** every fixture (project + Library copy) lives under a
  random/timestamp path segment so concurrent builds/servers never collide or overwrite.
- **Ephemeral ports:** each server gets an allocated free port; no fixed ports.
- **Ordinary teardown:** `afterAll` → `fixture.dispose()` (stop server child + `rm -rf`), relying on
  the test runner's own timeouts. No detached-group tree-kill machinery.
- **Concurrency = config:** cap parallelism via the runner's worker setting (e.g. vitest
  `maxWorkers`); N parallel builds are fine because dirs are unique.

Validation / milestone:
- Two+ fixtures materialize, build, and serve concurrently with no dir/port collision.
- `dispose()` removes the temp dir and stops the server under normal completion.
- **GATE:** parallel isolation proven; proceed to the vertical slice.

## Phase 1 — fixture-builder core + first vertical slice (vite/browser/server)

Scope:
- Scaffold `test/fixture-builder` package (union devDeps, workspace entry, `.materialized/` gitignore).
- `types.ts`, `materialize.ts` (codegen `package.json` + copy templates), `dotnet.ts`
  (library copy + baseline/altered build), `server.ts` (`runScript`, `start`, `waitForPort`,
  `waitForLog`), `fixture.ts`, `index.ts`.
- Templates: `shared/` (entry.browser, index.html, tsconfig.base), `library/` (with
  `#if LIBRARY_ALTERED` in `Echo.cs`), `bundlers/vite/`.
- One spec: vite/browser/server **change** test (baseline → altered rebuild → pushed reload → assert).

Validation / milestone:
- `buildFixture` materializes a runnable project; upward `node_modules` resolution works (no install).
- Change test passes: `greet('world')` flips `Hello` → `Hola` without restart.
- `dispose()` removes the temp dir and kills the server.
- **GATE:** full path (materialize → build → serve → rebuild → reload → assert → dispose) green,
  Windows + Linux.

## Phase 2 — Capability catalog + thin runner

Scope:
- `capabilities.ts`: per-bundler `{ build, publish, watch, devServerBrowser, devServerNode }`.
- Test helpers: `describe.each` over the catalog; `skipUnless(capability)`.
- Thin runner script: `--bundler=<name>` + `--platform=<browser|node>` → dispatch to
  vitest (node) or Playwright (browser); no env cartesian.

Validation / milestone:
- Running with `--bundler=vite --platform=browser` executes only the matching specs.
- Unsupported combos skip via capability gate, not hardcoded lists.
- **GATE:** dispatch + gating replace the runner's role for the vite slice.

## Phase 3 — Template additional bundlers (webpack, esbuild) browser + node

Scope:
- `bundlers/webpack/` (dev server browser; node build/watch), `bundlers/esbuild/`
  (no dev server; dist/watch; node execute).
- `shared/entry.node.ts`; node `dist`/`watch` execution via `run()`.

Validation / milestone:
- 6 combos (vite/webpack/esbuild × browser/node) build and boot.
- esbuild (no dev server) correctly gated out of `server`.
- **GATE:** capability catalog proven across a dev-server and a non-dev-server bundler.

## Phase 4 — Port integration coverage (retire isolated-build + `none`)

Scope:
- Port build/publish **artifact assertions** onto `fx.build()` output (wasm present, byte-length,
  counts, `.dat`/`.pdb`, `Library*.wasm`, entry references wasm).
- Add env-driven plugin-option knobs (`isPublish`, `dotnetOutputDir`, missing-dir) to configs;
  port the option-permutation + `DiscoveryError` tests.
- Fold **no-build ⇒ discovery error** in as every fixture's first `it` (assert exit code +
  plugin message). Replace "no unresolved warnings" with positive exit-0 + artifact checks.
- Port type-shims coverage.

Validation / milestone:
- All former `isolated-build` assertions reproduced via real CLI output.
- `none` cell behavior reproduced per-run without a matrix dimension.
- **GATE:** `test/integration/bundlers/` no longer referenced by any ported spec.

## Phase 5 — `watch` serve mode

Scope:
- Browser: watcher + `sirv` static server; rebuild → wait for dist stabilization → `page.reload()`.
- Node: `node --watch`; rebuild → wait for restart → assert.
- Robust rebuild-complete detection (dist hash/mtime stabilization + timeout).

Validation / milestone:
- Watch change test passes browser + node for at least vite + esbuild.
- No flakiness over N repeated runs (define N in CI).
- **GATE:** watch signal proven robust before fanning out.

## Phase 6 — Vite node dev-server isolated test

Scope:
- Single isolated spec: vite node `server` (SSR builds & runs), independently skippable.

Validation / milestone:
- Passes in isolation; failure/flake does not affect the node suite.
- **GATE:** node dev-server coverage captured as one maintainable unit.

## Phase 7 — Remaining bundlers

Scope:
- Template `rollup`, `rolldown`, `rspack`, `rsbuild`, `farm`, `bun`; wire capabilities.
- Verify per-bundler error surfacing on a captured stream (farm/rspack especially).

Validation / milestone:
- Full bundler set green for its supported capabilities across serve modes.
- **GATE:** parity with the current matrix's bundler coverage.

## Phase 8 — Dual-green, cutover, deletion

Scope:
- Run **old matrix + new suite** in CI simultaneously; per-bundler CI workers on the new suite.
- Parity checklist: every old assertion has a new-suite equivalent.
- Once new suite green across the full grid: delete `run-test-matrix.mjs`, `matrix-lib.mjs`,
  `test-matrix-parameters.ts`, `test/integration/bundlers/`, and the 18 `library-app-*` fixtures.
- Update `AGENTS.md` + root scripts.

Validation / milestone:
- New suite green on all per-bundler workers, Windows + Linux, over repeated runs.
- Parity checklist 100% complete.
- **GATE (final):** delete old only after both are green side-by-side for an agreed window.

## Cross-cutting validation

- **Determinism:** repeated runs of change/watch tests to quantify flakiness before deletion.
- **Resource ceiling:** monitor peak concurrent `dotnet` builds + browsers under the worker cap.
- **CI time budget:** track wall-clock vs the old matrix (no build cache; isolation cost accepted).

## Rollback / safety

- Old matrix stays intact and green until Phase 8's final gate — instant fallback.
- Each phase is independently mergeable; the new suite is additive until cutover.
- No tracked-source mutation at any point (altered builds touch only gitignored `bin`/`obj`).
