# vite-vanilla-wasm

A bare Vite + TypeScript page that boots a .NET WebAssembly library via
[`unplugin-dotnet-wasm`](../../unplugin-dotnet-wasm) and calls into C# from JS.

Where [`vite-vanilla-blazor`](../vite-vanilla-blazor) embeds Blazor components as
custom elements, this sample skips Blazor entirely: the host owns the DOM, and
.NET is just a typed API surface (via [TypeShim](https://github.com/ArcadeMode/TypeShim)).

## Run

From the repo root (Node 24+, .NET 10 SDK, `pnpm install` already done):

```bash
pnpm build:sample:vite-wasm
pnpm dev:sample:vite-wasm
# or serve the built dist without the Vite dev server
# pnpm preview:sample:vite-wasm
```

## How the host boots .NET

[`app/src/entry.ts`](app/src/entry.ts) is intentionally tiny:

```ts
import { dotnet } from '_framework/dotnet';
import { Counter } from 'typeshim';

const runtime = await dotnet.create();
runtime.runMain();

const counter = new Counter(0);
```

- `_framework/dotnet` is resolved by the plugin against the `dotnet build` output
  (`WasmBundlerFriendlyBootConfig` is on in the library csproj).
- `typeshim` is a generated package shim: `[TSExport]` on
  [`SampleLibrary/Counter.cs`](SampleLibrary/Counter.cs) becomes a real TypeScript
  class you can `new` and call from the page.
- The HTML is plain buttons/spans — no Razor, no custom elements.

## What's special

- **Library, not app UI.** .NET exposes `Counter`; Vite owns the markup and click
  handlers.
- **Typed interop.** No `invokeMethod` string APIs — TypeShim gives constructor /
  method / property shapes in TypeScript.
- **No ASP.NET host.** Vite (dev or `dist/`) is the only HTTP server.

## Layout

```
vite-vanilla-wasm/
├── SampleLibrary/     # .NET WebAssembly project (net10.0)
│   └── Counter.cs     # [TSExport] class consumed from JS
└── app/               # Vanilla Vite + TypeScript host
    ├── src/entry.ts   # boots runtime + drives Counter
    ├── index.html
    └── vite.config.ts
```
