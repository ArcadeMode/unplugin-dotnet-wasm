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
| A | `_framework/dotnet` re-export path + `export { default }` + default-presence guard | Partially unblocked — `test/fixtures/Library` **does** emit `dotnet.d.ts` (the `samples/SampleLibrary` still doesn't; investigate the csproj/SDK difference) | **Partially done via Aux B:** the `.d.ts` re-export path now generates and resolves **named** exports (verified: esbuild fixture's `import { dotnet }` types clean); fixed a backslash-in-specifier bug (POSIX now). **Remaining:** `export { default }` + default-presence guard for libs whose `dotnet.d.ts` has a default export | ◑ |
| B | Multi-bundler root resolution + nearest-ancestor `node_modules` walk | Slice 1 | ✅ Gate lifted; root captured per family (Vite `config.root`, Webpack/Rspack `compiler.options.context`, Rsbuild config `context`, esbuild/bun `absWorkingDir`, Farm `root`, Rollup/Rolldown cwd). Nearest-ancestor `node_modules` walk added (local-first). **Verified:** Vite (no regression), esbuild (typecheck-clean resolution end-to-end), webpack (builds + generates). All 125 unit tests pass | ✅ |
| C | Yarn PnP guard (detect `process.versions.pnp` → warn once → skip) | Slice 1 | Cheap, self-contained; degrades to today's behavior | ☐ |
| D | Idempotent writes — skip-emit via mtime, skip-write via exact content compare | Slice 1 + generator hoisted to plugin-root closure (shared with E) | ✅ **Implemented.** `SourceFileChangeTracker` (in-memory `path→mtimeMs` map) injected into every per-`buildStart` generator. `hasChanged()` checks mtime and returns `true` on first-seen, mtime change, or stat failure. Skip-emit: `!changed && existsSync(output)` gates emission (but entry still added to exports). Skip-write: compare freshly-produced bytes exactly against on-disk file; same for `package.json`. Uniform for `.ts`/`.dts`. Tracker survives across builds (plugin lifecycle) so watch/dev retain speedup. All 131 unit tests pass; full e2e matrix (13/18 bundler configs = 234 tests) passes. No regression; no version stamp. | ✅ |
| E | Live dev refresh (`configureServer` + manifest watch re-invokes `generate()`) | Slice 1 | Biggest post-MVP UX win; generator instance already retained | ☐ |
| F | Standalone generate CLI (postinstall/CI priming for fresh checkout) | Slice 1 | Fixes the wiped-`node_modules`-after-`npm ci` lapse | ☐ |
| G.a | **Integration-level** behavior + `tsc` gate | Slice 1 | ✅ `test/integration/tests/type-shims.test.ts` — inspects on-disk state from the standard fixture build (does not build itself), gated to `debug`. Asserts the fixture's local `node_modules` exists and contains `typeshim/{package.json,index.d.ts}` and `_framework/{package.json,dotnet/index.d.ts}`; then runs the fixture's own `tsc --noEmit` and asserts absence of `Cannot find module 'typeshim'` / `'_framework/dotnet'`. Verified passing (esbuild/node, webpack/browser) and fails loud when a package is hidden | ✅ |
| G.b | Unit tests (discover / emit / write + `routes()`, `typeKind`, `toEntry`, nearest-ancestor walk, skip paths) | G.a + **generator factoring finalized** | ✅ **Done.** Generator factoring settled (collaborators each extracted into their own class + test file). Unit coverage across the module: `TypeEntry` (`toEntry`; 9), `NodeModulesLocator` (nearest-ancestor walk; 4), `ShimPackage` + `IdempotentFileWriter` (write/manifest/skip-write; 7+5), `SourceFileChangeTracker` (skip-emit primitive; 6), `TsDefinitionEmitter` (`.d.ts` re-export + TS-unavailable paths; 4), and **`TypeShimGenerator` orchestration** (`discover` filter/group + `typeKind`, skip-emit-keeps-export gate, emit-null→no-manifest, throwing-collaborator→warn; 4). All temp-dir tests use `os.tmpdir()`/`mkdtemp` (isolated — required so `NodeModulesLocator` never walks up into the repo's real `node_modules`). 43 type-shims tests green; 164 total. **Deliberately skipped:** `routes()` (trivial getter on the already-tested `AssetResolver`) and the real-TS `.ts`→`.d.ts` Program-emit happy path (needs a live `typescript` resolve; the `dts` and unavailable branches are covered) | ✅ |
| H | Bare-specifier switch across all fixtures + README | B | ✅ **Done.** All 13 fixtures + `samples/sample-vite` already import the bare form (`typeshim`, `_framework/dotnet`); switched during B's verification, so no code change was owed. README gained a brief **Editor & type support** subsection documenting auto type resolution + the `npm ci` regen caveat | ✅ |
| I | Patch `TYPES_PLAN.md`: `transpileDeclaration` → Program-based emit; note per-entrypoint checker cost (batch into one multi-root Program if entrypoint count grows) | Slice 1 | ✅ **Done.** *Declaration emit* + *TypeScript dependency* sections rewritten to the single-file `Program` (`createProgram` + `emitDeclarationOnly`) approach, with the rejection rationale for `transpileDeclaration`; failure bullet now "emit produced no output"; added the checker-cost note. Also corrected a bonus doc drift: TS resolves from the consumer root only, with **no** fallback to the plugin's own copy | ✅ |
| J | **Sanitary node_modules** — prune dead generated output + ownership safety (never touch real deps) | D + E (in-memory ownership survives across builds) | Two hazards to guard: **(1) dead code** — packages/subpaths we generated before but no longer back with a route. Only a *correctness* leak for whole vanished packages / the all-emit-failed early-return (stale `package.json` keeps its old `exports`); stale *subpaths* within a still-generated package are already made unresolvable by rewriting that package's **closed `exports` allowlist** each build, so pruning them is cosmetic. **(2) collision safety** — a generated `pkgName` writes into `node_modules/<pkgName>` and must **never** overwrite or delete a real dependency (e.g. the user's real `node_modules/vite`). Both writes and deletes should be gated on an **ownership marker** (sentinel field in our `package.json`, or a `.dotnet-typeshim` sentinel file). In-memory ownership prunes in **dev/watch only** (a one-shot build starts with no memory a package existed); cold-build pruning would need a disk scan gated on the marker. **Pin:** rests on `exports` staying closed — a `"./*"` wildcard would make subpath pruning mandatory | ☐ |

**Critical path** — Slice 1 ✅ → B ✅ → G.a ✅ → G.b ✅ → H ✅ → I ✅. Remaining: C (PnP guard),
E (live dev refresh), F (generate CLI), J (sanitary node_modules), and A's default-export handling.
D and E share one seam —
hoisting the generator (currently re-instantiated per `buildStart`) into the plugin-root closure so
state survives across builds; do that first, then D's mtime hint and E's live refresh layer on. J
(sanitary node_modules) builds on D+E. E, F, J are later polish.
