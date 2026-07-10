# unplugin-dotnet-wasm architecture

Why the plugin is shaped the way it is. For usage, see the [package README](../packages/unplugin-dotnet-wasm/README.md); the public option types live in [`src/types.ts`](../packages/unplugin-dotnet-wasm/src/types.ts) and are the source of truth for the API.

## The problem

This plugin concerns .NET WebAssembly projects built in **bundler-friendly mode** (the `WasmBundlerFriendlyBootConfig=true` property in the `.csproj`). In that mode the SDK emits a loader (`dotnet.js`) that pulls in each runtime asset through an ordinary ES `import "./<asset>"`, on the premise that a JS bundler will trace and bundle those imports. Getting an existing .NET WASM app into a JS bundler this way is where the friction starts.

- **`dotnet build` output isn't bundleable.** A plain build leaves the `bin/` output incomplete: the assets those `import` statements point at aren't all present there in a form a JS bundler can follow, so the bundle fails. This is the fast, inner-loop build, and it's the one that doesn't work.

- **`dotnet publish` fixes completeness but is slow.** Publish produces the full asset set, so bundling can succeed against it. But publish is a heavyweight step; paying it on every source change makes the inner dev loop painfully slow, exactly the loop where fast feedback matters most.

- **Even publish output needs bundler surgery.** Consuming it still requires notable per-bundler configuration (asset handling, resolution, Node built-in shims, and more). That setup burden is a real barrier to adopting .NET WASM into an existing JS project, and it has to be redone for each bundler.

- **The emitted JS isn't bundler-friendly.** The SDK's loader and runtime JavaScript trip up bundler static analysis, producing a stream of warnings on every build.

The plugin removes both costs: it makes the fast `dotnet build` output directly bundleable and absorbs the per-bundler configuration, so a .NET WASM app drops into a JS project like any other dependency. How it does that is the rest of this document.

## The core idea

Two facts about the SDK output make a clean solution possible:

- **`endpoints.json` is always produced.** Both `dotnet build` and `dotnet publish` emit `{Project}.staticwebassets.endpoints.json`. Parsing it yields the full list of files needed to run the WASM module, whatever the build layout. This is what makes the fast `dotnet build` output usable: the files do exist, they are just not sitting together where a bundler would look.

- **`runtime.json` is produced by `dotnet build`.** For build output, `{Project}.staticwebassets.runtime.json` additionally maps each of those files to its real location. MSBuild scatters files across several directories for build-optimization reasons; the runtime manifest is what lets the plugin build a virtual filesystem (VFS) that serves them as if they were a single directory. Publish output is consolidated already, so no runtime manifest is emitted or needed.

The plugin is built on [unplugin](https://github.com/unjs/unplugin), so this one solution reaches as many bundlers as reasonably possible from a single codebase instead of a bespoke integration per bundler.

## Asset resolution strategy

The plugin resolves everything the manifests declare and hands anything else back to the bundler.

### StaticWebAssets SDK-powered asset resolution

The `{Project}.staticwebassets.endpoints.json` lists the routes an app needs, with their fingerprint aliases and response headers. `{Project}.staticwebassets.runtime.json` (only after `dotnet build`) maps each file to its scattered location, from which the plugin builds a VFS that serves them as one directory. Without it (after `dotnet publish`), the VFS overlays the publish directory as all files will be present there.

The VFS never scans directories (at most one `stat` per candidate), lookups are case-insensitive but case-preserving on emit, and when a specifier matches both a `.ts` and a `.d.ts`, the implementation file wins.

### Fallback to the bundler, not takeover

For a specifier it recognises, the plugin returns the physical file path; otherwise it returns nothing and the bundler's native resolver takes over. It never owns the whole resolution job. unplugin's uniform resolve hook is what makes this cooperation work across bundlers: a resolved `dotnet.js` can `import './dotnet.native.wasm'` itself, with the plugin re-engaging only for the next manifest-declared asset.

### Fingerprinting falls out of the manifest approach

Fingerprinting is not a first-class concept in the plugin. Since the endpoints manifest maps every canonical route to its actual file, a hashed name like `Library.9mhy6srgqs.wasm` resolves through the same lookup as an unhashed one: the consumer imports `_framework/Library.wasm` and the manifest points it at whatever is on disk. However the SDK names or organises files, they resolve as long as they appear in the manifests. Hence fingerprint on/off is a test axis, not a separate code path.

## Per-bundler emission strategies

`meta.framework` dispatches to a family in [`src/unplugin/index.ts`](../packages/unplugin-dotnet-wasm/src/unplugin/index.ts); the core VFS/manifest layer stays bundler-agnostic. The families exist because each bundler emits binary assets differently:

- **Rollup family** (`rollup`, `vite`, `rolldown`): `load` + `this.emitFile({ type: 'asset' })` + the `import.meta.ROLLUP_FILE_URL_*` placeholder, rewritten to the hashed URL at bundle time. Vite build rides this path with zero Vite-specific code.
- **Webpack family** (`webpack`, `rspack`, `rsbuild`): `load` is omitted (unplugin's webpack loader is not `raw`, so it would round-trip binaries through UTF-8 and corrupt them). Instead a scoped `asset/resource` `module.rules` entry is injected, keyed to the framework files so user `.wasm` imports keep their default handling. On rsbuild the rule is `unshift`ed so it wins over the built-in `.wasm → webassembly/async` rule.
- **esbuild family** (`esbuild`, `bun`): `resolveId` is dropped (unplugin routes it into a plugin-scoped namespace that defeats the native `.wasm → file` loader). `onResolve` is registered directly inside `setup(build)` so files stay in the default namespace.
- **Farm**: Rollup-shaped `resolveId`; binary emission is opted in by the consumer via `compilation.assets.include: ['wasm']` (Farm exposes no plugin hook for it).

## Cross-target output contract (why Node support is a subset)

With `WasmBundlerFriendlyBootConfig=true`, `dotnet.js` contains a real `import "./<asset>"` per asset, each expected to resolve to a **URL string**. For output to work under both browser and Node without a consumer-side shim, every asset import must be rewritten to `new URL("./<file>", import.meta.url).href`: a relative, `import.meta.url`-based, plain-string value, emitted as ESM. The dotnet runtime's built-in `fetch_like` already handles the resulting scheme (`http(s):` in the browser, `file:` in Node).

Rollup-family and Farm produce this shape natively, so they support Node targets today. esbuild/bun emit bare strings and webpack/rspack/rsbuild emit `URL` instances (only under `output.module`), so **their Node targets are deferred** pending a rewrite step; browser output is unaffected. The [README bundler table](../packages/unplugin-dotnet-wasm/README.md#bundler-support) reflects the current matrix.

## No name preservation, no boot-manifest rewriting

Because `WasmBundlerFriendlyBootConfig=true` carries the runtime asset lookup through ordinary `import` statements, bundlers are free to rehash and relocate; reference rewriting keeps the lookup intact end to end. The plugin does not preserve the SDK's original filenames and does not rewrite `blazor.boot.json` / `mono-config.json`.

## Non-goals

- Replacing `dotnet build` / `dotnet publish`; the plugin **consumes** their output.
- Replacing ASP.NET Core static-file middleware in production; any endpoint headers are a dev-only concern.
- Re-implementing the .NET WebAssembly runtime loader, or touching `.wasm` bytes (no AOT, trimming, or instrumentation).
- Subresource Integrity emission: the .NET loader hashes `.wasm`/`.dll`/`.dat` internally, and browser SRI only covers `<script>`/`<link>` tags, so the value is marginal and the wiring brittle against hashed filenames.
- Synthesising an npm package from the emitted output. Any `package.json` in the output is a plain virtual file; bare-specifier imports are never claimed by this plugin. Use an npm workspace member if you want that.

## Testing model

The integration/E2E suite is a flag-driven matrix over four axes: `bundler`, `platform` (`node`/`browser`), `fingerprint` (`fingerprint`/`nofingerprint`), and `build-mode` (`debug`/`publish`/`none`). `fingerprint` and `build-mode` are **fixed per invocation**: the caller builds the fixtures for the mode under test, and the matrix runner never rebuilds them. `build-mode=none` deliberately runs against an unbuilt project to assert the plugin surfaces a clean file-not-found rather than a stack trace. See [AGENTS.md](../AGENTS.md) for the commands.

## Glossary

- **Content root**: an absolute directory listed in `ContentRoots`, referenced by index.
- **Virtual path**: the path as it appears in the manifest tree (bundler-/browser-facing).
- **Physical path**: `join(ContentRoots[i], SubPath)`.
- **VFS**: the in-memory virtual filesystem built from the manifest(s).
- **Fingerprinted route**: an alias of an `AssetFile` whose filename carries a hash segment, served immutable.
