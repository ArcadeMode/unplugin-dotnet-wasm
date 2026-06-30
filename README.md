# dotnet-wasm-bundler

Bundle .NET WebAssembly static assets into modern JS bundlers.

This monorepo contains:

| Package | Description |
|---|---|
| [`unplugin-dotnet-static-assets`](packages/unplugin-dotnet-static-assets) | Vite/Rollup/Webpack/esbuild plugin — mounts .NET static-web-assets as virtual modules |
| [`sample-vite`](packages/samples/sample-vite) | Minimal Vite app wired to a .NET WASM library |

## Quick start

```bash
# build the sample .NET library
pnpm build:sample

# build & preview the Vite sample
pnpm build:sample:vite
pnpm preview:sample
```

## Requirements

- Node.js >= 20, pnpm >= 9
- .NET 10 SDK
- [TypeShim](https://github.com/ArcadeMode/TypeShim) (NuGet, pulled automatically)
