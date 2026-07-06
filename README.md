<h1 align=center tabindex=-1>unplugin-dotnet-wasm</h1>
<p align=center tabindex=-1>
  <i>Bundle .NET WebAssembly static assets into modern JS bundlers</i>
</p>

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
