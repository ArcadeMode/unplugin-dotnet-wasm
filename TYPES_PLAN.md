# Editor/tsc Type Support via Magic `node_modules` Packages

Plan for making the plugin's virtual imports (`typeshim`, `_framework/dotnet`, …) resolve
with full types in tsserver **and** `tsc`, without the user editing `tsconfig`.

## Problem

The plugin's VFS resolves imports at **build time** (`resolveId`). TypeScript's language
server and `tsc` resolve modules **statically from disk** and know nothing about the plugin,
so virtual imports show as unresolved (red squiggles, `tsc` errors).

## Decision: bare specifiers + generated "magic" packages

1. **Consumer imports use bare specifiers** — drop the leading `./`:
   ```ts
   import { dotnet } from '_framework/dotnet';   // was './_framework/dotnet'
   import { Counter } from 'typeshim';            // was './typeshim'
   ```
   A specifier is *relative* only if it starts with `./`, `../`, `/`. Bare specifiers are the
   only ones TS `paths`/node-resolution act on. Build-time resolution already treats
   `_framework/dotnet` and `./_framework/dotnet` identically (`stripLeadingSlashOrDot`), and the
   plugin is `enforce: 'pre'`, so it still intercepts them.

2. **The plugin generates fake packages under the consumer's `node_modules`** that alias each
   virtual entrypoint to its real type source on disk. **Zero tsconfig changes** for the user —
   node/tsserver/tsc resolve bare specifiers natively.

`paths`-based approaches were rejected: `paths` never merges across `extends`, so any injected
config fights a user's own `paths`. Magic packages sidestep config entirely.

## Package shape

- Fake package **name = first path segment** of the specifier (`typeshim`, `_framework`).
  Subpaths become **subdirectories, each with its own `index.d.ts`** (uniform).
- `exports` **cannot** point outside its own package dir → each entrypoint needs a real file
  *inside* the package; a re-export's specifier **can** escape and is **absolute**.
- `exports` is **`types`-only** (no runtime condition). The bundler supplies the runtime via
  `resolveId`; omitting a runtime condition also makes plugin-ordering failures fail *loudly*.
- The program only ever imports a **`.d.ts`** from the package (see *Declaration emit*), so
  `skipLibCheck` covers it uniformly.

```
<consumerRoot>/node_modules/
├── typeshim/
│   ├── package.json     { "name":"typeshim","version":"0.0.0","private":true,
│   │                      "exports": { ".": { "types": "./index.d.ts" } } }
│   └── index.d.ts       // declarations emitted from typeshim.ts (self-contained)
└── _framework/
    ├── package.json     { "name":"_framework","version":"0.0.0","private":true,
    │                      "exports": { "./dotnet": { "types": "./dotnet/index.d.ts" } } }
    └── dotnet/
        └── index.d.ts   export * from '<abs>/dotnet.<hash>';
                         export { default } from '<abs>/dotnet.<hash>';   // .d.ts target: re-export
```

## Declaration emit (uniform `.d.ts`)

Every entrypoint is materialized as a **`.d.ts`** inside the package. Because the consumer's
program only ever imports a `.d.ts`, `skipLibCheck` applies uniformly and SDK-generated code is
**never** implementation-checked under the consumer's tsconfig (a raw `.ts` pulled into the
program is always checked, even inside `node_modules` — which is exactly why we do not re-export
one).

- **`.ts` target** (e.g. `typeshim.ts`) → a single-file `Program` (`createProgram` +
  `emitDeclarationOnly`, capturing the `.d.ts` via a custom `writeFile`) produces a complete
  `.d.ts`; write it as the package's `index.d.ts`. `ts.transpileDeclaration` was rejected: it
  requires `--isolatedDeclarations` conformance the SDK-generated `typeshim.ts` lacks, so it fails
  on ordinary TS; a type-directed Program handles the SDK output as-is. `export default`, if
  present, is carried through **natively** — no separate detection step.
- **`.d.ts` target** (e.g. `dotnet.d.ts`) → no transpile; the package `index.d.ts` re-exports it
  with `export *` **plus** `export { default }`. Specifier = physical path with the trailing
  `.d.ts` stripped (extensionless), so TS re-appends `.d.ts` and resolves correctly **even when
  fingerprinted** (`dotnet.<hash>` → `dotnet.<hash>.d.ts`), preferring `.d.ts` over a sibling `.js`.
- **Emit produces no `.d.ts`** for a `.ts` target → warn naming the file and **skip that
  entrypoint**; the others still generate.
- **Cost** — each `.ts` entrypoint spins up its own single-file `Program` (a fresh checker). Fine
  at today's count (one, `typeshim`); if entrypoints multiply, batch into a single multi-root
  `Program` rather than paying checker startup per file.

## Discovery (manifest-driven, no hardcoding)

In `buildStart`, after the VFS is built:

1. Enumerate clean (unhashed) virtual routes from the VFS/manifest; keep those ending in
   `.ts`/`.d.ts` (also `.mts`/`.cts`/`.d.mts`).
2. Per route: `specifier` = route minus TS extension; `physicalPath` via the existing
   `AssetResolver` (handles fingerprints). Precedence when a base has both: **`.d.ts` > `.ts`**.
3. Group by package (first segment) → one `package.json` per package with all subpaths.

Today this yields `typeshim` (and `_framework/dotnet` the moment the .NET build emits its
`dotnet.d.ts` — currently absent, which is why dotnet has no editor types yet). New entrypoints
appear automatically; nothing is hardcoded.

## When codegen runs

- **`buildStart` (universal hook)** — verified to fire for both `vite build` and `vite dev`
  (Vite calls `pluginContainer.buildStart()` once on server `listen`, before serving). Equivalent
  dev triggers exist for webpack/rspack (`run`/`watchRun`) and esbuild (`onStart`). Written every
  run; self-heals; rewrites absolute paths per environment.
- Files are written to the **consumer/bundler root's** `node_modules`, not `projectRoot`. All
  writes are wrapped in `try/catch`; a failure (e.g. read-only `node_modules`) **logs a warning and
  continues** rather than failing the build.
- **Consumer root is bundler-specific** (no uniform unplugin API); resolved in the framework hooks
  the plugin already branches into:

  | Family | Root source |
  |---|---|
  | Vite | `configResolved(c)` → `c.root` |
  | Webpack / Rspack / Rsbuild | `compiler.options.context` |
  | esbuild / bun | `initialOptions.absWorkingDir ?? process.cwd()` |
  | Rollup / Rolldown | `process.cwd()` (no root concept) |
  | Farm | `config.root` |

  Write to `<root>/node_modules`; if absent, walk up to the nearest ancestor `node_modules`. Node
  resolves up the tree, so any ancestor `node_modules` on the entry files' path works — covering
  hoisted monorepos and pnpm's isolated layout without needing "the one true root."

## TypeScript dependency

`typescript` is already a **direct dependency** (`^5.5.0`), so it is present whenever the plugin
is — no optional-peer dance, no regex fallback. Emit resolves TypeScript from the **consumer's**
`node_modules` (via `createRequire` at the consumer root) so the emitted `.d.ts` matches the
consumer's language version; if it is not resolvable there, emit warns once and skips — there is no
fallback to the plugin's own copy. TS is **not** bundled/vendored (size + version skew).

- **Declaration emit produces no output for a target** → log a warning naming the file and **skip
  that entrypoint** (still generate the others).

A skipped entrypoint simply falls back to today's behavior (unresolved import / no editor types)
rather than emitting a possibly-wrong shim.

## Edge cases

- **Yarn PnP** — no `node_modules` exists (deps resolve via `.pnp.cjs`), so the magic-package
  scheme cannot apply. Detect via `process.versions.pnp` / a root `.pnp.cjs`; **warn once and
  skip**. Build-time resolution is unaffected; editor types degrade to today's behavior. (Yarn
  Classic and Berry with `nodeLinker: node-modules` have a real tree and work normally.)
- **`npm ci` / installs wipe `node_modules`** — generated shims vanish, causing a **temporary lapse
  in editor types** until the next build regenerates them. Accepted.
- **`export =` (CJS) target** — carried through by declaration emit; consumers need
  `esModuleInterop`. Not produced by .NET's ESM generators anyway.
- **Vite dep pre-bundling** — the `pre` `resolveId` should intercept the bare specifiers before
  the optimizer; if the `types`-only packages trip it, neutralize with `optimizeDeps.exclude`.

## Scope

**v1**
- Bare-specifier switch in sample + docs.
- `type-shims` module: discover → emit `.d.ts` → write, wired into `buildStart` after VFS build.
- Consumer-root resolution per bundler (table under *When codegen runs*).

**Later / parked**
- **Live refresh in a running dev session** — Vite `configureServer` + manifest watcher re-running
  codegen on change (`buildStart` fires only once per server start).
- **No-bundler-process case** (IDE only, fresh checkout before any build) — shims persist from the
  last run; optionally a standalone generate CLI for `postinstall`/`predev`/CI priming.
