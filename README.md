<h1 align=center tabindex=-1>unplugin-dotnet-wasm</h1>
<p align=center tabindex=-1>
  <i>Drop .NET WASM apps into JS projects like any other dependency</i><br/>
  <i>Works with every major bundler, straight from `dotnet build`</i>
</p>

## Why unplugin-dotnet-wasm

unplugin-dotnet-wasm enables importing .NET [WebAssembly Browser Apps](https://learn.microsoft.com/en-us/aspnet/core/client-side/dotnet-interop/wasm-browser-app) through your favorite JavaScript bundler's own module graph: no manual copy step, no public-dir hacks, and it works against the fast `dotnet build`, saving the slow `dotnet publish` for when you are actually publishing.

Built on [unplugin](https://github.com/unjs/unplugin), so one integration covers Vite, Webpack, Rollup, Rolldown, Rspack, Rsbuild, esbuild, Farm, and Bun.

> [!TIP]
> unplugin-dotnet-wasm pairs great with [TypeShim](https://github.com/ArcadeMode/TypeShim) for a seamless .NET > JS experience.

## Documentation

- [Package README](unplugin-dotnet-wasm/README.md): install, per-bundler setup, options, and the bundler support matrix.
- [Architecture](docs/architecture.md): the problem, the manifest-driven design, and the rationale behind each decision.

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

And build+run the vite sample
```bash
pnpm build:sample
pnpm build:sample:vite
pnpm preview:sample
```

Other bundler samples can be found in the `./test/fixtures/[browser|node]` directories.

Testing the `bun` integration additionally requires Bun >= 1.3.

> To quickly set up all dependencies for the repo run: `./dev-env-init.ps1`