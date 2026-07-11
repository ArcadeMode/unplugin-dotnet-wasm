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

**Follow-up owed to the plan** — `TYPES_PLAN.md` still describes `transpileDeclaration`;
update it to the Program-based approach (tracked as Aux I below).

## Auxiliary backlog

| # | Item | Depends on | Notes | Completed |
|---|------|-----------|-------|-----------|
| A | `_framework/dotnet` re-export path + `export { default }` + default-presence guard | **SDK emitting `dotnet.d.ts`** (external — investigate why `WasmEmitTypeScriptDefinitions=true` produces none) | Only slice blocked outside our code; `.d.ts` seam already stubbed in `emit()` | ☐ |
| B | Multi-bundler root resolution + nearest-ancestor `node_modules` walk | Slice 1 | Lift the `framework==='vite'` gate; capture root per family (Webpack `compiler.options.context`, esbuild `absWorkingDir`, Farm `config.root`, Rollup/Rolldown cwd) | ☐ |
| C | Yarn PnP guard (detect `process.versions.pnp` → warn once → skip) | Slice 1 | Cheap, self-contained; degrades to today's behavior | ☐ |
| D | Idempotent content-keyed writes / stale-package pruning | Slice 1 | Uses the generator's `written` set; skip rewrite when content unchanged | ☐ |
| E | Live dev refresh (`configureServer` + manifest watch re-invokes `generate()`) | Slice 1 | Biggest post-MVP UX win; generator instance already retained | ☐ |
| F | Standalone generate CLI (postinstall/CI priming for fresh checkout) | Slice 1 | Fixes the wiped-`node_modules`-after-`npm ci` lapse | ☐ |
| G | Tests: unit (discover/emit/write) + integration gate (`tsc --noEmit` in a fixture) into the matrix | Slice 1 | Locks the behavior down | ☐ |
| H | Bare-specifier switch across all fixtures + README | B | Blast radius: 12+ fixtures | ☐ |
| I | Patch `TYPES_PLAN.md`: `transpileDeclaration` → Program-based emit; note per-entrypoint checker cost (batch into one multi-root Program if entrypoint count grows) | Slice 1 | Doc correction discovered during Slice 1 | ☐ |

**Critical path** — Slice 1 ✅ → (B, C, G, H, I parallel). A waits on the SDK; E, F are later polish.
