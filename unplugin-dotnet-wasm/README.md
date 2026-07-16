# unplugin-dotnet-wasm

unplugin-dotnet-wasm enables importing .NET [WebAssembly Browser Apps](https://learn.microsoft.com/en-us/aspnet/core/client-side/dotnet-interop/wasm-browser-app) through your favorite JavaScript bundler's own module graph: no manual copy step, no public-dir hacks, and it works against the fast `dotnet build`, saving the slow `dotnet publish` for when you are actually publishing.

Built on [unplugin](https://github.com/unjs/unplugin), so one integration covers Vite, Webpack, Rollup, Rolldown, Rspack, Rsbuild, esbuild, Farm, and Bun.

> [!TIP]
> unplugin-dotnet-wasm pairs great with [TypeShim](https://github.com/ArcadeMode/TypeShim) for a seamless .NET > JS experience.

## Install

```bash
npm i -D unplugin-dotnet-wasm
```

## Usage

Register the plugin in your bundler config. The import path is the only thing that differs across bundlers; the `DotnetAssets({...})` call is identical everywhere. Options are documented under [Configuration](#configuration).

### Bundler examples

<details>
<summary><strong>Vite</strong></summary>

```ts
import { defineConfig } from 'vite';
import DotnetAssets from 'unplugin-dotnet-wasm/vite';

export default defineConfig({
  // ...
  plugins: [
    DotnetAssets({
      projectName: 'MyLibrary',
      projectRoot: '../MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      isPublish: false,
    }),
  ],
});
```

</details>

<details>
<summary><strong>Webpack</strong></summary>

```js
import DotnetAssets from 'unplugin-dotnet-wasm/webpack';

export default {
  // ...
  plugins: [
    DotnetAssets({
      projectName: 'MyLibrary',
      projectRoot: '../MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      isPublish: false,
    }),
  ],
};
```

</details>

<details>
<summary><strong>Rollup</strong></summary>

Rollup does not resolve bare module specifiers on its own, so the dotnet runtime's internal imports need `@rollup/plugin-node-resolve`:

```js
import nodeResolve from '@rollup/plugin-node-resolve';
import DotnetAssets from 'unplugin-dotnet-wasm/rollup';

export default {
  // ...
  plugins: [
    nodeResolve({ browser: true }),   // omit `browser` when targeting Node
    DotnetAssets({
      projectName: 'MyLibrary',
      projectRoot: '../MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      isPublish: false,
    }),
  ],
};
```

**Node target:** externalize Node built-ins so the dotnet runtime's Node-only paths don't get pulled into the graph:

```js
import { builtinModules } from 'node:module';

export default {
  // ...
  external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
};
```

</details>

<details>
<summary><strong>esbuild</strong></summary>

```ts
import * as esbuild from 'esbuild';
import DotnetAssets from 'unplugin-dotnet-wasm/esbuild';

await esbuild.build({
  // ...
  plugins: [
    DotnetAssets({
      projectName: 'MyLibrary',
      projectRoot: '../MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      isPublish: false,
    }),
  ],
});
```

When targeting Node, the runtime needs an explicit resource loader — see [Runtime usage](#runtime-usage) below.

</details>

<details>
<summary><strong>Rspack</strong></summary>

```js
import DotnetAssets from 'unplugin-dotnet-wasm/rspack';

export default {
  // ...
  plugins: [
    DotnetAssets({
      projectName: 'MyLibrary',
      projectRoot: '../MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      isPublish: false,
    }),
  ],
};
```

</details>

<details>
<summary><strong>Rsbuild</strong></summary>

```ts
import { defineConfig } from '@rsbuild/core';
import DotnetAssets from 'unplugin-dotnet-wasm/rsbuild';

export default defineConfig({
  // ...
  plugins: [
    DotnetAssets({
      projectName: 'MyLibrary',
      projectRoot: '../MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      isPublish: false,
    }),
  ],
});
```

</details>

<details>
<summary><strong>Rolldown</strong></summary>

```js
import DotnetAssets from 'unplugin-dotnet-wasm/rolldown';

export default {
  // ...
  plugins: [
    DotnetAssets({
      projectName: 'MyLibrary',
      projectRoot: '../MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      isPublish: false,
    }),
  ],
};
```

**Node target:** externalize Node built-ins so the dotnet runtime's Node-only paths don't get pulled into the graph:

```js
import { builtinModules } from 'node:module';

export default {
  // ...
  external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
};
```

</details>

<details>
<summary><strong>Bun</strong></summary>

Bun refuses to emit files with unknown extensions. Declare the three binary asset types the dotnet runtime references:

```ts
import DotnetAssets from 'unplugin-dotnet-wasm/bun';

await Bun.build({
  // ...
  loader: {
    '.wasm': 'file',
    '.dat': 'file',
    '.pdb': 'file',
  },
  plugins: [
    DotnetAssets({
      projectName: 'MyLibrary',
      projectRoot: '../MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      isPublish: false,
    }),
  ],
});
```

</details>

<details>
<summary><strong>Farm</strong></summary>

Farm parses unknown extensions as JavaScript by default and injects `core-js` polyfills. Two options make it emit dotnet's binary assets cleanly without pulling in `core-js`:

```ts
import { defineConfig } from '@farmfe/core';
import DotnetAssets from 'unplugin-dotnet-wasm/farm';

export default defineConfig({
  compilation: {
    // ...
    assets: {
      include: ['wasm', 'dat', 'pdb'],   // treat as emittable static assets
    },
    output: {
      targetEnv: 'browser-esnext',       // skip core-js polyfill injection
    },
  },
  plugins: [
    DotnetAssets({
      projectName: 'MyLibrary',
      projectRoot: '../MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      isPublish: false,
    }),
  ],
});
```

</details>

### Runtime usage

Once the plugin is configured, import .NET assets as regular ES modules:

```ts
import { dotnet } from '_framework/dotnet';

const runtime = await dotnet.create();
runtime.runMain();
```

<details>
<summary><strong>Note on esbuild resource loading on Node</strong></summary>

When targeting Node with esbuild, the dotnet runtime a resource loader so the runtime can succesfully resolvee WASM URLs:

```ts
import { dotnet } from '_framework/dotnet';

const runtime = await dotnet
  .withResourceLoader((type, name, defaultUri) => new URL(defaultUri, import.meta.url).href)
  .create();
runtime.runMain();
```

</details>

## Configuration

Pass either a **project-discovery** config or an **explicit output dir** config.

### Project-discovery mode

Locates manifests under `<projectRoot>/bin/<configuration>/<targetFramework>[/publish]/`.

```ts
DotnetAssets({
  projectName: 'MyLibrary',    // * used to find manifest files
  projectRoot: '../MyLibrary', // * path to the directory containing the .csproj
  configuration: 'Debug',      // * MSBuild configuration, e.g. 'Debug' or 'Release'
  targetFramework: 'net10.0',  // * target framework moniker, e.g. 'net10.0'
  isPublish: false,            // true = read from the dotnet publish output layout
  logLevel: 'warn',            // 'silent' | 'error' | 'warn' | 'info' | 'debug' (default: 'warn')
})
```

All fields above are required except `logLevel`. `configuration` and `isPublish` typically pair as `(Debug, false)` for development and `(Release, true)` for production — set them to match your project's build pipeline.

### Explicit output dir mode

Use `dotnetOutputDir` when the .NET output is at a non-default path like a custom publish directory or when dotnet's [UseArtifactsOutput](https://learn.microsoft.com/en-us/dotnet/core/sdk/artifacts-output) is enabled.

```ts
DotnetAssets({
  projectName: 'MyLibrary',                    // * used to find manifest files
  dotnetOutputDir: '../MyLibrary/my-out-dir',  // * path to the .NET build/publish output dir
  logLevel: 'warn',                            // 'silent' | 'error' | 'warn' | 'info' | 'debug' (default: 'warn')
})
```

## Bundler support

| Bundler | Browser | Node | Dev server |
|---|---|---|---|
| Vite | ✅ Supported | ✅ Supported | ✅ Supported |
| Rollup | ✅ Supported | ✅ Supported | — |
| Rolldown | ✅ Supported | ✅ Supported | — |
| Webpack | ✅ Supported | ❌ Not supported[^webpack-family-node-no-support] | ✅ Supported |
| Rspack | ✅ Supported | ❌ Not supported[^webpack-family-node-no-support] | — |
| Rsbuild | ✅ Supported | ❌ Not supported[^webpack-family-node-no-support] | — |
| esbuild | ✅ Supported | ⚠️ Supported[^esbuild-node-partial-support] | — |
| Farm | ✅ Supported | ❌ Not supported[^farm-node-no-support] | — |
| Bun | ✅ Supported | ❌ Not supported[^bun-node-no-support] | — |

## Status & roadmap

The plugin is build-time only today. Scope so far and what's planned:

**Done**

- Build-time integration for multple bundlers ([table above](#bundler-support))
  - 9 on browser targets
  - 4 on Node targets 
- Both output layouts: scattered `dotnet build` and consolidated `dotnet publish`
- Fingerprint-aware resolution
- Binary asset emission (`.wasm`, `.dat`, `.pdb`) through each bundler's native pipeline[^bundlers-wasm-binary-no-plugin-support]
- Node built-ins externalized so the dotnet loader's Node paths don't break browser builds[^rollup-family-node-externals]
- IDE / language-server type support: editors and `tsc` are aware of the TypeScript emitted from your .NET WASM project like:
  - the SDK's own `dotnet.d.ts`
  - your own `.ts` files under `wwwroot`
  - generated output like `typeshim.ts` ([TypeShim](https://github.com/ArcadeMode/TypeShim))

**Planned**

1. Dev-server middleware: serve assets with the exact `Content-Type` / `Cache-Control` / `ETag` the production runtime expects
2. Watch / HMR: re-read manifests and invalidate on `dotnet build` / `dotnet watch` output changes — including live regeneration of the editor type shims so tsserver/`tsc` stay in sync without a restart
3. Node targets for esbuild, bun, webpack, rspack, rsbuild (pending the URL-string rewrite, see [architecture](../docs/architecture.md#cross-target-output-contract-why-node-support-is-a-subset))
4. Preload `<link>` injection from the endpoints manifest's preload metadata
5. Managed .NET builds (opt-in): optionally drive `dotnet build`/`watch` from the plugin, guaranteeing fresh assets and one-command dev
6. CLI codegen: prime editor type shims outside a build (e.g. in CI or after `npm ci`) for build-free `tsc` jobs
7. Prune orphaned generated type packages from `node_modules` when their backing .NET route goes away
8. Support default exports in generated shim files for types of ts files from the .NET output, today only named imports (`import { dotnet }`) are included

Design rationale for the decisions above lives in [`docs/architecture.md`](../../docs/architecture.md).

## Requirements

- Node.js >= 24
- .NET SDK >= 10 (build output must exist before bundling)
- TypeScript >= 5 (optional — enables editor / `tsc` type support for .NET WASM imports)

[^esbuild-node-partial-support]: esbuild works on Node but the runtime needs an explicit `.withResourceLoader(...)` call to resolve WASM URLs. See [Runtime usage](#runtime-usage).

[^webpack-family-node-no-support]: Webpack/Rspack/Rsbuild emit `URL` instances for asset imports; the dotnet runtime needs URL strings. Rewrite step pending — see [architecture](../docs/architecture.md#cross-target-output-contract-why-node-support-is-a-subset).

[^bun-node-no-support]: Bun emits bare strings for asset imports; the dotnet runtime needs URL strings. Rewrite step pending — see [architecture](../docs/architecture.md#cross-target-output-contract-why-node-support-is-a-subset).

[^farm-node-no-support]: Farm's `node-next` and `node` output modes split code into orphaned chunks so they never get loaded, might investigate further in the future (got tips? let me know)

[^bundlers-wasm-binary-no-plugin-support]: Bun and Farm can't be configured from within the plugin to emit .NET's binary assets (`.wasm`, `.dat`, `.pdb`); See the Bun and Farm examples above on how to configure it in the consuming project.

[^rollup-family-node-externals]: Rollup and Rolldown can't be configured from within the plugin to externalize Node built-ins; See the Rollup and Rolldown examples above on how to configure it in the consuming project.