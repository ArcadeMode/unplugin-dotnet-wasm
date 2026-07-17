# unplugin-dotnet-wasm architecture

Why the plugin is shaped the way it is. For usage, see the [package README](../unplugin-dotnet-wasm/README.md); the public option types live in [`src/types.ts`](../unplugin-dotnet-wasm/src/types.ts) and are the source of truth for the API.

## The problem

This plugin concerns .NET WebAssembly projects built in **bundler-friendly mode** (the `WasmBundlerFriendlyBootConfig=true` property in the `.csproj`). In that mode the SDK emits a loader (`dotnet.js`) that pulls in each runtime asset through an ordinary ES `import "./<asset>"`, on the premise that a JS bundler will trace and bundle those imports. Getting an existing .NET WASM app into a JS bundler this way is where the friction starts.

- **`dotnet build` output isn't bundleable.** A plain build leaves the `bin/` output incomplete: the assets those `import` statements point at aren't all present there in a form a JS bundler can follow, so the bundle fails. This is the fast, inner-loop build, and it's the one that doesn't work.

- **`dotnet publish` output bundles but is slow.** Publish produces the full asset set, so bundling can succeed against it. But publish is a heavyweight step; paying it on every source change makes the inner dev loop painfully slow.

- **Even publish output needs bundler surgery.** Consuming it still requires notable per-bundler configuration (asset handling, resolution, Node built-in shims, and more). That setup burden is a real barrier to adopting .NET WASM into an existing JS project, and it has to be redone for each bundler.

- **The emitted JS trips up static analysis.** The SDK's loader and runtime JavaScript trip up bundler static analysis, producing a stream of warnings on every build. These dont break functionality but are still annoying.

The plugin aims to adres the above by making the fast `dotnet build` output directly bundleable and absorbs the per-bundler configuration while adjusting the JS to silence warnings. With unplugin-dotnet-wasm, a .NET WASM app drops into a JS project like any other dependency. How it does that is the rest of this document.

## The core idea

Two facts about the SDK output make a clean solution possible:

- **`endpoints.json` is always produced.** Both `dotnet build` and `dotnet publish` emit `{Project}.staticwebassets.endpoints.json`. Parsing it yields the full list of files needed to run the WASM module, whatever the build layout. This is what makes the fast `dotnet build` output usable: the files do exist, they are just not sitting together where a bundler would look.

- **`runtime.json` is produced by `dotnet build`.** For build output, `{Project}.staticwebassets.runtime.json` additionally maps each of those files to its real location. MSBuild scatters files across several directories for build-optimization reasons; the runtime manifest is what lets the plugin build a virtual filesystem (VFS) that serves them as if they were a single directory. Publish output is consolidated already, so no runtime manifest is emitted or needed.

The plugin is built on [unplugin](https://github.com/unjs/unplugin), so this one solution reaches as many bundlers as reasonably possible from a single codebase instead of a bespoke integration per bundler.

## Asset resolution strategy

The plugin resolves everything the manifests declare and hands anything else back to the bundler.

### StaticWebAssets SDK-powered asset resolution

The `{Project}.staticwebassets.endpoints.json` lists the routes an app needs, with their fingerprint aliases and response headers. `{Project}.staticwebassets.runtime.json` (only after `dotnet build`) maps each file to its scattered location, from which the plugin builds a VFS that serves them as one directory. Without it (after `dotnet publish`), the VFS overlays the publish directory as all files will be present there.

### Fallback to the bundler for unresolved assets

For a specifier it recognises, the plugin returns the physical file path; otherwise it returns nothing and the bundler's native resolver takes over. It never owns the whole resolution job. unplugin's uniform resolve hook is what makes this cooperation work across bundlers: a resolved `dotnet.js` can `import './dotnet.native.wasm'` itself, with the plugin re-engaging only for the next manifest-declared asset.

### Fingerprinting implicitly supported

The StaticWebAssets SDK enables fingerprinting by default, but it is not required to be a first-class concept in the plugin. Since the endpoints manifest maps every canonical route to its actual file, a name like `_framework/Library.wasm` or `_framework/Library.9mhy6srgqs.wasm` resolves through the same lookup. However the SDK names or organises files, they resolve as long as they appear in the manifests. Hence fingerprint on/off is a test axis, not a separate code path.

## Per-bundler emission strategies

`meta.framework` dispatches to a family in [`src/unplugin/index.ts`](../unplugin-dotnet-wasm/src/unplugin/index.ts); the core VFS/manifest layer stays bundler-agnostic. The families exist because each bundler emits binary assets differently:

- **Rollup family** (`rollup`, `vite`, `rolldown`): `load` + `this.emitFile({ type: 'asset' })` + the `import.meta.ROLLUP_FILE_URL_*` placeholder, which these bundlers rewrite to the hashed URL at bundle time.
- **Webpack family** (`webpack`, `rspack`, `rsbuild`): `load` is omitted (unplugin's webpack loader corrupts binaries if passed through load). Instead a scoped `module.rules` entry is injected to serve wasm/dat/pdb as `asset/resource`. These rules are scoped to the dotnet framework files so user `.wasm` imports keep their default handling. On rsbuild the rule is prepended to the ruleset to win over the built-in `.wasm → webassembly/async` rule.
- **esbuild family** (`esbuild`, `bun`): `resolveId` is dropped in favour of `onResolve` directly inside `setup(build)` so files stay in the default namespace.
- **Farm**: Rollup-shaped `resolveId`; binary emission is opted in by the consumer via `compilation.assets.include: ['wasm']` (Farm exposes no plugin hook for it).

## Dev server

The `resolveId` hook and VFS-backed resolution described above are not build-only - they run identically under a bundler's dev server, so out-of-tree assets that travel the module graph (e.g. the bundler-friendly boot config's statically-imported `./../_content/<pkg>/…` NuGet JS initializers, collapsed to their canonical manifest route by the resolver's clamp-normalisation) resolve the same way in `dev` as in `build`, on every bundler. No dev-specific code involved.

What dev servers add is delivery of **runtime-fetched** out-of-tree assets: the runtime fetches `_framework/*.{wasm,dat,pdb}` (and URL-referenced files) at boot, which no bundler serves for an out-of-tree output. In serve mode the binary `load` hook returns an explicit route (`/_framework/<hashedName>`) and `createAssetMiddleware` streams the physical file with the manifest's headers. The middleware *core* is one uniform bundler-agnostic connect handler; each family only supplies the glue to register it - Vite `configureServer`, webpack/rspack `setupMiddlewares`, rsbuild `server.setup`, and a Koa shim for Farm's Koa-based server.

## Cross-target output contract (why Node support is a subset)

With `WasmBundlerFriendlyBootConfig=true`, `dotnet.js` contains a real `import "./<asset>"` per asset, each expected to resolve to a **URL string**. For output to work under both browser and Node without a consumer-side shim, every asset import must be rewritten to `new URL("./<file>", import.meta.url).href`: a relative, `import.meta.url`-based, plain-string value, emitted as ESM. The dotnet runtime's built-in `fetch_like` already handles the resulting scheme (`http(s):` in the browser, `file:` in Node).

Rollup-family and Farm produce this shape natively, so they support Node targets today. esbuild/bun emit bare strings and webpack/rspack/rsbuild emit `URL` instances (only under `output.module`), so **their Node targets are deferred** pending a rewrite step; browser output is unaffected. The [README bundler table](../unplugin-dotnet-wasm/README.md#bundler-support) reflects the current matrix.

## Testing model

The integration/E2E suite is modelled as a matrix over four axes: `bundler`, `platform` (`node`/`browser`), `fingerprint` (`fingerprint`/`nofingerprint`), and `build-mode` (`debug`/`publish`/`none`). `fingerprint` and `build-mode` are **fixed per invocation**: the caller builds the fixtures for the mode under test, and the matrix runner never rebuilds them. `build-mode=none` exists to assert that the plugin produces clean error messages. See [AGENTS.md](../AGENTS.md) for the commands.

