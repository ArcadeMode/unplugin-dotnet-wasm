# dotnet-wasm-bundler

Bundle .NET WebAssembly static assets into modern JS bundlers.

This monorepo contains:

| Package | Description |
|---|---|
| [`unplugin-dotnet-wasm`](packages/unplugin-dotnet-wasm) | Vite/Rollup/Webpack/esbuild plugin — mounts .NET WebAssembly as virtual modules |
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

- .NET 10 SDK
- Node.js >= 20, pnpm >= 9
- Bun >= 1.3 (optional, required only for testing the `bun` bundler integration)
- [TypeShim](https://github.com/ArcadeMode/TypeShim) (NuGet, pulled automatically)
