# Editor/tsc Type Support — Execution Tracker

Execution breakdown of [TYPES_PLAN.md](TYPES_PLAN.md): a minimal vertical shipped first,
with auxiliaries layered on after. Status column tracks what has actually landed.

## Slice 1 — MVP (✅ Completed)

The minimal vertical: in `samples/sample-vite`, a bare `import { Counter } from 'typeshim'`
resolves with full types in tsserver/`tsc` — **zero tsconfig edits, zero manual files** —
generated automatically during `vite build`/`dev`, build unaffected.

**Delivered**
- `TypeShimGenerator` (stateful, instantiated per build) — discover → emit → write, grouped
  by package. Depends on the `AssetResolver` alone (`routes()` surfaces canonical routes; the
  endpoint lookup never leaves the resolver).
- **Program-based declaration emit** (`createProgram` + `emitDeclarationOnly`), not
  `transpileDeclaration` — the SDK-generated `typeshim.ts` is not `--isolatedDeclarations`
  conformant, so `transpileDeclaration` fails; a single-file Program does full type-directed
  emit and handles ordinary TS.
- `typescript` resolved from the **consumer's** `node_modules` (matches their language version).
- Magic package written to `<viteRoot>/node_modules/<pkg>` with a `types`-only `exports`;
  writes wrapped in `try/catch` (read-only → warn and continue).
- Vite-gated (`meta.framework === 'vite'`) so other bundlers' `node_modules` stay untouched.
- Sample switched to the bare specifier.

**Verified** — `rm -rf node_modules/typeshim` → `vite build` regenerates it → `tsc --noEmit`
resolves `typeshim` with full types. (`./_framework/dotnet` remains unresolved by design — see
Aux A; a separate `vite.config.ts` error is pre-existing vite 6/8 dependency skew.)

**Files** — `src/core/type-shims/type-shim-generator.ts` (new),
`src/core/asset-resolution/asset-resolver.ts` (`routes()`),
`src/unplugin/index.ts` (wiring + Vite `configResolved` root capture),
`samples/sample-vite/src/entry.ts` (bare import).

## Auxiliary backlog

| # | Item | Depends on | Notes | Completed |
|---|------|-----------|-------|-----------|
| A | `_framework/dotnet` re-export path (named exports) | Slice 1 | **Done for named exports.** The `.d.ts` re-export path generates and resolves **named** exports (verified: esbuild fixture's `import { dotnet }` types clean); fixed a backslash-in-specifier bug (POSIX now). **Default exports intentionally parked** — the SDK's `dotnet.d.ts` exports `createDotnetRuntime as default` (the runtime factory), which our `export *`-style re-export drops. Effect: default-import syntax (`import X from '_framework/dotnet'`) won't typecheck; the documented named path (`import { dotnet }` → `dotnet.create()`) is unaffected. The only untyped casualty is the `createDotnetRuntime` factory, which the documented flow doesn't use. A "known limitation" README note is the follow-up | ✅ |
| B | Multi-bundler root resolution + nearest-ancestor `node_modules` walk | Slice 1 | ✅ Gate lifted; root captured per family (Vite `config.root`, Webpack/Rspack `compiler.options.context`, Rsbuild config `context`, esbuild/bun `absWorkingDir`, Farm `root`, Rollup/Rolldown cwd). Nearest-ancestor `node_modules` walk added (local-first). **Verified:** Vite (no regression), esbuild (typecheck-clean resolution end-to-end), webpack (builds + generates). All 125 unit tests pass | ✅ |
| C | Yarn PnP guard (detect `process.versions.pnp` → warn once → skip) | Slice 1 | Cheap, self-contained; degrades to today's behavior | ☐ |
| D | Idempotent writes — skip-emit via mtime, skip-write via exact content compare | Slice 1 + generator hoisted to plugin-root closure (shared with E) | ✅ **Implemented.** `SourceFileChangeTracker` (in-memory `path→mtimeMs` map) injected into every per-`buildStart` generator. `hasChanged()` checks mtime and returns `true` on first-seen, mtime change, or stat failure. Skip-emit: `!changed && existsSync(output)` gates emission (but entry still added to exports). Skip-write: compare freshly-produced bytes exactly against on-disk file; same for `package.json`. Uniform for `.ts`/`.dts`. Tracker survives across builds (plugin lifecycle) so watch/dev retain speedup. All 131 unit tests pass; full e2e matrix (13/18 bundler configs = 234 tests) passes. No regression; no version stamp. | ✅ |
| E | Live dev refresh (`configureServer` + manifest watch re-invokes `generate()`) | Slice 1 | **Postponed** — deferred to the broader dev-server integration (needs the `configureServer`/watch plumbing that doesn't exist yet). Tracked in the package README **Planned** → Watch/HMR item. **Not** superseded by managed builds (Planned #5): we still need to *detect the .NET output change* to trigger regen — owning the build command only makes that change easier to observe, it doesn't remove the need. Generator instance already retained, so re-invocation is cheap once the seam lands | ⏸ |
| F | Standalone generate CLI (postinstall/CI priming for fresh checkout) | Slice 1 | **Postponed** — low value now (see README **Planned** #6). Two parts: **(1) auto-trigger** (postinstall/descriptor/`init`) — headline use (fresh checkout) is undercut by the fact that codegen needs `dotnet build` output on disk first (nothing to generate from on a clean checkout); could be subsumed by managed builds (#5). **(2) `bin generate` CLI** — the useful nucleus: an explicit step for build-free CI `tsc` jobs and a manual escape hatch. Build the CLI first *if* un-parked; gate un-park on a real report (e.g. red `tsc` in a build-free CI job). Prereq for either: extract `buildStart`'s load→resolve→generate body into a reusable `generateTypeShims(options, {root, logger})` | ⏸ |
| G.a | **Integration-level** behavior + `tsc` gate | Slice 1 | ✅ `test/integration/tests/type-shims.test.ts` — inspects on-disk state from the standard fixture build (does not build itself), gated to `debug`. Asserts the fixture's local `node_modules` exists and contains `typeshim/{package.json,index.d.ts}` and `_framework/{package.json,dotnet/index.d.ts}`; then runs the fixture's own `tsc --noEmit` and asserts absence of `Cannot find module 'typeshim'` / `'_framework/dotnet'`. Verified passing (esbuild/node, webpack/browser) and fails loud when a package is hidden | ✅ |
| G.b | Unit tests (discover / emit / write + `routes()`, `typeKind`, `toEntry`, nearest-ancestor walk, skip paths) | G.a + **generator factoring finalized** | ✅ **Done.** Generator factoring settled (collaborators each extracted into their own class + test file). Unit coverage across the module: `TypeEntry` (`toEntry`; 9), `NodeModulesLocator` (nearest-ancestor walk; 4), `ShimPackage` + `IdempotentFileWriter` (write/manifest/skip-write; 7+5), `SourceFileChangeTracker` (skip-emit primitive; 6), `TsDefinitionEmitter` (`.d.ts` re-export + TS-unavailable paths; 4), and **`TypeShimGenerator` orchestration** (`discover` filter/group + `typeKind`, skip-emit-keeps-export gate, emit-null→no-manifest, throwing-collaborator→warn; 4). All temp-dir tests use `os.tmpdir()`/`mkdtemp` (isolated — required so `NodeModulesLocator` never walks up into the repo's real `node_modules`). 43 type-shims tests green; 164 total. **Deliberately skipped:** `routes()` (trivial getter on the already-tested `AssetResolver`) and the real-TS `.ts`→`.d.ts` Program-emit happy path (needs a live `typescript` resolve; the `dts` and unavailable branches are covered) | ✅ |
| H | Bare-specifier switch across all fixtures + README | B | ✅ **Done.** All 13 fixtures + `samples/sample-vite` already import the bare form (`typeshim`, `_framework/dotnet`); switched during B's verification, so no code change was owed. README gained a brief **Editor & type support** subsection documenting auto type resolution + the `npm ci` regen caveat | ✅ |
| I | Patch `TYPES_PLAN.md`: `transpileDeclaration` → Program-based emit; note per-entrypoint checker cost (batch into one multi-root Program if entrypoint count grows) | Slice 1 | ✅ **Done.** *Declaration emit* + *TypeScript dependency* sections rewritten to the single-file `Program` (`createProgram` + `emitDeclarationOnly`) approach, with the rejection rationale for `transpileDeclaration`; failure bullet now "emit produced no output"; added the checker-cost note. Also corrected a bonus doc drift: TS resolves from the consumer root only, with **no** fallback to the plugin's own copy | ✅ |
| J.1 | **Collision safety** — a generated `pkgName` writes into `node_modules/<pkgName>` and must **never** overwrite or delete a real dependency (e.g. the user's real `node_modules/vite`) | Slice 1 | ✅ **Implemented.** `PackageCollisionChecker` — injected sentinel `{name, content}` (no internal constants, tests control the marker). Ownership rule: a dir is ours iff sentinel present, absent, or empty; non-empty foreign dirs → warn + skip. `ensureCollisionFree()` is awaited up-front in `writePackage` (inside the try-catch, so IO throws roll into the existing error handler). Sentinel written via the shared `IdempotentFileWriter` on first claim. `ShimPackage` stayed pure. Tests: `package-collision-checker.test.ts` (4 cases: absent subdir, empty dir, our sentinel present, foreign package) + generator e2e (real temp `node_modules`, pre-seed foreign package.json + dummy file, assert byte-identical after and no write + warn). All 170 tests pass. | ✅ |
| J.2 | **Dead-output pruning** — remove generated packages/subpaths we no longer back with a route | D + E (in-memory ownership survives across builds) | **Postponed** → README **Planned** (nice-to-have). Mostly *cosmetic*: stale *subpaths* within a still-generated package are already made unresolvable by rewriting that package's **closed `exports` allowlist** each build. The only real leak is a whole *vanished* package / the all-emit-failed early-return (stale `package.json` keeps its old `exports`). In-memory ownership prunes in **dev/watch only** (a one-shot build has no memory a package existed), so this rides on E; cold-build pruning would need a marker-gated disk scan. **Pin:** rests on `exports` staying closed — a `"./*"` wildcard would make subpath pruning mandatory | ⏸ |

**Critical path** — Slice 1 ✅ → B ✅ → G.a ✅ → G.b ✅ → H ✅ → I ✅; A ✅ (named exports; default
exports parked) → J.1 ✅ (collision safety). **Actionable remaining:** C (Yarn PnP guard) — the sole
cold-build item standing. **Postponed:** E (live dev refresh), F (generate CLI), and J.2
(dead-output pruning) — all tracked in the package README **Planned** section (E→Watch/HMR, F→#6,
J.2→pruning). E is deferred to the broader dev-server integration but is *not* superseded by managed
builds (#5): change detection is still required to trigger regen. D and E share one seam — cross-build
state in the plugin-root closure; D already lifted the shared state up (the `SourceFileChangeTracker`
survives across builds even though the generator is still re-instantiated per `buildStart`), so E can
reuse that seam whenever the dev-server work begins. J.2's dev/watch pruning rides on E's in-memory
ownership; only a marker-gated cold-build scan would be independent.
