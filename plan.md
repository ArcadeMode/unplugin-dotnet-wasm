# Engineering Specification: `unplugin-dotnet-static-assets`

## 1. Mission

A .NET WebAssembly project produces static web assets in **one of two shapes**:

1. **Scattered** — typical after `dotnet build`. Files live across `wwwroot/`, `bin/<tfm>/wwwroot/`, intermediate `obj/`, NuGet caches, and SDK runtime packs. A manifest, `{Project}.staticwebassets.runtime.json`, glues them into a single virtual tree.
2. **Consolidated** — typical after `dotnet publish` (or a hand-staged copy). Every file already lives side-by-side under one output directory. No runtime manifest is required to resolve them.

This plugin handles **both** shapes, presenting them to JavaScript bundlers (Vite, Webpack, Rollup, esbuild, Rspack) — and to the developer's editor — as a single coherent directory, and serving them in dev with the response headers the production runtime expects.

> **One-liner:** Mount .NET static-web-assets output (scattered *or* consolidated) as a virtual module namespace, with optional production-fidelity headers, preload hints, and Subresource Integrity.

## 2. Operating Modes

| Aspect                          | **Mode A — Manifest** *(dev / build)*                              | **Mode B — Consolidated** *(release / publish)*                     |
|---------------------------------|--------------------------------------------------------------------|---------------------------------------------------------------------|
| Trigger                         | After `dotnet build`                                               | After `dotnet publish`, or manual stage                             |
| File layout                     | Scattered across several physical directories                      | Single output directory                                             |
| Runtime manifest                | **Required** — `{Project}.staticwebassets.runtime.json`            | **Absent** — files are already collocated                           |
| Endpoints manifest              | **Optional** — `{Project}.staticwebassets.endpoints.json`          | **Optional** — published alongside the assets                       |
| VFS / cross-root resolution     | Yes (core feature)                                                 | Not needed                                                          |
| File watching                   | All `ContentRoots` watched, debounced re-read of manifest          | Single directory watched                                            |
| IDE `paths` / `.d.ts` emission  | Yes (different physical roots confuse the language service)        | Not needed                                                          |
| Dev-server headers from endpoints | Yes                                                              | Yes                                                                 |
| Preload / SRI emission          | Yes                                                                | Yes                                                                 |
| Boot-manifest rewrite on hashing | Yes                                                               | Yes                                                                 |

### 2.1 Mode detection

The plugin does **not** expose a `mode` switch. The active mode is determined by what discovery finds on disk:

- `{Project}.staticwebassets.endpoints.json` is **always required** and is what discovery anchors on.
- If `{Project}.staticwebassets.runtime.json` exists as a sibling → **Mode A**. The VFS is built from the runtime manifest's tree.
- If it does not → **Mode B**. The VFS is seeded from `Endpoints[].AssetFile` rooted at the directory containing the endpoints manifest (typically a `dotnet publish -o <dir>` output).

The choice between modes is therefore a function of which `dotnet` command produced the artefacts, not a plugin option. The typical wiring is in the bundler config: a dev config lets discovery walk `<projectRoot>/bin/<Configuration>/<TargetFramework>/` (Mode A); a prod config passes `manifestPath` pointing into the publish output (Mode B). Same options shape, same code path — only the input directory differs.

### 2.2 Build configuration & target-framework discovery

`.NET` writes its outputs to `bin/<Configuration>/<TargetFramework>[/publish]/…`, so any search under `bin/` faces three orthogonal axes:

| Axis              | Examples                       | Source of truth                                                                          |
|-------------------|--------------------------------|------------------------------------------------------------------------------------------|
| Configuration     | `Debug`, `Release`, `Staging`  | `options.configuration` ▸ `process.env.DOTNET_CONFIGURATION` ▸ bundler mode ▸ `Debug`    |
| Target framework  | `net8.0`, `net9.0`             | `options.targetFramework` ▸ unique match ▸ fail                                          |

*(There is no "Build vs Publish" axis. Publish outputs are addressed by passing `manifestPath` directly; discovery only deals with the `bin/<Configuration>/<TargetFramework>/` layout that `dotnet build` produces.)*

Resolution proceeds top-down, first hit wins:

1. **Explicit override.** If `options.manifestPath` is set, use its containing directory verbatim — no globbing, no ranking. The runtime manifest at that path may or may not exist (it won't, for a publish output); the endpoints manifest sibling **must**.
2. **Tight candidate path.** Construct `<projectRoot>/bin/<configuration>/<targetFramework>/` from whatever options are provided. Look there for `{ProjectName}.staticwebassets.runtime.json` and `{ProjectName}.staticwebassets.endpoints.json`.
3. **Loose search.** If any axis is unset, scan `<projectRoot>/bin/**` for candidates and **rank**:
   1. exact `configuration` match (case-insensitive);
   2. exact `targetFramework` match;
   3. **mtime descending** ("most recently built") as the final tiebreaker.
4. **Hard fail** with the enumerated candidate list when the top two are still indistinguishable, or when a required axis is ambiguous (e.g. multi-TFM project with no `targetFramework` set). Same posture as `dotnet run` on a multi-target project.

#### Default `configuration` resolution

In order, first hit wins:

1. `options.configuration`
2. `process.env.DOTNET_CONFIGURATION`
3. Bundler mode signal — Vite `config.mode === 'production'` or Webpack `mode: 'production'` → `Release`; otherwise `Debug`.
4. Fallback `Debug` (matches `dotnet build` default).

#### Staleness guard

Developers regularly switch between `dotnet build` and `dotnet build -c Release`. If the chosen manifest's mtime is **older than another sibling found under `bin/`**, the plugin logs a warning at `logLevel >= warn`:

> `[dotnet-static-assets] Using Debug/net8.0 manifest (mtime 2026-06-25 11:02:14), but Release/net8.0 was built more recently (mtime 2026-06-25 14:09:41). Set { configuration: 'Release' } or DOTNET_CONFIGURATION=Release to switch.`

This catches the "why is the browser still serving yesterday's `.wasm`" class of bug without silently changing behavior.

#### `dotnet watch` interaction

`dotnet watch` rebuilds in place under the same `bin/<cfg>/<tfm>/` leaf. The plugin's manifest watcher (100 ms debounce, re-parse) handles it transparently — no special path needed.

## 3. Manifest A — `{Project}.staticwebassets.runtime.json`

Maps **virtual paths** to physical files spread across several **content roots**.

```jsonc
{
  "ContentRoots": [
    "C:\\Projects\\TypeShim\\sample\\Library\\wwwroot\\",        // index 0 — source
    "C:\\Projects\\TypeShim\\sample\\Library\\bin\\wwwroot\\"     // index 1 — build output
  ],
  "Root": {
    "Children": {
      "main.ts":      { "Asset": { "ContentRootIndex": 0, "SubPath": "main.ts" },      "Children": null, "Patterns": null },
      "package.json": { "Asset": { "ContentRootIndex": 0, "SubPath": "package.json" }, "Children": null, "Patterns": null },
      "_framework": {
        "Asset": null,
        "Patterns": null,
        "Children": {
          "dotnet.d.ts":        { "Asset": { "ContentRootIndex": 0, "SubPath": "_framework/dotnet.d.ts" },        "Children": null, "Patterns": null },
          "dotnet.js":          { "Asset": { "ContentRootIndex": 1, "SubPath": "_framework/dotnet.js" },          "Children": null, "Patterns": null },
          "dotnet.native.wasm": { "Asset": { "ContentRootIndex": 1, "SubPath": "_framework/dotnet.native.wasm" }, "Children": null, "Patterns": null },
          "Library.wasm":       { "Asset": { "ContentRootIndex": 1, "SubPath": "_framework/Library.wasm" },       "Children": null, "Patterns": null }
          /* ...all framework assemblies, ICU data, runtime JS, etc. */
        }
      }
    },
    "Asset": null,
    "Patterns": [ { "ContentRootIndex": 0, "Pattern": "**", "Depth": 0 } ]
  }
}
```

Schema rules:
- `ContentRoots: string[]` — absolute directory paths. Referenced by **index**.
- `Root: Node` — recursive tree keyed by virtual path segment.
- `Node.Children: Record<string, Node> | null`.
- `Node.Asset: { ContentRootIndex: number; SubPath: string } | null` — leaf binding: resolve via `join(ContentRoots[ContentRootIndex], SubPath)`.
- `Node.Patterns: Array<{ ContentRootIndex: number; Pattern: string; Depth: number }> | null` — glob fall-through for files not enumerated explicitly.

### 3.1 The critical observation

Virtual siblings routinely originate from **different physical roots**:

| Virtual path                       | Physical root                                          | Source        |
|------------------------------------|--------------------------------------------------------|---------------|
| `_framework/dotnet.d.ts`           | `…/Library/wwwroot/_framework/dotnet.d.ts`             | ContentRoot 0 |
| `_framework/dotnet.js`             | `…/Library/bin/wwwroot/_framework/dotnet.js`           | ContentRoot 1 |
| `_framework/dotnet.native.wasm`    | `…/Library/bin/wwwroot/_framework/dotnet.native.wasm`  | ContentRoot 1 |
| `main.ts`                          | `…/Library/wwwroot/main.ts`                            | ContentRoot 0 |

`import './_framework/dotnet.js'` from `main.ts` fails naively because the bundler walks the **physical** filesystem and never finds `bin/wwwroot/_framework/dotnet.js` as a sibling of `wwwroot/main.ts`. The manifest tells us they **should** be siblings.

### 3.2 Resolution algorithm (Mode A)

The VFS describes **only what the manifest declares to be virtual**. Everything else — unlisted files, source-tree files, `node_modules`, the consuming project — is the host bundler's problem and is reached through its native resolver.

Given a request `source` (the importer is *not* consulted; see the rationale below):

1. **Normalise.** Strip a leading `./` and any leading `/`; convert to POSIX; lowercase for the lookup key.
2. **Endpoint route alias (exact-path case).** If the endpoints manifest is available, probe the precomputed `Map<route, EndpointMatch>` (see §4) with the normalised key. On hit, replace the lookup key with the matching `AssetFile` before continuing — this is what lets already-extension-qualified specifiers like `_framework/Library.wasm` resolve to fingerprinted physical files like `_framework/Library.9mhy6srgqs.wasm`.
3. **Flat map lookup.** Probe the precomputed `Map<virtualPath, ResolvedAsset>` built from every explicit `Asset` node in the manifest tree.
4. **Extension / index probing (bare specifiers only).** If `source` has no file extension, for each candidate `resolveExtensions` suffix: (a) probe the flat VFS map with `${source}${ext}`; (b) **if that misses, also probe the endpoint map with `${source}${ext}` and if found, resolve `assetFile` via steps 3+6 below**. Repeat for `${source}/index${ext}` variants.
5. **Pattern fallthrough.** For each `Patterns` entry whose virtual prefix matches `source`, `statSync` the candidate physical path `join(ContentRoots[i], source)` once. Bare specifiers retry per probe extension and per `index.<ext>` suffix. **Successful hits are cached back into the map** so subsequent calls are O(1); negative results are not cached so a file dropped between rebuilds is picked up the next call. **There is never a directory scan** — only targeted single-file stats.
6. **Endpoint-aliased FS fallback.** If step 2 or step 4(b) produced an endpoint alias but steps 3–5 all missed (the aliased asset file is not in the VFS flat map and not covered by a pattern), `statSync` `join(ContentRoots[i], assetFile)` for each content root in declaration order; first hit wins. This covers fingerprinted physical files that live in the build-output content root but are not enumerated by the runtime manifest's `Asset` tree.
7. **Miss → hand back to the bundler.** Return `undefined`. The bundler's native resolver then walks relative to the importer's physical directory, which is the right behaviour for everything that isn't a static-web-asset (consuming-project imports, `node_modules`, sibling build-output files imported from within the same build-output directory).

**Why the importer is not consulted.** When `import './_framework/dotnet.js'` runs from `wwwroot/main.ts`, the plugin's only contribution is *"is `_framework/dotnet.js` a virtual path in the manifest?"* — the answer is yes, and it returns the absolute path the manifest points at. From that point on, `dotnet.js` (now a real file on disk) does its own `import './dotnet.native.wasm'` and the bundler resolves it natively against `dotnet.js`'s physical directory. The plugin only re-engages when another virtual lookup is asked for. This keeps the plugin a pure overlay and avoids fighting the bundler for ownership of relative-path semantics.

**`.ts` shadows `.d.ts`.** If steps 2–3 yield both a `.ts`/`.tsx` *and* a sibling `.d.ts` for the same bare specifier, the implementation file wins for the bundler **and** the language service (the emitted `paths` entry lists it first). A `debug`-level warning is logged once per shadowed pair. The lone `.d.ts + .js` pair seen with framework files (`_framework/dotnet.d.ts` + `_framework/dotnet.js`) is the happy path and is left alone.

Casing: **case-insensitive lookup, case-preserving emit**. Defuses Windows ↔ Linux drift without breaking strict-case servers.

In Mode B (no runtime manifest) the VFS is seeded directly from `Endpoints[].AssetFile`, rooted at the directory containing the endpoints manifest. Virtual path equals physical path under that root. The same resolver API is used so consumers don't see a mode-shaped seam.

## 4. Manifest B — `{Project}.staticwebassets.endpoints.json`

Describes how each asset should be **served**: response headers, SRI hashes, preload hints, and fingerprinted route aliases.

```jsonc
{
  "Version": 1,
  "ManifestType": "Publish",
  "Endpoints": [
    {
      "Route": "_framework/dotnet.js",
      "AssetFile": "_framework/dotnet.js",
      "Selectors": [],
      "ResponseHeaders": [
        { "Name": "Cache-Control",  "Value": "no-cache" },
        { "Name": "Content-Type",   "Value": "text/javascript" },
        { "Name": "Content-Length", "Value": "43564" },
        { "Name": "ETag",           "Value": "\"BqcJQCHF/tRYHsPMFejbRtAPQUigYxtlR9waMKisfH0=\"" },
        { "Name": "Last-Modified",  "Value": "Thu, 25 Jun 2026 14:09:41 GMT" }
      ],
      "EndpointProperties": [
        { "Name": "PreloadAs",          "Value": "script" },
        { "Name": "PreloadCrossorigin", "Value": "anonymous" },
        { "Name": "PreloadGroup",       "Value": "webassembly" },
        { "Name": "PreloadOrder",       "Value": "1" },
        { "Name": "PreloadPriority",    "Value": "high" },
        { "Name": "PreloadRel",         "Value": "preload" },
        { "Name": "integrity",          "Value": "sha256-Bqc…fH0=" }
      ]
    },

    // Fingerprinted variant — same asset, immutable cache:
    {
      "Route": "main.58dhsr9ua1.js",
      "AssetFile": "main.js",
      "Selectors": [],
      "ResponseHeaders": [
        { "Name": "Cache-Control", "Value": "max-age=31536000, immutable" },
        { "Name": "Content-Type",  "Value": "text/javascript" },
        { "Name": "ETag",          "Value": "\"y6rVIFW1mLuoTKbJp7q5WBr5fFz3ar1zKLWIRDK4Hk0=\"" }
      ],
      "EndpointProperties": [
        { "Name": "fingerprint", "Value": "58dhsr9ua1" },
        { "Name": "integrity",   "Value": "sha256-y6rVIFW1mLuoTKbJp7q5WBr5fFz3ar1zKLWIRDK4Hk0=" },
        { "Name": "label",       "Value": "main.js" }
      ]
    }
  ]
}
```

### 4.1 Schema rules

- `Version` — currently `1`.
- `ManifestType` — `"Build"` or `"Publish"`. Informational; both shapes are accepted.
- `Endpoints[].Route` — public-facing URL path (relative). The **same `AssetFile` may have multiple routes** (canonical + fingerprinted variants).
- `Endpoints[].AssetFile` — path under the asset output. Joined against the active content root in Mode A, against the endpoints manifest's directory in Mode B.
- `Endpoints[].Selectors` — content-negotiation hints (e.g. `Accept-Encoding: br`). Often empty; the parser must accept them.
- `Endpoints[].ResponseHeaders` — applied verbatim by the dev middleware, with sensible overrides for stale `Content-Length` / `Last-Modified` when the file has been edited.
- `Endpoints[].EndpointProperties` — non-header metadata. The plugin recognises:
  - `integrity` → Subresource Integrity (SRI) hash.
  - `fingerprint`, `label` → fingerprinted-route bookkeeping.
  - `PreloadAs`, `PreloadCrossorigin`, `PreloadGroup`, `PreloadOrder`, `PreloadPriority`, `PreloadRel` → `<link rel="preload">` generation.
  - Unknown properties are kept verbatim and exposed to user hooks.

### 4.2 Plugin use cases

1. **Dev middleware headers** — serve every request with the exact `Content-Type` / `Cache-Control` / `ETag` the production runtime would see, so the .NET loader behaves identically in dev and prod. Stream bytes from the physical file; rewrite stale `Content-Length` automatically.
2. **Preload emission** — when the host generates HTML, inject `<link rel="preload" as="script" crossorigin="anonymous" integrity="…" fetchpriority="high">` for entries in `PreloadGroup: webassembly`, ordered by `PreloadOrder`.
3. **Integrity propagation** — surface SRI hashes so the bundler can attach `integrity="…"` to emitted `<script>` / `<link>` tags.
4. **Fingerprint awareness** — recognise both `main.js` and `main.<hash>.js` as the same `AssetFile`. The resolver consumes this alias (§3.2 steps 2 and 4b, implemented in M1.7) so consumer imports use canonical names while physical files on disk carry fingerprints. In Mode B, prefer the immutable fingerprinted route in production HTML; expose the canonical route for tooling.

### 4.3 Known oddities

- .NET sometimes assigns `Content-Type: video/vnd.dlna.mpeg-tts` to `.d.ts` files (an MPEG-TS / TypeScript MIME clash). The plugin keeps a small override table for well-known offenders (`.d.ts → text/plain`, `.map → application/json`) — opt-out via `respectAllEndpointHeaders: true`.
- `Content-Length` and `Last-Modified` can be stale during hot-edit; recompute from the file system in dev.

## 5. Developer Experience — Why the Virtual View Matters Beyond the Bundler

Mode A is not only a bundler adapter; it must reconstruct the virtual directory faithfully enough that **everyday editor tooling works**:

- `import { dotnet } from './_framework/dotnet.js'` from `main.ts` **resolves**, even though `dotnet.js` is in a different physical folder.
- **Go to Definition** on `dotnet` jumps to `_framework/dotnet.d.ts` (another physical root).
- **Find References**, **Rename**, **Hover Types**, **Autocomplete** all behave as if `_framework/` were a single real folder.
- A developer browsing the project sees **one coherent `_framework/` listing**, not two half-empty mirrors of source vs. build output.
- **Navigate To File** (`Ctrl+P`) lists `_framework/Library.wasm` once, at its virtual path.

To deliver this, the plugin (Mode A only) emits a tiny set of TypeScript helper files. **Quiet by default — nothing lands in the user's source tree.**

#### Quiet-emission contract

1. **Default target is `node_modules/.dotnet-vfs/`**, mirroring the convention used by Vite (`node_modules/.vite/`), esbuild (`node_modules/.cache/esbuild/`), and Prisma (`node_modules/.prisma/`). `node_modules` is already gitignored everywhere, gets wiped by `npm ci`, and never appears in PRs.
2. **Mode flips clean up after themselves.** When the active mode is `consolidated`, or when discovery finds no manifest, the plugin **deletes** `node_modules/.dotnet-vfs/` on the next run. No stale artifacts surviving a `dotnet publish`.
3. **The user's `tsconfig.json` is never auto-patched.** The plugin emits a self-contained tsconfig into its cache directory; the user opts in with a single `extends` line they add themselves. The plugin logs **one** info-level hint on first run if the opt-in is missing; never warns again.
4. **Opt-in escape hatches** exist for users who *want* the artifacts visible (e.g. to commit a snapshot for offline reviewers). When `vfsOutDir` points inside the source tree, the plugin auto-writes a marked block into the nearest `.gitignore` unless `vfsGitignore: false`.
5. **Builds work either way.** The emitted files only affect the TypeScript language service / editor; the bundler graph never depends on them.

#### Emitted directory layout

```text
node_modules/.dotnet-vfs/
├─ tsconfig.json        # extends-friendly; `paths` populated from the active manifest
├─ dotnet-vfs.d.ts      # ambient shims for binary URL imports (.wasm, .dat, .pdb, …)
├─ manifest.snapshot    # sha256 + mtime of the source manifests — staleness check
└─ .gitignore           # contains "*"; belt-and-braces for any tooling that escapes node_modules
```

`tsconfig.json` contents (worked example for the TypeShim manifest):

```jsonc
// node_modules/.dotnet-vfs/tsconfig.json — generated, do not edit
{
  "compilerOptions": {
    "baseUrl": "../..",
    "paths": {
      "_framework/*": [
        "./wwwroot/_framework/*",
        "./bin/wwwroot/_framework/*"
      ]
    }
  },
  "include": ["./dotnet-vfs.d.ts"]
}
```

The user enables IDE parity with one line in their own `tsconfig.json`:

```jsonc
{
  "extends": "./node_modules/.dotnet-vfs/tsconfig.json"
}
```

If the `extends` line is absent on the first run, the plugin logs (once, at info level):

> `[dotnet-static-assets] IDE parity available. Add "extends": "./node_modules/.dotnet-vfs/tsconfig.json" to your tsconfig to enable cross-root Go-to-Definition. (Set emitTypeScriptPaths: false to silence.)`

The build still works without the opt-in; only the editor UX is degraded.

Mode B emits nothing — there's one real directory, so the IDE already sees it. If `node_modules/.dotnet-vfs/` exists from a previous Mode A run, it is removed.

## 6. Repository Layout

```
unplugin-dotnet-static-assets/
├─ src/
│  ├─ core/
│  │  ├─ manifest-runtime.ts   # Runtime (VFS) manifest types + Zod parser
│  │  ├─ manifest-endpoints.ts # Endpoints manifest types + Zod parser
│  │  ├─ discover.ts           # Auto-locate both manifests (runtime + endpoints)
│  │  ├─ vfs.ts                # Virtual filesystem: tree walk, lookup, pattern expansion (Mode A) or endpoints-seeded (Mode B)
│  │  ├─ endpoints.ts          # Headers, SRI, preload, fingerprint index
│  │  ├─ vfs-emit.ts          # Quiet IDE-parity emitter (Mode A only): node_modules/.dotnet-vfs/
│  │  └─ logger.ts
│  ├─ unplugin/
│  │  ├─ index.ts              # Shared unplugin factory (resolveId / load / watch)
│  │  ├─ emit.ts               # Per-bundler binary emission strategy
│  │  ├─ devserver.ts          # Vite/Webpack dev middleware (headers from endpoints.json)
│  │  └─ html.ts               # Preload-link / SRI injection helpers
│  ├─ vite.ts                  # Re-export wrapper
│  ├─ webpack.ts
│  ├─ rollup.ts
│  ├─ esbuild.ts
│  ├─ rspack.ts
│  └─ index.ts
├─ test/
│  ├─ fixtures/
│  │  ├─ TypeShim/             # Mode A — `dotnet build` output: scattered, runtime + endpoints manifest
│  │  └─ TypeShim-publish/     # Mode B — `dotnet publish` output: flat, endpoints manifest only
│  ├─ unit/
│  └─ integration/             # Scripted Vite/Webpack/Rollup builds per mode
├─ package.json
├─ tsup.config.ts
└─ README.md
```

`package.json` exports:

```jsonc
{
  "name": "unplugin-dotnet-static-assets",
  "type": "module",
  "exports": {
    ".":         { "types": "./dist/index.d.ts",   "import": "./dist/index.js",   "require": "./dist/index.cjs" },
    "./vite":    { "types": "./dist/vite.d.ts",    "import": "./dist/vite.js",    "require": "./dist/vite.cjs" },
    "./webpack": { "types": "./dist/webpack.d.ts", "import": "./dist/webpack.js", "require": "./dist/webpack.cjs" },
    "./rollup":  { "types": "./dist/rollup.d.ts",  "import": "./dist/rollup.js",  "require": "./dist/rollup.cjs" },
    "./esbuild": { "types": "./dist/esbuild.d.ts", "import": "./dist/esbuild.js", "require": "./dist/esbuild.cjs" },
    "./rspack":  { "types": "./dist/rspack.d.ts",  "import": "./dist/rspack.js",  "require": "./dist/rspack.cjs" }
  },
  "files": ["dist"]
}
```

## 7. Phased Execution Plan

Each phase ends with **acceptance criteria** that must pass in CI against both fixtures.

### Phase 1 — Manifest Parsers, Mode Detection, VFS

**Goal:** Parse both manifests, detect the operating mode, and expose a fast in-memory model.

Tasks:
1. Strict TypeScript types for `RuntimeManifest`, `EndpointsManifest`, plus subtypes. Validate with Zod at load time.
2. `discover({ projectRoot })` — locate `*.staticwebassets.runtime.json` and `*.staticwebassets.endpoints.json`; classify mode.
3. `buildVfs(runtime)` — flatten the tree into `Map<virtualPath, ResolvedAsset>` for O(1) lookup, the original tree for directory listings, and a compiled `Patterns` matcher.
4. `buildEndpointsIndex(endpoints)` — `Map<route, Endpoint>`, plus reverse index `Map<assetFile, Endpoint[]>` for fingerprinted-variant lookup.
5. Extension and `index.*` probing in lookup (driven by `resolveExtensions`), with the `.ts` shadows `.d.ts` rule and a one-shot debug warning per shadowed pair.
6. POSIX normalisation internally; preserve on-disk casing for emit; case-insensitive lookup keys.

**Acceptance:**
- `vfs.resolve("_framework/dotnet.d.ts")` → absolute path under `ContentRoots[0]` (Mode A fixture).
- `vfs.resolve("_framework/dotnet.js")` → absolute path under `ContentRoots[1]` (Mode A fixture).
- `vfs.resolve("wasm-bootstrap")` (extensionless) → `wasm-bootstrap.ts` from the fixture.
- `vfs.resolve("some-dir")` for a directory containing `index.ts` resolves to that file.
- A virtual path with both `foo.ts` and `foo.d.ts` resolves to `foo.ts`; a `debug`-level warning is emitted once.
- `endpoints.findByRoute("main.58dhsr9ua1.js")` returns the fingerprinted variant pointing at `main.js`.
- `endpoints.findByAsset("main.js")` returns both canonical and fingerprinted entries.
- Discovery handles both layouts: the scattered fixture yields a runtime-manifest-driven VFS (Mode A); the consolidated fixture (no runtime manifest, endpoints manifest present) yields an endpoints-seeded VFS (Mode B).
- 10 000 lookups under 50 ms.

### Phase 2 — Unplugin Core (mode-aware)

**Goal:** Single `unplugin` factory consumed by every bundler, dispatching on mode.

Tasks:
1. `resolveId(source, _importer)` — importer-blind manifest lookup in Mode A (see §3.2); plain directory lookup in Mode B. Returns `null` on miss so the host bundler's native resolver handles non-virtual paths.
2. `load(id)` — stream raw bytes for binaries; pass text through to the bundler pipeline.
3. `addWatchFile(absPath)` for every resolved asset (Mode A across all roots; Mode B under the endpoints manifest's directory).
4. Multi-target build via `tsup` (ESM + CJS) for each subpath export.

**Acceptance:**
- A Vite project where `main.ts` imports `./_framework/dotnet.js` builds without manual aliases in Mode A.
- The same project, pointed at the publish output via `manifestPath`, builds in Mode B with no other config changes (typical pattern: `mode === 'production' ? manifestPath : projectRoot + configuration` in the Vite config factory).
- Editing `bin/wwwroot/_framework/dotnet.js` invalidates the correct module in dev (Mode A).

### Phase 3 — Binary Asset Pipeline (per bundler)

**Goal:** `.wasm`, `.dat`, `.pdb`, and managed assemblies land in the output graph correctly, in both modes.

Tasks:
1. **Vite / Rollup:** `this.emitFile({ type: 'asset' })`; honour `preserveWasmFilenames` to disable hashing.
2. **Webpack / Rspack:** inject `asset/resource` rule for plugin-owned ids; mark them initial (no async split).
3. **esbuild:** register a `loader: 'file'` namespace.
4. Pre-compressed siblings (`.br`, `.gz`) — discover beside each asset and pass through.
5. When endpoints.json exposes an SRI hash, propagate it to the emitted asset's metadata so the bundler can attach `integrity="…"`.

**Acceptance:**
- `vite build` produces `dist/_framework/dotnet.native.wasm` with correct bytes; JS references point at the emitted filename.
- Webpack does **not** split `dotnet.native.wasm` into a lazy chunk.
- `.br` / `.gz` siblings ship alongside originals when present.
- Emitted `<script src="…dotnet.js">` carries the SRI hash recorded in endpoints.json.

### Phase 4 — Dev Server, Headers, Preload, Boot Manifest Rewrite

**Goal:** Production-fidelity dev loop; correct runtime boot under hashed output.

Tasks:
1. `configureServer` (Vite) / `devServer` middleware (Webpack) — for every request whose path matches an `Endpoints[].Route`, stream the corresponding `AssetFile` and apply its `ResponseHeaders` verbatim (with the stale-`Content-Length` recomputation).
2. Selectors — when present, vary the response by `Accept-Encoding` etc.
3. Preload emission — generate `<link rel=preload …>` HTML fragments from `EndpointProperties.Preload*`. Expose them via a stable hook (`getPreloadLinks()`) and, where the host bundler has an HTML pipeline (Vite `transformIndexHtml`, Webpack `HtmlWebpackPlugin`), inject them.
4. Watch all content roots (Mode A) or the endpoints-manifest directory (Mode B); invalidate on change and re-read endpoints.json on its own change (100 ms debounce).
5. `generateBundle` — if the host bundler hashes `.wasm`/`.dll` outputs, rewrite the boot manifest (`blazor.boot.json` / `mono-config.json`) so the loader's filename list matches the emitted names.
6. **IDE-parity cache (Mode A only):** when `emitTypeScriptPaths` is enabled, write `tsconfig.json`, `dotnet-vfs.d.ts`, `manifest.snapshot`, and `.gitignore` into `node_modules/.dotnet-vfs/`. On Mode B — or when the manifest disappears — remove that directory. Log the one-time `extends`-line hint at `info` level if the user's tsconfig doesn't reference it. Honour `vfsOutDir` and `vfsGitignore` for users who want the artifacts in a visible location.

**Acceptance:**
- Browser receives `Content-Type: application/wasm` for `_framework/dotnet.native.wasm` in dev.
- `_framework/dotnet.js` is served with the exact header set listed in endpoints.json (modulo recomputed `Content-Length`).
- `main.58dhsr9ua1.js` is reachable and served with `Cache-Control: max-age=31536000, immutable`; `main.js` is reachable with `Cache-Control: no-cache`.
- Generated HTML contains `<link rel="preload" as="script" crossorigin="anonymous" integrity="sha256-…" fetchpriority="high">` for the `webassembly` preload group.
- Hashed production build boots end-to-end in headless Chromium.
- **Go to Definition** in VS Code on a symbol from `_framework/dotnet.js` lands in `_framework/dotnet.d.ts`, despite the two files originating from different content roots (Mode A).
- After removing the runtime manifest (Mode A → Mode B transition), `node_modules/.dotnet-vfs/` no longer exists on the next build — no stale `paths` polluting the editor.

### Phase 5 — Documentation, Examples, Release

- Per-bundler integration snippets (Vite, Webpack, Rollup, esbuild, Rspack).
- Side-by-side recipes for **Mode A** (project root) and **Mode B** (publish folder).
- Troubleshooting playbook: case sensitivity, missing manifest, multi-project monorepo, endpoint header overrides.
- SemVer policy, changelog automation, release pipeline.

## 8. Public API

Options are a **discriminated union** of two variants:

- **Discovery** — the plugin walks `<projectRoot>/bin/<configuration>/<targetFramework>/` to find the manifests. Typical for dev / `dotnet build`.
- **Explicit** — the caller passes `manifestPath` directly. Typical for prod / `dotnet publish`, where the runtime manifest is absent and the user knows exactly where the publish output lives.

The two are **mutually exclusive**: discovery options (`projectRoot`, `configuration`, `targetFramework`) and `manifestPath` may not coexist. All other options are shared.

```ts
export type DotnetAssetsOptions =
  & DotnetAssetsBaseOptions
  & (DotnetAssetsDiscoveryOptions | DotnetAssetsExplicitOptions);

export interface DotnetAssetsBaseOptions {
  /**
   * The .NET project name. Used to construct the manifest filenames
   * (`{projectName}.staticwebassets.runtime.json` and `.endpoints.json`).
   */
  projectName: string;

  /**
   * Path to {Project}.staticwebassets.endpoints.json. Auto-discovered alongside
   * the runtime manifest / manifest directory. Pass `false` to ignore it entirely.
   */
  endpointsPath?: string | false;

  /**
   * Apply `ResponseHeaders` from endpoints.json in the dev middleware.
   * Default: true when endpoints.json is found.
   */
  applyEndpointHeaders?: boolean;

  /**
   * Pass every header from endpoints.json through unchanged, including the
   * known-broken `.d.ts → video/vnd.dlna.mpeg-tts` MIME mapping.
   * Default: false (plugin overrides a small allow-list of known offenders).
   */
  respectAllEndpointHeaders?: boolean;

  /**
   * Emit `<link rel="preload">` tags from `EndpointProperties.Preload*`.
   * Default: true when the host bundler exposes an HTML pipeline.
   */
  emitPreloadHints?: boolean;

  /**
   * Attach `integrity="…"` to emitted <script> / <link> tags from
   * `EndpointProperties.integrity`.
   * Default: true when endpoints.json is found.
   */
  emitSubresourceIntegrity?: boolean;

  /**
   * Extension probe order for extensionless imports of VFS-owned files.
   * Mirrors a TS / bundler resolve.extensions list. `index.<ext>` lookup uses the same list.
   * Default: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'].
   */
  resolveExtensions?: string[];

  /**
   * Register every resolved asset with the bundler's watcher.
   * Default: true in dev, false in build.
   */
  watch?: boolean;

  /**
   * Preserve original filenames for runtime-critical binaries
   * (.wasm, .dat, blazor.boot.json, mono-config.json).
   * Default: true.
   */
  preserveWasmFilenames?: boolean;

  /**
   * Emit IDE-parity helpers (`tsconfig.json` + `dotnet-vfs.d.ts`) so editors share
   * the virtual view. Mode A only; Mode B always cleans up any previous output.
   *
   *   'auto' — enabled in Mode A when a `tsconfig.json` is found in the project (default).
   *   true   — always enabled in Mode A.
   *   false  — never emit; remove any prior cache directory.
   */
  emitTypeScriptPaths?: boolean | 'auto';

  /**
   * Override the emission directory. Default: `<projectRoot>/node_modules/.dotnet-vfs/`.
   * If the override points inside the source tree, the plugin auto-writes a marked
   * block into the nearest `.gitignore` (see `vfsGitignore`).
   */
  vfsOutDir?: string;

  /**
   * When `vfsOutDir` is inside the source tree, append a `# unplugin-dotnet-static-assets`
   * marker block to the nearest `.gitignore`. Default: true.
   */
  vfsGitignore?: boolean;

  /** Verbosity. Default: 'warn'. */
  logLevel?: 'silent' | 'error' | 'warn' | 'info' | 'debug';
}

/**
 * Discovery variant — the plugin walks `<projectRoot>/bin/<configuration>/<targetFramework>/`
 * to locate the manifests. `manifestPath` MUST NOT be set on this variant.
 */
export interface DotnetAssetsDiscoveryOptions {
  /**
   * Absolute or workspace-relative path to the .NET project directory
   * (the one containing the .csproj). Used as the root for manifest discovery.
   */
  projectRoot: string;

  /**
   * MSBuild configuration to look under (`bin/<Configuration>/...`).
   * Default: `process.env.DOTNET_CONFIGURATION` ▸ `'Release'` when the host bundler
   * is in production mode ▸ `'Debug'`.
   */
  configuration?: string;

  /**
   * Target framework moniker (`bin/<Configuration>/<TargetFramework>/...`).
   * Required for multi-TFM projects; otherwise auto-detected.
   */
  targetFramework?: string;

  manifestPath?: never;
}

/**
 * Explicit-path variant — the caller supplies the manifest location directly.
 * Discovery options (`projectRoot`, `configuration`, `targetFramework`) MUST NOT be set.
 *
 * `manifestPath` points at `{projectName}.staticwebassets.runtime.json`. The file may or
 * may not exist on disk — absent is the normal `dotnet publish` case (Mode B). The sibling
 * endpoints manifest in the same directory is required.
 */
export interface DotnetAssetsExplicitOptions {
  manifestPath: string;

  projectRoot?: never;
  configuration?: never;
  targetFramework?: never;
}
```

Defaults are part of the public contract; changes require a major version bump.

## 9. Consumption

### 9.1 Mode A — pointing at a project root

```ts
// vite.config.ts
import DotnetAssets from 'unplugin-dotnet-static-assets/vite';

export default {
  plugins: [
    DotnetAssets({
      // runtime.json found under ./bin → Mode A is picked automatically
      projectName: 'Library',
      projectRoot: './sample/Library',
      emitTypeScriptPaths: true,
      logLevel: 'info',
    }),
  ],
};
```

### 9.2 Mode B — pointing at a publish folder

No `mode` switch; the bundler's own mode picks the variant:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import DotnetAssets from 'unplugin-dotnet-static-assets/vite';

export default defineConfig(({ mode }) => ({
  plugins: [
    DotnetAssets({
      projectName: 'Library',
      ...(mode === 'production'
        ? { manifestPath: './publish/Library.staticwebassets.runtime.json' }   // Mode B
        : { projectRoot: '../Library', targetFramework: 'net10.0' }),            // Mode A
      // endpoints.json is auto-loaded from the same directory in both modes → SRI + preload still work
    }),
  ],
}));
```

For a publish output the `runtime.json` file at `manifestPath` will not exist — that's the signal that triggers Mode B. The sibling `Library.staticwebassets.endpoints.json` is what gets actually read.

### 9.3 npm workspaces (.NET project as a sibling package)

The plugin doesn't synthesise package metadata. If you want bare-specifier ergonomics, wire the .NET project up as a workspace member with its own `package.json` and let npm/pnpm/yarn handle the resolution:

```
repo/
├─ package.json          # { "workspaces": ["dotnet-lib", "web"] }
├─ dotnet-lib/
│  ├─ package.json       # { "name": "@me/dotnet-lib", "main": "./wwwroot/main.ts" }
│  ├─ Library.csproj
│  └─ bin/Debug/net8.0/wwwroot/  # runtime.json + assets land here
└─ web/
   ├─ package.json       # { "dependencies": { "@me/dotnet-lib": "*" } }
   └─ vite.config.ts
```

```ts
// web/vite.config.ts
import DotnetAssets from 'unplugin-dotnet-static-assets/vite';

export default {
  plugins: [
    DotnetAssets({
      projectRoot: '../dotnet-lib',  // point the plugin at the sibling
      // emitTypeScriptPaths defaults to 'auto' → writes web/node_modules/.dotnet-vfs/
    }),
  ],
};
```

Contract:

- `projectRoot` defaults to the **consuming workspace's** root (Vite `config.root` / Webpack `context`), never the monorepo root. Point it elsewhere when the .NET output lives in a sibling.
- The IDE-parity cache lives under the consuming workspace's `node_modules/.dotnet-vfs/`. Each workspace that loads the plugin gets its own cache; nothing is shared at the monorepo root.
- Bare specifiers (`import x from '@me/dotnet-lib'`) are **passed through untouched** to the host bundler's resolver, so npm's workspace symlink does its normal job. The plugin only intercepts virtual paths it owns (the manifest entries and relative imports between them).

### 9.4 Webpack & Rollup

```js
// webpack.config.js
const DotnetAssets = require('unplugin-dotnet-static-assets/webpack');

module.exports = {
  plugins: [DotnetAssets({ preserveWasmFilenames: true })],
};
```

```js
// rollup.config.js
import DotnetAssets from 'unplugin-dotnet-static-assets/rollup';

export default {
  input: 'src/main.ts',
  output: { file: 'dist/bundle.js', format: 'esm' },
  plugins: [DotnetAssets()],
};
```

## 10. Caveats & Mitigations

| # | Risk                                                              | Mitigation                                                                                              |
|---|-------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| 1 | Pre-compressed siblings (`.br`, `.gz`) ignored                    | Discover alongside each asset; pass-through in prod, bypass in dev.                                     |
| 2 | Case sensitivity (Windows vs. Linux CI)                           | Case-insensitive lookup keys; preserve on-disk casing on emit; CI validation step.                      |
| 3 | Aggressive code-splitting separating runtime binaries             | Mark plugin-owned assets as non-async; force `asset/resource` (Webpack) / fixed `assetFileNames` (Vite).|
| 4 | Manifest churn between `dotnet build` and bundler start           | Re-read both manifests on watcher events with 100 ms debounce.                                          |
| 5 | Multiple manifests in a monorepo                                  | Require `projectRoot` or explicit `manifestPath` when >1 candidate is found; clear error otherwise.     |
| 6 | TypeScript editor unaware of the virtual tree (Mode A)            | Quiet emission to `node_modules/.dotnet-vfs/` plus a one-line `extends` opt-in. No source-tree pollution; mode flips remove the cache.  |
| 7 | Hashed filenames break the runtime loader                         | Rewrite `blazor.boot.json` / `mono-config.json` in `generateBundle` to match emitted filenames.         |
| 8 | Stale `Content-Length` / `Last-Modified` in endpoints.json        | Recompute from the file in dev when the underlying asset has been touched.                              |
| 9 | Same `AssetFile` mapped to multiple `Route`s (fingerprint variants) | Index by both; canonical for HMR, fingerprinted preferred in production HTML.                          |
| 10 | Broken `.d.ts → video/vnd.dlna.mpeg-tts` MIME from .NET           | Built-in override table; opt-out via `respectAllEndpointHeaders: true`.                                 |
| 11 | Mode misdetection in monorepos / nested publish folders          | Mode is artefact-driven (presence of `runtime.json`). For ambiguous setups, callers pass `manifestPath` explicitly. |
| 12 | Wrong `bin/<Configuration>` chosen (Debug vs Release vs custom)  | Ranked discovery (§2.2) with `configuration` option, `DOTNET_CONFIGURATION` env, bundler-mode signal, and mtime-based staleness warning. |
| 13 | Multi-TFM project (`net8.0` + `net9.0`) ambiguous                | Require `targetFramework`; fail loudly with the enumerated candidate list, like `dotnet run` does.       |
| 14 | Generated IDE-parity files leaking into PRs                       | Default emission to `node_modules/.dotnet-vfs/`; never auto-patch user tsconfig; auto-gitignore when `vfsOutDir` is inside source. |
| 15 | Stale `paths` from a previous Mode A run breaking a Mode B build  | On every run, delete the cache directory when the runtime manifest is absent, when `emitTypeScriptPaths: false`, or when the source manifests disappear. |
| 16 | `projectRoot` resolved against the monorepo root in a workspace setup | Default `projectRoot` to the consuming workspace (Vite `config.root` / Webpack `context`); document the sibling-package recipe (§9.3). |
| 17 | Extensionless import where both `.ts` and `.d.ts` exist for the same name | `.ts` wins; emitted `paths` orders the implementation first; one-shot `debug` warning per shadowed pair. |

## 11. Test Strategy

- **Unit** — schema parsing (runtime + endpoints), VFS lookups, pattern expansion, path normalisation, case-folding, fingerprint index, header override table, artefact-driven mode selection.
- **Fixtures**:
  - `test/fixtures/TypeShim/` — scattered build output, both manifests committed, two content roots (Mode A).
  - `test/fixtures/TypeShim-publish/` — consolidated publish output, endpoints.json only (Mode B).
- **Integration** — scripted production builds for Vite, Webpack, Rollup, esbuild against both fixtures; assert emitted files, reference rewrites, SRI attribute presence.
- **Dev-server contract test** — for every endpoint in the fixture, hit the dev server and assert that the served headers match endpoints.json (modulo recomputed `Content-Length`).
- **Preload test** — assert generated HTML contains a correctly-ordered `<link rel="preload">` block for the `webassembly` group.
- **E2E** — Playwright boots the bundled output in headless Chromium against both fixtures; asserts a successful runtime call into the .NET assembly.
- **Editor parity** (Mode A) — automated TypeScript language-service test: from `main.ts`, "Go to Definition" on a symbol declared in `_framework/dotnet.d.ts` (ContentRoot 0) returns the correct file, even though the corresponding `_framework/dotnet.js` lives in ContentRoot 1.
- **Quiet-emission lifecycle** — (a) Mode A run with `emitTypeScriptPaths: 'auto'` creates only `node_modules/.dotnet-vfs/` and nothing in the source tree; the user's `tsconfig.json` is byte-identical before and after. (b) Switching to Mode B (or removing the manifest) deletes the cache directory on the next run. (c) Setting `vfsOutDir: './.dotnet-vfs'` triggers an automatic `.gitignore` append with the documented marker, idempotent across reruns.
- **Resolution suite** — extensionless imports resolve via `resolveExtensions`; `import './some-dir'` resolves to `some-dir/index.ts` when present; custom `resolveExtensions` order is respected; bare specifiers we don't own are passed through to the host resolver untouched.
- **`.ts` / `.d.ts` shadowing** — fixture with both `foo.ts` and `foo.d.ts` at the same virtual path. Assert the bundler loads `foo.ts`, the emitted `tsconfig` `paths` list it first, the language-service "Go to Definition" lands in `foo.ts`, and a `debug`-level shadowing warning is emitted exactly once.
- **Workspaces fixture** — monorepo with `web/` (the consuming workspace) and `dotnet-lib/` (sibling with `bin/Debug/net8.0/wwwroot/{runtime,endpoints}.json`). Assert the plugin loads when invoked from `web/`, writes only `web/node_modules/.dotnet-vfs/`, leaves the monorepo root untouched, and that bare-specifier imports of `@me/dotnet-lib` are *not* intercepted (npm's workspace symlink does the resolution).
- **Discovery state machine** — fixtures with `bin/Debug/net8.0/` only, `bin/Release/net8.0/` only, both (newer Release), and multi-TFM (`net8.0` + `net9.0`). Assert correct selection, correct hard-failure messages, and that the staleness warning fires when an older configuration is forced.
- **Performance** — 10 000-lookup budget of 50 ms, tracked in CI.

## 12. Compatibility Matrix

| Component   | Minimum | Notes                                                                |
|-------------|---------|----------------------------------------------------------------------|
| Node.js     | 18 LTS  | ESM-first.                                                           |
| .NET SDK    | 8.0     | Uses the `staticwebassets.runtime.json` + `…endpoints.json` shape from .NET 8 onward. |
| Vite        | 5.x     |                                                                      |
| Webpack     | 5.x     |                                                                      |
| Rollup      | 4.x     |                                                                      |
| esbuild     | 0.21+   |                                                                      |
| Rspack      | 1.x     |                                                                      |
| TypeScript  | 5.0+    | Required for optional `paths` emission (Mode A).                     |

## 13. Non-Goals

- Replacing `dotnet build` or `dotnet publish` — the plugin **consumes** their outputs.
- Replacing ASP.NET Core static-files middleware in production — endpoint headers are applied **only in dev**.
- Re-implementing the Blazor / .NET WebAssembly runtime loader.
- Modifying `.wasm` bytes (no AOT, no trimming, no instrumentation).
- Serving content-negotiated variants in production (Selectors → dev only; production hosting handles negotiation).
- **Synthesising an npm package** from the .NET output. Any `package.json` emitted by the .NET project is treated as a plain virtual file. Bare-specifier imports (`import x from '@scope/pkg'`) are never claimed by this plugin; if you want that ergonomics, install the .NET project as an npm workspace member (§9.3) and let your package manager do the resolution.
- Parsing the emitted `package.json`'s `name`, `exports`, `main`, `types`, or `imports` fields. The plugin's mental model is *files in a virtual directory*, not *a package*.

## 14. Glossary

- **Content root** — an absolute directory path listed in `ContentRoots`. Files reference it by index.
- **Virtual path** — the path as it appears in `Root` (browser-/bundler-facing).
- **Physical path** — `join(ContentRoots[i], SubPath)`.
- **VFS** — in-memory virtual filesystem built from the runtime manifest.
- **Endpoint** — a `Endpoints[]` entry: a `Route → AssetFile` mapping with headers and properties.
- **Fingerprinted route** — an alias of an `AssetFile` with a hash segment in its filename, served with `Cache-Control: immutable`.
- **Mode A / Manifest mode** — scattered output; VFS active.
- **Mode B / Consolidated mode** — single-directory output; VFS bypassed.
- **IDE parity** — the property that editors see the same virtual tree the bundler sees (Mode A goal).
