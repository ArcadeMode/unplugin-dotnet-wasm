<h1 align=center tabindex=-1>unplugin-dotnet-wasm</h1>
<p align=center tabindex=-1>
  <i>Drop .NET WASM apps into JS projects like any other dependency</i><br/>
  <i>Works with every major bundler, straight from `dotnet build`</i>
</p>

<img align="right" tabindex=-1 src="https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/ArcadeMode/70747793e15450ee02945775bfbbc4b5/raw/unplugin-dotnet-wasm-badge.json" alt="Test status" />


## Why unplugin-dotnet-wasm

unplugin-dotnet-wasm bundles .NET [WebAssembly Browser Apps](https://learn.microsoft.com/en-us/aspnet/core/client-side/dotnet-interop/wasm-browser-app) and [Blazor WebAssembly Apps](https://learn.microsoft.com/en-us/aspnet/core/blazor/) with a JavaScript bundler. Set [WasmBundlerFriendlyBootConfig](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0?view=aspnetcore-10.0#javascript-bundler-support) on the .NET project, register the plugin, and import `_framework/dotnet` or Blazor's `_framework/blazor.webassembly.js` like any other module. Compatible with `dotnet build` output and with optimized `dotnet publish` output; hooks into watch mode and/or the bundler's dev server so the inner loop stays on `dotnet build`.

Built on [unplugin](https://github.com/unjs/unplugin): Vite, Webpack, Rollup, Rolldown, Rspack, Rsbuild, esbuild, Farm, and Bun.

> [!TIP]
> unplugin-dotnet-wasm pairs great with [TypeShim](https://github.com/ArcadeMode/TypeShim) for seamless .NET + TypeScript interop.

## Install

```bash
npm i -D unplugin-dotnet-wasm
```

Usage, configuration, and per-bundler examples: **[unplugin-dotnet-wasm/README.md](unplugin-dotnet-wasm/README.md)**.

Why the plugin is shaped this way: [docs/architecture.md](docs/architecture.md).

## Run the samples

Make sure to have Node 24+ and .NET 10 SDK installed.

If you don't have `pnpm` installed yet:
```bash
npm install -g pnpm
# or
corepack enable && corepack prepare pnpm@latest --activate
```

Then install dependencies
```bash
pnpm install
```

The samples are a few apps that bundle one of the .NET libraries in `samples/libraries/`. The apps (`samples/apps/`) can be launched by running the following commands from the repo root.

```bash
# Vite + vanilla js + WASM library
pnpm build:sample:vite-wasm
pnpm dev:sample:vite-wasm

# Vite + vanilla js + Blazor custom elements
pnpm build:sample:vite-blazor
pnpm dev:sample:vite-blazor

# Webpack + full Blazor app
pnpm build:sample:webpack-blazor
pnpm dev:sample:webpack-blazor

# Rsbuild + React + Blazor custom elements
pnpm build:sample:rsbuild-react
pnpm dev:sample:rsbuild-react

# Farm + React + WASM library
pnpm build:sample:farm-react
pnpm dev:sample:farm-react

# esbuild + Node CLI + WASM library
pnpm build:sample:esbuild-node
pnpm start:sample:esbuild-node
```

Testing the `bun` integration additionally requires Bun >= 1.3.

> To quickly set up all dependencies for the repo run: `./dev-env-init.ps1`

## Requirements

- Node.js >= 24
- .NET SDK >= 10 (build output must exist before bundling)
- TypeScript >= 5 (optional - enables editor / `tsc` type support for .NET WASM imports)

Build, test, and lint commands for this repo: [AGENTS.md](AGENTS.md).
