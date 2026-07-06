# unplugin-dotnet-static-assets

Mount .NET static-web-assets output as a virtual module namespace for Vite, Webpack, Rollup, and esbuild.

The plugin reads the static-web-assets manifests emitted by `dotnet build` / `dotnet publish` and
exposes every framework asset (`.wasm`, `.js`, `.dat`, `.pdb`, `.d.ts`) through the bundler's
module graph — no manual copy step, no public-dir hacks.

## Install

```bash
npm i -D unplugin-dotnet-static-assets unplugin
```

## Usage

<details>
<summary><strong>Vite</strong></summary>

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import DotnetAssets from 'unplugin-dotnet-static-assets/vite';

export default defineConfig({
  plugins: [
    DotnetAssets({
      projectRoot: '../MyLibrary',
      projectName: 'MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
    }),
  ],
});
```

</details>

<details>
<summary><strong>Rollup</strong></summary>

```ts
// rollup.config.js
import DotnetAssets from 'unplugin-dotnet-static-assets/rollup';

export default {
  plugins: [
    DotnetAssets({
      projectRoot: '../MyLibrary',
      projectName: 'MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
    }),
  ],
};
```

</details>

<details>
<summary><strong>Webpack</strong></summary>

```ts
// webpack.config.js
import DotnetAssets from 'unplugin-dotnet-static-assets/webpack';

module.exports = {
  plugins: [
    DotnetAssets({
      projectRoot: '../MyLibrary',
      projectName: 'MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
    }),
  ],
};
```

</details>

<details>
<summary><strong>esbuild</strong></summary>

```ts
import { build } from 'esbuild';
import DotnetAssets from 'unplugin-dotnet-static-assets/esbuild';

build({
  plugins: [
    DotnetAssets({
      projectRoot: '../MyLibrary',
      projectName: 'MyLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
    }),
  ],
});
```

</details>

Once the plugin is configured, import .NET assets as regular ES modules:

```ts
import { dotnet } from './_framework/dotnet';
import { TypeShimInitializer, Counter } from './typeshim';

const runtime = await dotnet.create();
await TypeShimInitializer.initialize(runtime);
runtime.runMain();

const counter = new Counter(0);
counter.Increment();
console.log(counter.Value); // 1
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `projectName` | `string` | *required* | .NET project name (used to find manifest files) |
| `projectRoot` | `string` | — | Path to the directory containing the `.csproj` |
| `configuration` | `string` | `'Debug'` | MSBuild configuration |
| `targetFramework` | `string` | — | Target framework moniker (e.g. `'net10.0'`) |
| `isPublish` | `boolean` | `false` | Use `dotnet publish` output layout |
| `dotnetOutputDir` | `string` | — | Explicit path to the build/publish output directory (alternative to `projectRoot`) |
| `logLevel` | `string` | `'warn'` | `'silent'` \| `'error'` \| `'warn'` \| `'info'` \| `'debug'` |

Either `projectRoot` or `dotnetOutputDir` must be provided (not both).

## Bundler support

| Bundler | Browser | Node |
|---|---|---|
| Vite | ✅ Supported | ✅ Supported |
| Rollup | ✅ Supported | ✅ Supported |
| Rolldown | ✅ Supported | ✅ Supported |
| Webpack | ✅ Supported | — |
| Rspack | ✅ Supported | — |
| Rsbuild | ✅ Supported | — |
| esbuild | ✅ Supported | ⚠️ Supported[^esbuild-node-partial-support] |
| Farm | ✅ Supported | ❌ Not supported[^farm-node-no-support] |
| Bun | ✅ Supported | — |

## How it works

1. Reads `<ProjectName>.staticwebassets.runtime.json` and `<ProjectName>.staticwebassets.endpoints.json` from the .NET build output
2. Builds a virtual filesystem mapping canonical routes to physical files across content roots
3. Resolves fingerprinted filenames via the endpoints manifest (e.g. `dotnet.js` → `dotnet.abc123.js`)
4. Emits binary assets (`.wasm`, `.dat`, `.pdb`) through Rollup's `emitFile` for content-hashed output
5. Falls through `.ts` and `.js` files to the bundler's own transform pipeline

## Requirements

- Node.js >= 20
- .NET 10 SDK (build output must exist before bundling)
- `unplugin` >= 2.0.0

[^esbuild-node-partial-support] esbuild works on node but requires `withResourceLoader` to fix WASM asset resolution.
```
await dotnet
  .withResourceLoader((type: string, name: string, defaultUri: string) => new URL(defaultUri, import.meta.url).href)
  .create();
```

[^farm-node-no-support] Farm's `node-next` and `node` output modes split code into orphaned chunks without a linker; the module system runtime is emitted but chunks are never imported or executed. This architectural limitation affects virtual-module-heavy bundling scenarios like dotnet static-web-assets. Farm's HTML orchestration works correctly for browser targets.