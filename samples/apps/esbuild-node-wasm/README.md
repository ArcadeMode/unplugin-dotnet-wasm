# esbuild-node-wasm

An esbuild-bundled Node CLI that boots the shared
[`WasmLibrary`](../../libraries/WasmLibrary) via
[`unplugin-dotnet-wasm`](../../../unplugin-dotnet-wasm) and prints TypeShim
`Counter` increments. No HTML, no UI kit, no Blazor (Blazor WASM is
browser-only).

Same C# as [`vite-vanilla-wasm`](../vite-vanilla-wasm) and
[`farm-react-wasm`](../farm-react-wasm).

## Run

From the repo root (Node 24+, .NET 10 SDK, `pnpm install` already done):

```bash
pnpm build:sample:esbuild-node
pnpm start:sample:esbuild-node
```

## How the host boots .NET

[`src/entry.ts`](src/entry.ts) is a CLI:

```ts
import { dotnet } from '_framework/dotnet';
import { Counter } from 'typeshim';

const runtime = await dotnet.create();
runtime.runMain();

const counter = new Counter(0);
counter.Increment();
console.log(`INCREMENT:${counter.Value}`);
```

esbuild is configured with `platform: 'node'` and `format: 'esm'` so the
dotnet runtime's dynamic imports resolve.

## What's special

- **Node target.** The missing runtime from the other samples.
- **Explicit `dotnetOutputDir`.** This host points at
  `libraries/WasmLibrary/bin/Debug/net10.0` instead of project-discovery
  (`projectRoot` + `configuration` + `isPublish`). Use that shape for a custom
  publish directory or [`UseArtifactsOutput`](https://learn.microsoft.com/en-us/dotnet/core/sdk/artifacts-output).
- **No dev server.** esbuild has no middleware hook, so the loop is build then
  `node dist/entry.js`.

## Layout

```
samples/
├── libraries/WasmLibrary/      # shared with the other WASM hosts
│   └── Counter.cs
└── apps/esbuild-node-wasm/     # esbuild Node CLI
    ├── src/entry.ts
    └── esbuild.mjs
```
