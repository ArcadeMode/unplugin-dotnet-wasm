# unplugin-dotnet-wasm

Mount .NET static-web-assets output as a virtual module namespace for Vite, Webpack, Rollup, and esbuild.

The plugin reads the static-web-assets manifests emitted by `dotnet build` / `dotnet publish` and
exposes every framework asset (`.wasm`, `.js`, `.dat`, `.pdb`, `.d.ts`) through the bundler's
module graph — no manual copy step, no public-dir hacks.

## Install

```bash
npm i -D unplugin-dotnet-wasm unplugin
```

## Usage

<details>
<summary><strong>Vite</strong></summary>

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import DotnetAssets from 'unplugin-dotnet-wasm/vite';

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
import DotnetAssets from 'unplugin-dotnet-wasm/rollup';

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
import DotnetAssets from 'unplugin-dotnet-wasm/webpack';

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
import DotnetAssets from 'unplugin-dotnet-wasm/esbuild';

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

## Status & roadmap

The plugin is build-time only today. Scope so far and what's planned:

**Done**

- Build-time integration for multple bundlers ([table above](#bundler-support))
  - 9 on browser targets
  - 4 on Node targets 
- Both output layouts: scattered `dotnet build` and consolidated `dotnet publish`
- Fingerprint-aware resolution (canonical imports → hashed physical files)
- Binary asset emission (`.wasm`, `.dat`, `.pdb`) through each bundler's native pipeline
- Node built-ins externalized so the dotnet loader's Node paths don't break browser builds

**Planned**

1. IDE parity: emit a `tsconfig` + ambient `.d.ts` so editors see the same virtual tree the bundler does
2. Dev-server middleware: serve assets with the exact `Content-Type` / `Cache-Control` / `ETag` the production runtime expects
3. Node targets for esbuild, bun, webpack, rspack, rsbuild (pending the URL-string rewrite, see [architecture](../../docs/architecture.md#cross-target-output-contract-why-node-support-is-a-subset))
4. Preload `<link>` injection from the endpoints manifest's preload metadata
5. Watch / HMR: re-read manifests and invalidate on `dotnet build` / `dotnet watch` output changes

Design rationale for the decisions above lives in [`docs/architecture.md`](../../docs/architecture.md).

## Requirements

- Node.js >= 24
- .NET 10 SDK (build output must exist before bundling)
- `unplugin` >= 3.3.0

[^esbuild-node-partial-support]: esbuild works on node but requires `dotnet.withResourceLoader((type: string, name: string, defaultUri: string) => new URL(defaultUri, import.meta.url).href)` to fix WASM asset resolution.

[^farm-node-no-support]: Farm's `node-next` and `node` output modes split code into orphaned chunks without a linker; the module system runtime is emitted but chunks are never imported or executed. This architectural limitation affects virtual-module-heavy bundling scenarios like dotnet static-web-assets. Farm's HTML orchestration works correctly for browser targets.
