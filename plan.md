# Engineering Specification: `unplugin-dotnet-wasm`

> Companion file: [execution-plan.md](execution-plan.md). This file describes the target system; the execution plan tracks build order, milestones, and acceptance criteria.

## 1. Mission

A .NET WebAssembly project produces static web assets in **one of two shapes**:

1. **Scattered** — typical after `dotnet build`. Files live across `wwwroot/`, `bin/<tfm>/wwwroot/`, intermediate `obj/`, NuGet caches, and SDK runtime packs. A manifest, `{Project}.staticwebassets.runtime.json`, glues them into a single virtual tree.
2. **Consolidated** — typical after `dotnet publish` (or a hand-staged copy). Every file already lives side-by-side under one output directory. No runtime manifest is required to resolve them.

This plugin handles **both** shapes, presenting them to JavaScript bundlers (Vite first; Webpack, Rollup, esbuild, Rspack planned) — and to the developer's editor — as a single coherent directory, and serving them in dev with the response headers the production runtime expects.

> **One-liner:** Mount .NET static-web-assets output (scattered *or* consolidated) as a virtual module namespace, with optional production-fidelity headers and preload hints.

## 2. Discovery & VFS Construction

The plugin runs a single resolution pipeline. The endpoints manifest (`{Project}.staticwebassets.endpoints.json`) is the source of truth for routes, fingerprints, response headers, and preload hints — it is **always required**. The runtime manifest (`{Project}.staticwebassets.runtime.json`) is what makes the VFS aware of scattered content roots; it is **optional**. The two combinations differ only in how the VFS is constructed:

| Aspect                          | **With runtime manifest** *(typical `dotnet build`)*               | **Without runtime manifest** *(typical `dotnet publish`)*           |
|---------------------------------|--------------------------------------------------------------------|---------------------------------------------------------------------|
| Typical trigger                 | After `dotnet build`                                               | After `dotnet publish`, or manual stage                             |
| File layout                     | Scattered across several physical directories                      | Single output directory                                             |
| Endpoints manifest              | **Required**                                                       | **Required**                                                        |
| Runtime manifest                | Present — VFS built from `ContentRoots` + tree                    | Absent — VFS seeded from `Endpoints[].AssetFile` rooted at the manifest directory |
| Cross-root resolution           | Yes (core feature)                                                 | Not needed — single root                                            |

### 2.1 Manifest discovery

The plugin does **not** expose a mode switch. Discovery anchors on the endpoints manifest:

- `{Project}.staticwebassets.endpoints.json` is **always required**.
- If `{Project}.staticwebassets.runtime.json` is found alongside it → the VFS is built from the runtime manifest's tree (multiple content roots, explicit asset entries, pattern fallthrough).
- If only the endpoints manifest is found → the VFS is seeded from `Endpoints[].AssetFile`, rooted at the directory containing the endpoints manifest (typically a `dotnet publish -o <dir>` output).

Which path is taken is therefore a function of which `dotnet` command produced the artefacts, not a plugin option. The typical wiring is in the bundler config: a dev config lets discovery walk `<projectRoot>/bin/<Configuration>/<TargetFramework>/`; a prod config passes `dotnetOutputDir` pointing at the publish output. Same options shape, same code path — only the input directory differs.

### 2.2 Build configuration & target-framework discovery

`.NET` writes its outputs to `bin/<Configuration>/<TargetFramework>[/publish]/…`. Discovery is explicit: the caller tells the plugin which configuration and target framework to look under. There is no globbing, no ranking, no mtime tiebreaking, no env-var fallback, and no bundler-mode auto-pick — the caller knows their project better than the plugin can guess.

| Axis              | Examples                       | Source of truth                                  |
|-------------------|--------------------------------|--------------------------------------------------|
| Configuration     | `Debug`, `Release`, `Staging`  | `options.configuration` ▸ `'Debug'`              |
| Target framework  | `net8.0`, `net9.0`             | `options.targetFramework` ▸ unique match ▸ fail  |

*(There is no "Build vs Publish" axis. Publish outputs are addressed by passing `dotnetOutputDir` directly; discovery only deals with the `bin/<Configuration>/<TargetFramework>/` layout that `dotnet build` produces.)*

Resolution proceeds top-down, first hit wins:

1. **Explicit override.** If `options.dotnetOutputDir` is set, use it verbatim. The runtime manifest inside that directory may or may not exist (it won't, for a publish output); the endpoints manifest **must**.
2. **Tight candidate path.** Construct `<projectRoot>/bin/<configuration>/<targetFramework>/` from supplied options, defaulting `configuration` to `'Debug'`. If `targetFramework` is omitted, glob `<projectRoot>/bin/<configuration>/*/` and require exactly one TFM directory; otherwise hard-fail with the enumerated candidates.
3. Look in that directory for `{ProjectName}.staticwebassets.endpoints.json` (required) and `{ProjectName}.staticwebassets.runtime.json` (optional). On miss, throw with a message naming the directory searched and the resolved axes.

Callers who need to switch Debug ↔ Release per bundler mode do so in their own config, e.g. Vite's `defineConfig(({ mode }) => ({ plugins: [DotnetAssets({ projectRoot: '../Library', configuration: mode === 'production' ? 'Release' : 'Debug' })] }))`. The plugin doesn't infer build configuration from the host bundler.

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

### 3.2 Resolution algorithm

The VFS describes **only what the manifest declares to be virtual**. Everything else — unlisted files, source-tree files, `node_modules`, the consuming project — is the host bundler's problem and is reached through its native resolver.

Given a request `source` (the importer is *not* consulted; see the rationale below):

1. **Normalise.** Strip a leading `./` and any leading `/`; convert to POSIX; lowercase for the lookup key.
2. **Endpoint route alias (exact-path case).** If the endpoints manifest is available, probe the precomputed `Map<route, EndpointMatch>` (see §4) with the normalised key. On hit, replace the lookup key with the matching `AssetFile` before continuing — this is what lets already-extension-qualified specifiers like `_framework/Library.wasm` resolve to fingerprinted physical files like `_framework/Library.9mhy6srgqs.wasm`.
3. **Flat map lookup.** Probe the precomputed `Map<virtualPath, ResolvedAsset>` built from every explicit `Asset` node in the manifest tree.
4. **Extension / index probing (bare specifiers only).** If `source` has no file extension, for each candidate suffix in the built-in extension probe order: (a) probe the flat VFS map with `${source}${ext}`; (b) **if that misses, also probe the endpoint map with `${source}${ext}` and if found, resolve `assetFile` via steps 3+6 below**. Repeat for `${source}/index${ext}` variants.
5. **Pattern fallthrough.** For each `Patterns` entry whose virtual prefix matches `source`, `statSync` the candidate physical path `join(ContentRoots[i], source)` once. Bare specifiers retry per probe extension and per `index.<ext>` suffix. **There is never a directory scan** — only targeted single-file stats.
6. **Endpoint-aliased FS fallback.** If step 2 or step 4(b) produced an endpoint alias but steps 3–5 all missed (the aliased asset file is not in the VFS flat map and not covered by a pattern), `statSync` `join(ContentRoots[i], assetFile)` for each content root in declaration order; first hit wins. This covers fingerprinted physical files that live in the build-output content root but are not enumerated by the runtime manifest's `Asset` tree.
7. **Miss → hand back to the bundler.** Return `undefined`. The bundler's native resolver then walks relative to the importer's physical directory, which is the right behaviour for everything that isn't a static-web-asset (consuming-project imports, `node_modules`, sibling build-output files imported from within the same build-output directory).

**Why the importer is not consulted.** When `import './_framework/dotnet.js'` runs from `wwwroot/main.ts`, the plugin's only contribution is *"is `_framework/dotnet.js` a virtual path in the manifest?"* — the answer is yes, and it returns the absolute path the manifest points at. From that point on, `dotnet.js` (now a real file on disk) does its own `import './dotnet.native.wasm'` and the bundler resolves it natively against `dotnet.js`'s physical directory. The plugin only re-engages when another virtual lookup is asked for. This keeps the plugin a pure overlay and avoids fighting the bundler for ownership of relative-path semantics.

**`.ts` shadows `.d.ts`.** If steps 2–3 yield both a `.ts`/`.tsx` *and* a sibling `.d.ts` for the same bare specifier, the implementation file wins for the bundler. A `debug`-level warning is logged once per shadowed pair; the warning is emitted by `buildVfs` through the injected `Logger` at construction time — the VFS does not expose the shadowed-pair set externally. The lone `.d.ts + .js` pair seen with framework files (`_framework/dotnet.d.ts` + `_framework/dotnet.js`) is the happy path and is left alone.

Casing: **case-insensitive lookup, case-preserving emit**. Defuses Windows ↔ Linux drift without breaking strict-case servers.

When no runtime manifest is present, the VFS is seeded directly from `Endpoints[].AssetFile`, rooted at the directory containing the endpoints manifest (single content root). Virtual path equals physical path under that root. The resolution algorithm above is unchanged — the only difference is the VFS construction step.

## 4. Manifest B — `{Project}.staticwebassets.endpoints.json`

Describes how each asset should be **served**: response headers, preload hints, and fingerprinted route aliases.

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
        { "Name": "PreloadRel",         "Value": "preload" }
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
- `Endpoints[].AssetFile` — path under the asset output. Joined against the relevant content root: one from the runtime manifest when present, or `dotnetOutputDir` (the directory containing the endpoints manifest) when it isn't.
- `Endpoints[].Selectors` — content-negotiation hints (e.g. `Accept-Encoding: br`). Often empty; the parser must accept them.
- `Endpoints[].ResponseHeaders` — applied verbatim by the dev middleware, with sensible overrides for stale `Content-Length` / `Last-Modified` when the file has been edited.
- `Endpoints[].EndpointProperties` — non-header metadata. The plugin recognises:
  - `fingerprint`, `label` → fingerprinted-route bookkeeping.
  - `PreloadAs`, `PreloadCrossorigin`, `PreloadGroup`, `PreloadOrder`, `PreloadPriority`, `PreloadRel` → `<link rel="preload">` generation.
  - Unknown properties are kept verbatim and exposed to user hooks.

### 4.2 Plugin use cases

1. **Dev middleware headers** — serve every request with the exact `Content-Type` / `Cache-Control` / `ETag` the production runtime would see, so the .NET loader behaves identically in dev and prod. Stream bytes from the physical file; rewrite stale `Content-Length` automatically.
2. **Preload emission** — when the host generates HTML, inject `<link rel="preload" as="script" crossorigin="anonymous" fetchpriority="high">` for entries in `PreloadGroup: webassembly`, ordered by `PreloadOrder`.
3. **Fingerprint awareness** — recognise both `main.js` and `main.<hash>.js` as the same `AssetFile`. The resolver consumes this alias (§3.2 steps 2 and 4b, implemented in M1.7) so consumer imports use canonical names while physical files on disk carry fingerprints. Production HTML prefers the immutable fingerprinted route; canonical routes are exposed for tooling.

### 4.3 Known oddities

- .NET sometimes assigns `Content-Type: video/vnd.dlna.mpeg-tts` to `.d.ts` files (an MPEG-TS / TypeScript MIME clash). The plugin keeps a small override table for well-known offenders (`.d.ts → text/plain`, `.map → application/json`) — opt-out via `respectAllEndpointHeaders: true`.
- `Content-Length` and `Last-Modified` can be stale during hot-edit; recompute from the file system in dev.

## 5. Developer Experience — Why the Virtual View Matters Beyond the Bundler

When the runtime manifest is present (scattered build output), the plugin is not only a bundler adapter; it must reconstruct the virtual directory faithfully enough that **everyday editor tooling works**:

- `import { dotnet } from './_framework/dotnet.js'` from `main.ts` **resolves**, even though `dotnet.js` is in a different physical folder.
- **Go to Definition** on `dotnet` jumps to `_framework/dotnet.d.ts` (another physical root).
- **Find References**, **Rename**, **Hover Types**, **Autocomplete** all behave as if `_framework/` were a single real folder.
- A developer browsing the project sees **one coherent `_framework/` listing**, not two half-empty mirrors of source vs. build output.
- **Navigate To File** (`Ctrl+P`) lists `_framework/Library.wasm` once, at its virtual path.

A future milestone will deliver this by emitting a small set of TypeScript helpers (a self-contained `tsconfig.json` + ambient `.d.ts` shims) into `node_modules/.dotnet-vfs/`, opted in via a single `extends` line the user adds to their own `tsconfig.json`. The plugin never auto-patches the user's tsconfig, and the cache directory is removed when the runtime manifest disappears. Detailed contract deferred until the milestone is scheduled — see [Future Work](#13-future-work).

## 6. Public API

The plugin exports a single factory whose options are a **discriminated union** of two variants:

- **Discovery variant** — pass `projectRoot` + optional `configuration` / `targetFramework` / `isPublish`. The plugin walks `<projectRoot>/bin/<configuration>/<targetFramework>[/publish]/` to find the manifests.
- **Explicit variant** — pass `dotnetOutputDir` directly. The plugin reads the manifests from that exact directory.

The two are mutually exclusive: discovery options and `dotnetOutputDir` may not coexist. Both variants share `projectName` (required) and `logLevel` (optional, default `'warn'`).

The exact TypeScript types live in [`packages/unplugin-dotnet-wasm/src/types.ts`](packages/unplugin-dotnet-wasm/src/types.ts) — that file is the source of truth for the public API. See §7 for working examples.

Defaults are part of the public contract; changes require a major version bump.

## 7. Consumption

### 7.1 Pointing at a project root (scattered build output)

```ts
// vite.config.ts
import DotnetAssets from 'unplugin-dotnet-wasm/vite';

export default {
  plugins: [
    DotnetAssets({
      projectName: 'Library',
      projectRoot: './sample/Library',
      logLevel: 'info',
    }),
  ],
};
```

### 7.2 Pointing at a consolidated publish folder

The bundler's own mode picks the variant — same plugin, mode-switched options:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import DotnetAssets from 'unplugin-dotnet-wasm/vite';

export default defineConfig(({ mode }) => ({
  plugins: [
    DotnetAssets({
      projectName: 'Library',
      ...(mode === 'production'
        ? { dotnetOutputDir: './publish' }                                     // consolidated publish output
        : { projectRoot: '../Library', targetFramework: 'net10.0' }),            // scattered build output
    }),
  ],
}));
```

For a publish output the `runtime.json` file inside `dotnetOutputDir` will not exist — that's the signal that triggers the endpoints-seeded VFS. The sibling `Library.staticwebassets.endpoints.json` is what gets actually read.

## 8. Caveats & Mitigations

| # | Risk                                                              | Mitigation                                                                                              |
|---|-------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| 1 | Pre-compressed siblings (`.br`, `.gz`) ignored                    | Discover alongside each asset; pass-through in prod, bypass in dev.                                     |
| 2 | Case sensitivity (Windows vs. Linux CI)                           | Case-insensitive lookup keys; preserve on-disk casing on emit; CI validation step.                      |
| 3 | Aggressive code-splitting separating runtime binaries             | Mark plugin-owned assets as non-async; force `asset/resource` (Webpack) / fixed `assetFileNames` (Vite).|
| 4 | Manifest churn between `dotnet build` and bundler start           | Re-read both manifests on watcher events with 100 ms debounce.                                          |
| 5 | Multiple manifests in a monorepo                                  | Require `projectRoot` or explicit `dotnetOutputDir` when >1 candidate is found; clear error otherwise.  |
| 6 | Stale `Content-Length` / `Last-Modified` in endpoints.json        | Recompute from the file in dev when the underlying asset has been touched.                              |
| 7 | Same `AssetFile` mapped to multiple `Route`s (fingerprint variants) | Index by both; canonical for HMR, fingerprinted preferred in production HTML.                          |
| 8 | Broken `.d.ts → video/vnd.dlna.mpeg-tts` MIME from .NET           | Built-in override table; opt-out via `respectAllEndpointHeaders: true`.                                 |
| 9 | Misdetection in monorepos / nested publish folders                | VFS construction is artefact-driven (presence of `runtime.json`). For ambiguous setups, callers pass `dotnetOutputDir` explicitly. |
| 10 | Wrong `bin/<Configuration>` chosen (Debug vs Release vs custom)  | Explicit `configuration` option (defaults to `Debug`). Callers wire bundler-mode-based switching themselves (Vite `defineConfig(({ mode }) => …)`). The plugin doesn't auto-pick. |
| 11 | Multi-TFM project (`net8.0` + `net9.0`) ambiguous                | Require `targetFramework`; fail loudly with the enumerated candidate list, like `dotnet run` does.       |
| 12 | Extensionless import where both `.ts` and `.d.ts` exist for the same name | `.ts` wins; one-shot `debug` warning per shadowed pair.                                          |

## 9. Test Strategy

- **Unit** — schema parsing (runtime + endpoints), VFS lookups, pattern expansion, path normalisation, case-folding, fingerprint index, header override table, the `.ts` shadows `.d.ts` rule, artefact-driven VFS selection.
- **Integration** — scripted production builds through Vite for both fixtures (scattered build, consolidated publish); assert emitted files and reference rewrites.
- **E2E** — Playwright boots the bundled output in headless Chromium against both fixtures and asserts a successful `[TSExport]` round-trip into .NET.
- **Performance** — 10 000-lookup budget of 50 ms, tracked in CI.

Fixtures live under `test/fixtures/`; the integration suite is parameterised so each additional bundler (or fingerprint state) can be added without per-shape duplication.

## 10. Compatibility Matrix

| Component   | Minimum | Notes                                                                |
|-------------|---------|----------------------------------------------------------------------|
| Node.js     | 20 LTS  | ESM-first.                                                           |
| .NET SDK    | 8.0     | Uses the `staticwebassets.runtime.json` + `…endpoints.json` shape from .NET 8 onward. |
| Vite        | 5.x     | First bundler supported.                                             |
| TypeScript  | 5.0+    | Required for the optional IDE-parity `paths` emission (Future Work). |

Other bundlers (Webpack, Rollup, esbuild, Rspack) are planned — see [Future Work](#13-future-work).

## 11. Non-Goals

- Replacing `dotnet build` or `dotnet publish` — the plugin **consumes** their outputs.
- Replacing ASP.NET Core static-files middleware in production — endpoint headers are applied **only in dev**.
- Re-implementing the Blazor / .NET WebAssembly runtime loader.
- Modifying `.wasm` bytes (no AOT, no trimming, no instrumentation).
- Serving content-negotiated variants in production (Selectors → dev only; production hosting handles negotiation).
- Subresource Integrity (SRI) emission. The .NET loader does its own internal hash check on `.wasm`/`.dll`/`.dat` content; browser-side SRI applies only to `<script>` / `<link>` tags (not `fetch` or `WebAssembly.instantiateStreaming`), so its only effect would be on the entry `dotnet.js` tag. Marginal value, brittle wiring against hashed bundler filenames.
- **Synthesising an npm package** from the .NET output. Any `package.json` emitted by the .NET project is treated as a plain virtual file. Bare-specifier imports (`import x from '@scope/pkg'`) are never claimed by this plugin; if you want that ergonomics, install the .NET project as an npm workspace member and let your package manager do the resolution.
- Parsing the emitted `package.json`'s `name`, `exports`, `main`, `types`, or `imports` fields. The plugin's mental model is *files in a virtual directory*, not *a package*.

## 12. Glossary

- **Content root** — an absolute directory path listed in `ContentRoots`. Files reference it by index.
- **Virtual path** — the path as it appears in `Root` (browser-/bundler-facing).
- **Physical path** — `join(ContentRoots[i], SubPath)`.
- **VFS** — in-memory virtual filesystem built from the runtime manifest.
- **Endpoint** — a `Endpoints[]` entry: a `Route → AssetFile` mapping with headers and properties.
- **Fingerprinted route** — an alias of an `AssetFile` with a hash segment in its filename, served with `Cache-Control: immutable`.
- **IDE parity** — the property that editors see the same virtual tree the bundler sees (relevant when files live across multiple content roots).

## 13. Future Work

Items deferred past `0.1.0-rc`. Most map to backlog milestones in [execution-plan.md](execution-plan.md).

- **Dev-server middleware** — apply `ResponseHeaders` from endpoints.json verbatim (with stale-`Content-Length` recomputation), handle `Selectors` content-negotiation, watch + invalidate on manifest churn.
- **Preload `<link>` injection** — emit preload tags from `EndpointProperties.Preload*` for the `webassembly` group, ordered by `PreloadOrder`, via `transformIndexHtml`. Endpoint lookup already carries the data.
- **IDE-parity emission** — when the runtime manifest spans multiple content roots, emit `tsconfig.json` + `dotnet-vfs.d.ts` (+ snapshot + `.gitignore`) into `node_modules/.dotnet-vfs/`. Opt-in via a single `extends` line; never auto-patch the user's `tsconfig.json`; remove the cache when the runtime manifest disappears.
- **Configurable extension probe order** — `resolveExtensions` option. Currently a built-in constant in `core/extension-probes.ts`; add a user option if a real consumer needs to tweak it.
- **Boot-manifest rewrite** — when the host bundler hashes `.wasm`/`.dll` outputs, rewrite `blazor.boot.json` / `mono-config.json` in `generateBundle` so the loader's filename list matches emitted names.
- **Additional bundler adapters** — Webpack, Rollup, esbuild, Rspack. Validates the unplugin abstraction; each needs a per-bundler asset-emission strategy.
- **npm workspaces recipe** — fixture + docs for using the .NET project as a sibling workspace member, so bare specifiers (`import x from '@scope/dotnet-lib'`) resolve through the package manager rather than the plugin.
- **Compression sibling pass-through** (`.br` / `.gz` next to each asset).
- **Watch-mode HMR** — `addWatchFile` for every VFS asset, debounced manifest re-read on change, dev HMR invalidation when `dotnet build` / `dotnet watch` rewrites the bin output.
