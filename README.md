<h1 align=center tabindex=-1>unplugin-dotnet-wasm</h1>
<p align=center tabindex=-1>
  <i>Drop .NET WASM apps into JS projects like any other dependency</i><br/>
  <i>Works with every major bundler, straight from `dotnet build`</i>
</p>

<img align="right" tabindex=-1 src="https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/ArcadeMode/70747793e15450ee02945775bfbbc4b5/raw/unplugin-dotnet-wasm-badge.json" alt="Test status" />


## Why unplugin-dotnet-wasm

unplugin-dotnet-wasm enables bundling .NET [WebAssembly Browser Apps](https://learn.microsoft.com/en-us/aspnet/core/client-side/dotnet-interop/wasm-browser-app) and [Blazor WebAssembly Apps](https://learn.microsoft.com/en-us/aspnet/core/blazor/) with your favorite JavaScript bundler. Enable [WasmBundlerFriendlyBootConfig](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0?view=aspnetcore-10.0#javascript-bundler-support) and install the plugin: no configuration surgery, it just works. Compatible with `dotnet build` output and hooks into each bundler's watch mode and/or dev server to keep your dev loop fast. When you are ready for release it'll bundle the optimized `dotnet publish` output all the same.

Built on [unplugin](https://github.com/unjs/unplugin) to enable support for Vite, Webpack, Rollup, Rolldown, Rspack, Rsbuild, esbuild, Farm, and Bun.

> [!TIP]
> unplugin-dotnet-wasm pairs great with [TypeShim](https://github.com/ArcadeMode/TypeShim) for seamless .NET + TypeScript interop.

## Install

```bash
npm i -D unplugin-dotnet-wasm
```

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

When the output from your dotnet project changes, the dev server picks this up automatically and the plugin guarantees that the latest assets will be loaded into the next build.

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

## Run the sample

Make sure to have Node 24+ and .NET 10 SDK installed. 

If you dont have `pnpm` installed yet:
```bash
npm install -g pnpm 
# or
corepack enable && corepack prepare pnpm@latest --activate
```

Then install dependencies
```bash
pnpm install
```

Run the bundled wasm lib sample
```bash
# WebAssembly Browser app bundled by vite
pnpm build:sample:vite-wasm
pnpm dev:sample:vite-wasm
#or use preview to serve the dist folder without dev server
#pnpm preview:sample:vite-wasm
```
Or run the bundled blazor sample
```bash
# Blazor WebAssembly component library bundled by vite and rendered as custom elements
pnpm build:sample:vite-blazor
pnpm dev:sample:vite-blazor
#or use preview to serve the dist folder without dev server
#pnpm preview:sample:vite-blazor
```

Or run the bundled full blazor sample
```bash
# Blazor WebAssembly full app bundled by webpack and runs as blazor app with TypeScript bindings on Counter page
pnpm build:sample:webpack-blazor
pnpm dev:sample:webpack-blazor
#or use preview to serve the dist folder without dev server
#pnpm preview:sample:webpack-blazor
```

Other bundler samples can be found in the `./test/fixtures/[browser|node]` directories.

Testing the `bun` integration additionally requires Bun >= 1.3.

> To quickly set up all dependencies for the repo run: `./dev-env-init.ps1`

## Requirements

- Node.js >= 24
- .NET SDK >= 10 (build output must exist before bundling)
- TypeScript >= 5 (optional - enables editor / `tsc` type support for .NET WASM imports)

[^vite-node-env]: Node support requires a Vite server environment (`consumer: 'server'`), `build.emitAssets: true`, and `builder.buildApp` so the client bundle is skipped. See the Vite example above.

[^webpack-node-esm]: Node support requires ESM output (`experiments.outputModule`, `output.module: true`, `target: 'node'`). See the Webpack example above.

[^rspack-node-esm]: Node support requires ESM output (`experiments.outputModule`, `output.module: true`, `output.publicPath: 'auto'`, `target: 'node'`). See the Rspack example above.

[^rsbuild-node-esm]: Node support requires ESM output - set `output.target: 'node'` and use `tools.rspack` to enable `experiments.outputModule`, `output.module: true`, and `output.publicPath: 'auto'`. See the Rsbuild example above.

[^farm-node-esm]: Node support requires a single-chunk Node build (`output.targetEnv: 'node-next'`, `compilation.assets.mode: 'browser'`, `partialBundling.enforceResources`). See the Farm example above.

[^rollup-family-no-dev-server]: Rollup and Rolldown have no standalone dev server; use Vite (same Rollup-family code path) for a dev-server workflow.

[^esbuild-no-dev-server]: esbuild's serve mode exposes no middleware API, so out-of-tree assets can't be served through the plugin.

[^bun-no-dev-server]: Bun's dev server (1.3+) is app-owned (`Bun.serve`) and exposes no plugin middleware hook, so the plugin can't serve out-of-tree assets through it. Middleware support is tracked upstream in [oven-sh/bun#17608](https://github.com/oven-sh/bun/issues/17608).

[^bun-no-watch]: Bun's build API has no watch mode, so the plugin can't re-run on source changes. Watch support is tracked upstream in [oven-sh/bun#4689](https://github.com/oven-sh/bun/issues/4689).

[^dotnet-dts-net11]: As of .NET 11, the MSBuild property `WasmEmitTypeScriptDefinitions=true` includes `dotnet.d.ts` in the build output.
