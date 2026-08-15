# unplugin-dotnet-wasm

unplugin-dotnet-wasm enables bundling .NET [WebAssembly Browser Apps](https://learn.microsoft.com/en-us/aspnet/core/client-side/dotnet-interop/wasm-browser-app) and [Blazor WebAssembly Apps](https://learn.microsoft.com/en-us/aspnet/core/blazor/) with your favorite JavaScript bundler. Enable [WasmBundlerFriendlyBootConfig](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0?view=aspnetcore-10.0#javascript-bundler-support) and install the plugin: no configuration surgery, it just works. Compatible with `dotnet build` output and hooks into each bundler's watch mode and/or dev server to keep your dev loop fast. When you are ready for release it'll bundle the optimized `dotnet publish` output all the same.

Built on [unplugin](https://github.com/unjs/unplugin) to enable support for Vite, Webpack, Rollup, Rolldown, Rspack, Rsbuild, esbuild, Farm, and Bun.

> [!TIP]
> unplugin-dotnet-wasm pairs great with [TypeShim](https://github.com/ArcadeMode/TypeShim) for seamless .NET + TypeScript interop.

## Install

```bash
npm i -D unplugin-dotnet-wasm
```

> [!IMPORTANT]  
> Your .NET WebAssembly project must have [WasmBundlerFriendlyBootConfig](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0?view=aspnetcore-10.0#javascript-bundler-support) set to `true`.

## Usage

Register the plugin in your bundler config. The import path is the only thing that differs across bundlers; the `DotnetWasm({...})` call is identical everywhere. Options are documented under [Configuration](#configuration).

### Bundler examples

<details>
<summary><strong>Vite</strong></summary>

```ts
import { defineConfig } from 'vite';
import DotnetWasm from 'unplugin-dotnet-wasm/vite';

export default defineConfig({
  // ...
  plugins: [
    DotnetWasm({
      projectName: 'MyLibrary',
      projectRoot: '../MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      isPublish: false,
    }),
  ],
});
```

**Node target:** `vite build` emits a browser bundle by default. For Node, use a server environment and emit assets so `.wasm` / `.dat` / `.pdb` land in `dist`:

```ts
export default defineConfig({
  plugins: [
    DotnetWasm({
      projectName: 'MyLibrary',
      projectRoot: '../MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      isPublish: false,
    }),
  ],
  environments: {
    node: {
      consumer: 'server',
      build: {
        emitAssets: true, // omitted from non-client builds otherwise
        rolldownOptions: { // rollupOptions on Vite 5–7
          input: 'src/entry.ts',
        },
      },
    },
  },
  builder: {
    buildApp: async (builder) => {
      await builder.build(builder.environments.node); // skip the client environment
    },
  },
});
```

</details>

<details>
<summary><strong>Webpack</strong></summary>

```js
import DotnetWasm from 'unplugin-dotnet-wasm/webpack';

export default {
  // ...
  plugins: [
    DotnetWasm({
      projectName: 'MyLibrary',
      projectRoot: '../MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      isPublish: false,
    }),
  ],
};
```

**Node target:** emit ESM so the dotnet runtime's dynamic imports resolve at runtime:

```js
export default {
  // ...
  target: 'node',
  experiments: { outputModule: true },
  output: { module: true },
};
```

</details>

<details>
<summary><strong>Rollup</strong></summary>

Rollup does not resolve bare module specifiers on its own, so the dotnet runtime's internal imports need `@rollup/plugin-node-resolve`:

```js
import nodeResolve from '@rollup/plugin-node-resolve';
import DotnetWasm from 'unplugin-dotnet-wasm/rollup';

export default {
  // ...
  plugins: [
    nodeResolve({ browser: true }),   // omit `browser` when targeting Node
    DotnetWasm({
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
import DotnetWasm from 'unplugin-dotnet-wasm/esbuild';

await esbuild.build({
  // ...
  plugins: [
    DotnetWasm({
      projectName: 'MyLibrary',
      projectRoot: '../MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      isPublish: false,
    }),
  ],
  format: 'esm',
});
```

**Node target:** set `platform: 'node'` (keep `format: 'esm'`; esbuild's Node default is CJS):

```ts
await esbuild.build({
  // ...
  platform: 'node',
  format: 'esm',
});
```

</details>

<details>
<summary><strong>Rspack</strong></summary>

```js
import DotnetWasm from 'unplugin-dotnet-wasm/rspack';

export default {
  // ...
  plugins: [
    DotnetWasm({
      projectName: 'MyLibrary',
      projectRoot: '../MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      isPublish: false,
    }),
  ],
};
```

**Node target:** emit ESM so the dotnet runtime's dynamic imports resolve at runtime, and set `publicPath: 'auto'` so asset URLs resolve:

```js
export default {
  // ...
  target: 'node',
  experiments: { outputModule: true },
  output: {
    module: true,
    publicPath: 'auto',
  },
};
```

</details>

<details>
<summary><strong>Rsbuild</strong></summary>

```ts
import { defineConfig } from '@rsbuild/core';
import DotnetWasm from 'unplugin-dotnet-wasm/rsbuild';

export default defineConfig({
  // ...
  plugins: [
    DotnetWasm({
      projectName: 'MyLibrary',
      projectRoot: '../MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      isPublish: false,
    }),
  ],
});
```

**Node target:** emit ESM so the dotnet runtime's dynamic imports resolve at runtime, and set `publicPath: 'auto'` so asset URLs resolve:

```ts
export default defineConfig({
  // ...
  output: { target: 'node' },
  tools: {
    rspack: (config) => {
      config.experiments = { ...config.experiments, outputModule: true };
      config.output = {
        ...config.output,
        module: true,
        publicPath: 'auto',
      };
      return config;
    },
  },
});
```

</details>

<details>
<summary><strong>Rolldown</strong></summary>

```js
import DotnetWasm from 'unplugin-dotnet-wasm/rolldown';

export default {
  // ...
  plugins: [
    DotnetWasm({
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
import DotnetWasm from 'unplugin-dotnet-wasm/bun';

await Bun.build({
  // ...
  plugins: [
    DotnetWasm({
      projectName: 'MyLibrary',
      projectRoot: '../MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      isPublish: false,
    }),
  ],
  loader: {
    '.wasm': 'file',
    '.dat': 'file',
    '.pdb': 'file',
  },
});
```

**Node target:** Bun's default target is the browser. For Node:

```ts
await Bun.build({
  // ...
  target: 'node',
});
```

</details>

<details>
<summary><strong>Farm</strong></summary>

Farm parses unknown extensions as JavaScript by default and injects `core-js` polyfills. Declare the three binary asset types the dotnet runtime references, and set `targetEnv` to `'browser-esnext'` (or `'node-next'` on Node) to skip polyfill injection:

```ts
import { defineConfig } from '@farmfe/core';
import DotnetWasm from 'unplugin-dotnet-wasm/farm';

export default defineConfig({
  // ...
  plugins: [
    DotnetWasm({
      projectName: 'MyLibrary',
      projectRoot: '../MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      isPublish: false,
    }),
  ],
  compilation: {
    assets: {
      include: ['wasm', 'dat', 'pdb'],
    },
    output: {
      targetEnv: 'browser-esnext',
    },
  },
});
```

**Node target:** keep the boot graph in a single chunk and force asset URLs (`mode: 'browser'`). Node's default asset mode emits filesystem paths, but the dotnet bootstrapper expects URLs (will still read from disk):

```ts
export default defineConfig({
  // ...
  compilation: {
    assets: {
      include: ['wasm', 'dat', 'pdb'],
      mode: 'browser',
    },
    output: {
      targetEnv: 'node-next',
    },
    partialBundling: {
      enforceResources: [{ name: 'entry', test: ['.+'] }],
    },
  },
});
```

</details>

### Runtime usage

Once the plugin is configured, import .NET assets as regular ES modules. How you boot depends on your app type.

#### WebAssembly Browser App

Dotnet is imported from the `_framework/dotnet` module to create the runtime and start your app.

```ts
import { dotnet } from '_framework/dotnet';

const runtime = await dotnet.create();
runtime.runMain();
```

#### Blazor WebAssembly App

Blazor boots through `_framework/blazor.webassembly.js`. Importing it assigns `window.Blazor`:

```ts
import '_framework/blazor.webassembly.js';

await window.Blazor.start(); // only if bundle loaded as module or with autostart=false
```

> [!IMPORTANT]
> Loading your bundle as `<script type="module">` stops Blazor from autostarting. If your bundle is loaded as a classic script without `autostart=false` then Blazor will boot automatically.

### Dev server

The plugin works with the bundler's dev server out of the box - start it as usual (`vite`, `webpack serve`, `rspack serve`, `rsbuild dev`, `farm dev`) and the .NET WASM app boots with no extra config. Assets are served with the exact `Content-Type` / `Cache-Control` / `ETag` the production runtime expects.

### Watch mode

The plugin guarantees that the latest assets are served in watch modes (`vite build --watch`, `webpack --watch`, `rsbuild -w` etc). Supported bundlers are found in the [support matrix](#bundler-support).

## Configuration

Pass either a **project-discovery** config or an **explicit output dir** config.

### Project-discovery mode

Locates manifests under `<projectRoot>/bin/<configuration>/<targetFramework>[/publish]/`.

```ts
DotnetWasm({
  projectName: 'MyLibrary',    // * used to find manifest files
  projectRoot: '../MyLibrary', // * path to the directory containing the .csproj
  configuration: 'Debug',      // * MSBuild configuration, e.g. 'Debug' or 'Release'
  targetFramework: 'net10.0',  // * target framework moniker, e.g. 'net10.0'
  isPublish: false,            // true = read from the dotnet publish output layout
  logLevel: 'warn',            // 'silent' | 'error' | 'warn' | 'info' | 'debug' (default: 'warn')
})
```

All fields above are required except `logLevel`. `configuration` and `isPublish` typically pair as `(Debug, false)` for development and `(Release, true)` for production - set them to match your project's build pipeline.

### Explicit output dir mode

Use `dotnetOutputDir` when the .NET output is at a non-default path like a custom publish directory or when dotnet's [UseArtifactsOutput](https://learn.microsoft.com/en-us/dotnet/core/sdk/artifacts-output) is enabled.

```ts
DotnetWasm({
  projectName: 'MyLibrary',                    // * used to find manifest files
  dotnetOutputDir: '../MyLibrary/my-out-dir',  // * path to the .NET build/publish output dir
  logLevel: 'warn',                            // 'silent' | 'error' | 'warn' | 'info' | 'debug' (default: 'warn')
})
```

## Bundler support

| Bundler | Browser | Node | Dev server | Watch mode |
|---|---|---|---|---|
| Vite | ✅ | ✅[^vite-node-env] | ✅ | ✅ |
| Rollup | ✅ | ✅ | -[^rollup-family-no-dev-server] | ✅ |
| Rolldown | ✅ | ✅ | -[^rollup-family-no-dev-server] | ✅ |
| Webpack | ✅ | ✅[^webpack-node-esm] | ✅ | ✅ |
| Rspack | ✅ | ✅[^rspack-node-esm] | ✅ | ✅ |
| Rsbuild | ✅ | ✅[^rsbuild-node-esm] | ✅ | ✅ |
| esbuild | ✅ | ✅ | -[^esbuild-no-dev-server] | ✅ |
| Farm | ✅ | ✅[^farm-node-esm] | ✅ | ✅ |
| Bun | ✅ | ✅ | -[^bun-no-dev-server] | -[^bun-no-watch] |

## Status & roadmap

The plugin is build-time only today. Scope so far and what's planned:

**Done**

- Build-time integration for multple bundlers ([table above](#bundler-support))
  - 9 on browser targets
  - 9 on Node targets 
- Both output layouts: scattered `dotnet build` and consolidated `dotnet publish`
- Dev-server support for Vite, Webpack, Rspack, Rsbuild, and Farm ([table above](#bundler-support))
- Fingerprint-agnostic and multi-content-root asset resolution
- Binary asset emission (`.wasm`, `.dat`, `.pdb`) through each bundler's native pipeline[^bundlers-wasm-binary-no-plugin-support]
- Node built-ins externalized so the dotnet loader's Node paths don't break browser builds[^rollup-family-node-externals]
- IDE / language-server type support: editors and `tsc` are aware of the TypeScript emitted from your .NET WASM project like:
  - the SDK's own `dotnet.d.ts`[^dotnet-dts-net11]
  - your own `.ts` files under `wwwroot`
  - generated output like `typeshim.ts` ([TypeShim](https://github.com/ArcadeMode/TypeShim))
  - type-less `.js` assets (e.g. the SDK's `blazor.webassembly.js` boot module), compiled to a best-effort `.d.ts` so bare imports resolve without a hand-written `declare module`[^js-shim-any] — reachable both with and without the `.js` extension (e.g. `_framework/blazor.webassembly.js` and `_framework/blazor.webassembly`)[^shim-casing]

**Planned**

1. Watch / HMR: re-read manifests and invalidate on `dotnet build` / `dotnet watch` output changes - including live regeneration of the editor type shims so tsserver/`tsc` stay in sync without a restart
2. Preload `<link>` injection from the endpoints manifest's preload metadata
3. Support default exports in generated shim files for types of ts files from the .NET output, today only named imports (`import { dotnet }`) are included (requires some .NET 11 SDK testing)

Design rationale for the decisions above lives in [`docs/architecture.md`](../docs/architecture.md).

## Requirements

- Node.js >= 24
- .NET SDK >= 10 (build output must exist before bundling)
- TypeScript >= 5 (optional - enables editor / `tsc` type support for .NET WASM imports)

[^vite-node-env]: Node support requires a Vite server environment (`consumer: 'server'`), `build.emitAssets: true`, and `builder.buildApp` so the client bundle is skipped. See the Vite example above.

[^webpack-node-esm]: Node support requires ESM output (`experiments.outputModule`, `output.module: true`, `target: 'node'`). See the Webpack example above.

[^rspack-node-esm]: Node support requires ESM output (`experiments.outputModule`, `output.module: true`, `output.publicPath: 'auto'`, `target: 'node'`). See the Rspack example above.

[^rsbuild-node-esm]: Node support requires ESM output - set `output.target: 'node'` and use `tools.rspack` to enable `experiments.outputModule`, `output.module: true`, and `output.publicPath: 'auto'`. See the Rsbuild example above.

[^farm-node-esm]: Node support requires a single-chunk Node build (`output.targetEnv: 'node-next'`, `compilation.assets.mode: 'browser'`, `partialBundling.enforceResources`). See the Farm example above.

[^bundlers-wasm-binary-no-plugin-support]: Bun and Farm can't be configured from within the plugin to emit .NET's binary assets (`.wasm`, `.dat`, `.pdb`); See the Bun and Farm examples above on how to configure it in the consuming project.

[^rollup-family-node-externals]: Rollup and Rolldown can't be configured from within the plugin to externalize Node built-ins; See the Rollup and Rolldown examples above on how to configure it in the consuming project.

[^rollup-family-no-dev-server]: Rollup and Rolldown have no standalone dev server; use Vite (same Rollup-family code path) for a dev-server workflow.

[^esbuild-no-dev-server]: esbuild's serve mode exposes no middleware API, so out-of-tree assets can't be served through the plugin.

[^bun-no-dev-server]: Bun's dev server (1.3+) is app-owned (`Bun.serve`) and exposes no plugin middleware hook, so the plugin can't serve out-of-tree assets through it. Middleware support is tracked upstream in [oven-sh/bun#17608](https://github.com/oven-sh/bun/issues/17608).

[^bun-no-watch]: Bun's build API has no watch mode, so the plugin can't re-run on source changes. Watch support is tracked upstream in [oven-sh/bun#4689](https://github.com/oven-sh/bun/issues/4689).

[^dotnet-dts-net11]: As of .NET 11, the MSBuild property `WasmEmitTypeScriptDefinitions=true` includes `dotnet.d.ts` in the build output.

[^js-shim-any]: A type-less `.js` asset is compiled through `tsc --allowJs`, so the types are whatever TypeScript can infer from the (often minified) source — frequently `any`. A no-export module (like `blazor.webassembly.js`) yields an empty declaration, which still satisfies side-effect imports (`import '_framework/blazor.webassembly.js';`), including under `noUncheckedSideEffectImports`.

[^shim-casing]: Generated specifiers are lower-cased (the plugin's asset lookup is case-insensitive), so a mixed-case asset such as `_framework/Microsoft.DotNet.HotReload.WebAssembly.Browser.lib.module.js` is only typed via its lower-cased specifier; import it in lower case, or add a manual `declare module` for the exact casing.
