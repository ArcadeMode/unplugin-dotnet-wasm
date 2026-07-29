# unplugin-dotnet-wasm

unplugin-dotnet-wasm enables importing .NET [WebAssembly Browser Apps](https://learn.microsoft.com/en-us/aspnet/core/client-side/dotnet-interop/wasm-browser-app) through your favorite JavaScript bundler's own module graph: no project configuration surgery, it just works. Compatible with `dotnet build` output to keep your inner dev loop fast, saving the slower `dotnet publish` for when you are actually publishing.

Built on [unplugin](https://github.com/unjs/unplugin), so one integration covers Vite, Webpack, Rollup, Rolldown, Rspack, Rsbuild, esbuild, Farm, and Bun.

> [!TIP]
> unplugin-dotnet-wasm pairs great with [TypeShim](https://github.com/ArcadeMode/TypeShim) for a seamless .NET > JS experience.

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
  loader: {
    '.wasm': 'file',
    '.dat': 'file',
    '.pdb': 'file',
  },
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

</details>

<details>
<summary><strong>Farm</strong></summary>

Farm parses unknown extensions as JavaScript by default and injects `core-js` polyfills. Two options make it emit dotnet's binary assets cleanly without pulling in `core-js`:

```ts
import { defineConfig } from '@farmfe/core';
import DotnetWasm from 'unplugin-dotnet-wasm/farm';

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

</details>

### Runtime usage

Once the plugin is configured, import .NET assets as regular ES modules:

```ts
import { dotnet } from '_framework/dotnet';

const runtime = await dotnet.create();
runtime.runMain();
```

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
| Vite | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported |
| Rollup | ✅ Supported | ✅ Supported | -[^rollup-family-no-dev-server] | ✅ Supported |
| Rolldown | ✅ Supported | ✅ Supported | -[^rollup-family-no-dev-server] | ✅ Supported |
| Webpack | ✅ Supported | ✅ Supported[^webpack-node-esm] | ✅ Supported | ✅ Supported |
| Rspack | ✅ Supported | ✅ Supported[^rspack-node-esm] | ✅ Supported | ✅ Supported |
| Rsbuild | ✅ Supported | ✅ Supported[^rsbuild-node-esm] | ✅ Supported | ✅ Supported |
| esbuild | ✅ Supported | ✅ Supported | -[^esbuild-no-dev-server] | - |
| Farm | ✅ Supported | ✅ Supported[^farm-node-esm] | ✅ Supported | - |
| Bun | ✅ Supported | ✅ Supported | -[^bun-no-dev-server] | - |

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

**Planned**

1. Watch / HMR: re-read manifests and invalidate on `dotnet build` / `dotnet watch` output changes - including live regeneration of the editor type shims so tsserver/`tsc` stay in sync without a restart
2. Preload `<link>` injection from the endpoints manifest's preload metadata
3. Support default exports in generated shim files for types of ts files from the .NET output, today only named imports (`import { dotnet }`) are included (requires some .NET 11 SDK testing)

Design rationale for the decisions above lives in [`docs/architecture.md`](../docs/architecture.md).

## Requirements

- Node.js >= 24
- .NET SDK >= 10 (build output must exist before bundling)
- TypeScript >= 5 (optional - enables editor / `tsc` type support for .NET WASM imports)

[^webpack-node-esm]: Node support requires ESM output - set webpack's `experiments.outputModule` and `output.module: true` with `target: 'node'` (the same ESM output every other Node target uses).

[^rspack-node-esm]: Node support requires ESM output - set rspack's `experiments.outputModule`, `output.module: true`, and `output.publicPath: 'auto'` with `target: 'node'`.

[^rsbuild-node-esm]: Node support requires ESM output - set `output.target: 'node'` and use `tools.rspack` to enable `experiments.outputModule`, `output.module: true`, and `output.publicPath: 'auto'`.

[^farm-node-esm]: Node support requires ESM output as a single chunk - set `output.targetEnv: 'node'` (or `'node-next'`), `output.format: 'esm'`, `compilation.assets.mode: 'browser'`, and `partialBundling.enforceResources: [{ name: 'entry', test: ['.+'] }]`.

[^bundlers-wasm-binary-no-plugin-support]: Bun and Farm can't be configured from within the plugin to emit .NET's binary assets (`.wasm`, `.dat`, `.pdb`); See the Bun and Farm examples above on how to configure it in the consuming project.

[^rollup-family-node-externals]: Rollup and Rolldown can't be configured from within the plugin to externalize Node built-ins; See the Rollup and Rolldown examples above on how to configure it in the consuming project.

[^rollup-family-no-dev-server]: Rollup and Rolldown have no standalone dev server; use Vite (same Rollup-family code path) for a dev-server workflow.

[^esbuild-no-dev-server]: esbuild's serve mode exposes no middleware API, so out-of-tree assets can't be served through the plugin.

[^bun-no-dev-server]: Bun's dev server (1.3+) is app-owned (`Bun.serve`) and exposes no plugin middleware hook, so the plugin can't serve out-of-tree assets through it. Middleware support is tracked upstream in [oven-sh/bun#17608](https://github.com/oven-sh/bun/issues/17608).

[^dotnet-dts-net11]: As of .NET 11, the MSBuild property `WasmEmitTypeScriptDefinitions=true` includes `dotnet.d.ts` in the build output.