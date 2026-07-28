# Virtual-Module Dev Resolution Plan

Goal: make dev-server hot reload survive .NET **fingerprint** changes, where framework
asset files (`dotnet.<hash>.js`, `*.wasm`, `*.dat`, `*.dll`) relocate on disk on every
library rebuild. Today the webpack family resolves the stable specifier straight to the
**physical fingerprinted path**, so the module identity carries the hash. When the hash
moves, webpack (dev `cache: 'memory'`) restores the importer from its module cache, never
re-resolves, and the browser keeps requesting deleted paths.

## Core idea

Give every framework module a **fingerprint-independent identity** (a virtual id keyed on
its canonical route) and supply its contents through a `load` hook that:

1. re-resolves the canonical route to the **current** physical file on every run,
2. registers that physical file via `addWatchFile` (→ webpack `this.addDependency`), so a
   hash change invalidates _this stable-identity module_ and re-runs `load` — no
   re-resolution of the importer required, and
3. for JS, **canonicalizes sibling specifiers** in the emitted source
   (`./dotnet.runtime.<hash>.js` → `./dotnet.runtime.js`) so child edges are also
   hash-free and the whole subtree stays stable; for binaries, returns a URL-proxy module
   that re-imports the current physical asset (which the existing `asset/resource` rule
   turns into a fresh hashed URL).

This converts webpack's unsupported "re-resolve on external change" into the fully
supported "re-run a loader when its declared dependency changes", and matches the
`resolveId` + `load` shape the rollup/esbuild/farm families already use.

Key facts established during investigation:

- The framework entry imports its siblings by **relative, fingerprinted** specifiers
  (`import * as x from "./dotnet.runtime.<hash>.js"`, `import w from "./x.<hash>.wasm"`),
  with runtime `import()` calls marked `/*! webpackIgnore: true */` (out of scope).
- unplugin's webpack `load` loader maps `addWatchFile → loaderContext.addDependency` and
  decodes ids off `plugin.__virtualModulePrefix`; `\0`-prefixed ids are
  `encodeURIComponent`-ed through its VirtualModulesPlugin.
- The `.NET` assets live **out of tree** (not `node_modules`), so `snapshot.managedPaths`
  / immutable-paths are NOT the blocker.

Scope guard: the virtual path is **dev-only** (`isServe`). Production builds keep the
current physical-path + `asset/resource` behavior (content hashes are stable per build).

---

## Phase 0 — Shared groundwork (resolver + rewriter)  ✅ DONE

Prereq for every family; no bundler wiring yet.

- [x] **0.1 Verify manifest coverage.** Confirmed: fingerprinted endpoints carry a `label`
      property = the canonical fully-qualified route (e.g. `_framework/dotnet.runtime.js`);
      canonical endpoints have none. The manifest is authoritative — no filename heuristic
      needed. NOTE: .NET fingerprints are base36 and **can be all-letters** (e.g.
      `tgzcelqpkb`), so charset/length hash-stripping is unsound; manifest `label` is the
      only correct source.
- [x] **0.2 `AssetResolver.canonicalRoute(source): string | null`.** Added; probes the
      endpoint lookup (via `ExtensionProbes`) and returns `match.label ?? probe` (canonical
      route for fingerprinted endpoints, the probe itself for canonical ones). Unit-tested
      (fingerprinted JS/binary, all-letters fingerprint, extensionless entry, dot-segment
      collapse, unknown/empty → null).
- [~] **0.3 Rewriter sibling canonicalization.** SUPERSEDED. Rather than rewriting sibling
      specifiers in the emitted source, the webpack family re-roots relative sibling
      imports against the importer's canonical route in `resolveId` and canonicalizes each
      via `canonicalRoute`. The virtual identity (not the source text) is what stays
      hash-free, so no rewriter option was needed. Rewriter left at its original signature.
- [x] **0.4 Constants.** Added `VIRTUAL_ROUTE_PREFIX = '\0dotnet-wasm:'` and
      `VIRTUAL_ROUTE_ID_REGEX` (used as the `load` filter).
- [x] **0.5 Reuse check.** `buildNewUrlAssetProxyModule` is sufficient for the binary proxy.

Exit criteria: ✅ unit tests green (183), `tsc --noEmit` clean, lint clean.

---

## Phase 1 — webpack family  ✅ DONE

Files: `src/unplugin/families/webpack-family.ts`, `src/unplugin/index.ts` (family override).
Fixture: `test/fixtures/browser/library-app-webpack`.

- [x] **1.1 Override `resolveId` for the webpack family.** `resolveId(source, importer)`:
      in `isServe`, relative siblings from a virtual importer are re-rooted against the
      importer's route (`_virtual_` lives at project root, so `./x` would otherwise lose
      `_framework/`); the route is canonicalized (`canonicalRoute`) and recognized framework
      JS/binaries return `VIRTUAL_ROUTE_PREFIX + canonicalRoute`. Everything else → `null`.
      Build mode: unchanged physical path.
- [x] **1.2 Add `load` handler.** For `VIRTUAL_ROUTE_PREFIX` ids: strip prefix → resolve
      canonical route → current physical, `addWatchFile(physical)`, then binary →
      `buildNewUrlAssetProxyModule`; JS → `readFile` + `rewriter.rewrite`. **Self-healing:**
      if the physical was deleted mid-rebuild (stale resolver due to watcher ordering), it
      catches `ENOENT`, calls `ctx.reinitialize()`, and re-resolves once — so watcher
      ordering can no longer crash the dev server.
- [x] **1.3 Reconcile existing rules.** Kept `binaryRule` (`asset/resource`) for the proxy's
      inner physical import and `jsParserRule` (`parser.url:false`) for physical build JS.
      Added `virtualJsParserRule` (`test: /_virtual_.*dotnet-wasm/`, `parser.url:false`) so
      `new URL()` in virtual framework JS is left intact exactly as in build mode (without
      it webpack tried to resolve `new URL('dotnet.native.wasm', …)` and errored).
- [x] **1.4 Retire dev-only workarounds** (`unsafeCache` opt-out, `watchContentRoots`
      context-deps) — removed. Kept the `ManifestWatcher → reinitialize → invalidate()` nudge.
- [x] **1.5 Verify `\0` id round-trips** through unplugin's VirtualModulesPlugin — confirmed
      (`load` filter needed, else it forces `type:'javascript/auto'` on all modules and
      breaks html-webpack-plugin child compilations).
- [x] **1.6 Live test.** Verified: dev server serves all virtual framework modules; a
      real fingerprint change (edit `Counter.cs` → `build:library:fingerprint`) reinitializes
      the resolver and recompiles **without crashing** — the earlier crash exposed and fixed
      the watcher-ordering race (1.2 self-heal).
- [x] **1.7 Build-mode regression.** `npm run build` on the fixture emits correct hashed
      asset URLs (`buildexit=0`).

Exit criteria: ✅ webpack dev hot reload survives a fingerprint change; build output intact;
`pnpm format`, `pnpm lint`, `tsc --noEmit`, `pnpm build:plugin` clean.

---

## Phase 2 — rspack + rsbuild (same family)

webpack/rspack/rsbuild share `createWebpackFamily`, so 1.x largely carries over.

- [ ] **2.1 rspack** fixture (`library-app-rspack`) dev + build, fingerprint change.
- [ ] **2.2 rsbuild** fixture (`library-app-rsbuild`) dev + build, fingerprint change.
      Note rsbuild's config path is `modifyRspackConfig` + `onBeforeStartDevServer`; ensure
      the `resolveId`/`load` override applies (it flows through the shared plugin object).
- [ ] **2.3** If rspack's public `invalidateWithChangesAndRemovals` can sharpen invalidation
      vs the generic nudge, adopt it (rspack-only; webpack has no public equivalent).

Exit criteria: rspack + rsbuild dev reload survive fingerprint change; builds intact.

---

## Phase 3 — rollup family (rollup / vite / rolldown)

Files: `src/unplugin/families/rollup-family.ts`, shared `src/unplugin/families/virtual-resolution.ts`.

- [x] **3.1 Assess necessity.** CONFIRMED broken: the family had no `resolveId`, so it fell
      through to `base.resolveId` → physical fingerprinted JS path baked into vite's module
      graph. Binaries were already hash-free via the connect middleware; only framework JS
      carried the fingerprint.
- [x] **3.2 Virtual-id JS handling.** Added a family `resolveId` (dev-only) that delegates to
      the shared `resolveFrameworkId(ctx, source, importer, { binaryAsVirtual: false })` — JS →
      virtual id, binaries → physical (existing middleware `load` path kept). Widened `load`
      (filter = virtual-id OR binary regex) to branch: virtual JS → shared `readVirtualModule`
      (readFile + rewrite + addWatchFile physical & manifests); binary → unchanged
      `buildLiteralPathExportModule`. Vite-specific: `invalidateVirtualModules(server)` drops
      cached transforms of `\0dotnet-wasm:` modules from `server.moduleGraph` before
      `full-reload` (virtual modules have no mtime). Production build path untouched
      (`ROLLUP_FILE_URL`). Dev-reload scoped to vite (rolldown/rollup have no dev server).
- [ ] **3.3** E2E: vite fixture dev + fingerprint change (verify no stale/404); rollup +
      rolldown build regression.

**Dedup:** shared `virtual-resolution.ts` now holds `importerVirtualRoute`, `resolveFrameworkId`,
`readVirtualModule`, `getManifestWatchPaths`, `LoadHandlerContext`; both webpack-family and
rollup-family consume it (webpack: `binaryAsVirtual:true`; rollup: `false`).

Exit criteria: three bundlers verified; no regression to the currently-working vite path.


---

## Phase 4 — esbuild family (esbuild / bun)

Files: `src/unplugin/families/esbuild-family.ts`. Uses `onResolve` (proxy namespace) +
`onLoad`.

- [ ] **4.1** Map the virtual-id concept onto esbuild's namespace model: `onResolve` returns
      a stable namespaced id, `onLoad` re-resolves to current physical + `watchFiles` (esbuild
      rebuild watch), canonicalizing siblings for JS.
- [ ] **4.2** Confirm esbuild's incremental/watch picks up out-of-tree `watchFiles` changes.
- [ ] **4.3** Test esbuild + bun fixtures, fingerprint change.

Exit criteria: esbuild + bun verified.

---

## Phase 5 — farm family

Files: `src/unplugin/families/farm-family.ts`.

- [ ] **5.1** Apply the resolveId + load virtual-id approach per farm's hook semantics.
- [ ] **5.2** Test farm fixture, fingerprint change.

Exit criteria: farm verified.

---

## Phase 6 — Full matrix + cleanup

- [ ] **6.1** Run the E2E matrix for both fingerprint modes:
      `pnpm test:matrix -- --fingerprint=true  --build-mode=debug`
      `pnpm test:matrix -- --fingerprint=false --build-mode=debug`
      plus a publish-mode pass to guard build output.
- [ ] **6.2** Remove dead code left from the invalidate/unsafeCache experiments if fully
      superseded; keep the manifest-watcher nudge.
- [ ] **6.3** Update `/memories/repo/dev-server-reload-protocol.md`: mark unsafeCache +
      bare `invalidate()` as INSUFFICIENT, record the virtual-module resolution as the
      working approach.
- [ ] **6.4** `pnpm format` + `pnpm format:check` + `pnpm lint` + `pnpm typecheck` green.

---

## Risks / open questions

- **Manifest coverage of SDK siblings** (0.1) — the whole canonicalization scheme depends
  on it; filename-pattern fallback exists but is less robust.
- **`\0` id through webpack VirtualModulesPlugin** (1.5) — encode/decode round-trip.
- **Binary URL freshness** — the proxy's inner physical import must re-emit a new hashed
  URL each rebuild; verify the emitted URL actually changes.
- **vite already-works** (3.1) — don't regress a working dev path chasing uniformity.
- **Per-bundler watch of out-of-tree files** — esbuild/farm must observe changes to files
  outside the project root.

---

## Where we start

**Phase 1 — the webpack family** (after the small Phase 0 resolver/rewriter groundwork it
depends on). webpack is the bundler where the bug is confirmed and reproducible, it's the
family that currently diverges most from the `load`-based pattern, and rspack + rsbuild
(Phase 2) inherit the same `createWebpackFamily` implementation — so fixing webpack first
delivers three of the nine bundlers and validates the whole approach before we touch the
already-working rollup/vite path.
