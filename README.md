<h1 align=center tabindex=-1>unplugin-dotnet-wasm</h1>
<p align=center tabindex=-1>
  <i>Import .NET WebAssembly Browser Apps into your JS bundler like any other module</i><br/>
  <i>Works with Vite, Webpack, Rollup, and every other unplugin-supported bundler, straight from `dotnet build`</i>
</p>

## Why unplugin-dotnet-wasm

unplugin-dotnet-wasm enables importing .NET [WebAssembly Browser Apps](https://learn.microsoft.com/en-us/aspnet/core/client-side/dotnet-interop/wasm-browser-app) through your favorite JavaScript bundler's own module graph: no manual copy step, no public-dir hacks, and it works against the fast `dotnet build`, saving the slow `dotnet publish` for when you are actually publishing.

Built on [unplugin](https://github.com/unjs/unplugin), so one integration covers Vite, Webpack, Rollup, Rolldown, Rspack, Rsbuild, esbuild, Farm, and Bun.

> [!TIP]
> Works great with WebAssembly Browser Apps powered by [TypeShim](https://github.com/ArcadeMode/TypeShim)

## Install

```bash
npm i -D unplugin-dotnet-wasm
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import DotnetAssets from 'unplugin-dotnet-wasm/vite';

export default defineConfig({
  plugins: [
    DotnetAssets({
      projectRoot: '../MyLibrary',
      projectName: 'MyLibrary',
      targetFramework: 'net10.0',
    }),
  ],
});
```

See the [package README](packages/unplugin-dotnet-wasm/README.md) for the other bundlers, the full options table, and how to import the assets at runtime.

## Requirements

- Node.js >= 24
- .NET 10 SDK, project built with `WasmBundlerFriendlyBootConfig=true`
- `unplugin` >= 3.3.0

## Documentation

- [Package README](packages/unplugin-dotnet-wasm/README.md): install, per-bundler setup, options, and the bundler support matrix.
- [Architecture](docs/architecture.md): the problem, the manifest-driven design, and the rationale behind each decision.

## Developing this repo

pnpm workspace, ESM-only, Node 24+, TypeScript strict. See [AGENTS.md](AGENTS.md) for the full build and test matrix.

```bash
# build the sample .NET library, then build & preview the Vite sample
pnpm build:sample
pnpm build:sample:vite
pnpm preview:sample
```

Testing the `bun` integration additionally requires Bun >= 1.3.
