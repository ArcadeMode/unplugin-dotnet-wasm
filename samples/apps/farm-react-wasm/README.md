# farm-react-wasm

A React + Farm front-end that boots the shared
[`WasmLibrary`](../../libraries/WasmLibrary) via
[`unplugin-dotnet-wasm`](../../../unplugin-dotnet-wasm) and drives the TypeShim
`Counter` from a React component.

Same C# as [`vite-vanilla-wasm`](../vite-vanilla-wasm); Farm is the host, and
React owns the UI.

## Run

From the repo root (Node 24+, .NET 10 SDK, `pnpm install` already done):

```bash
pnpm build:sample:farm-react
pnpm dev:sample:farm-react
# or serve the built dist without the Farm dev server
# pnpm preview:sample:farm-react
```

Production (`dotnet publish` + Farm production mode):

```bash
pnpm --filter @unplugin-dotnet-wasm/farm-react-wasm build:release
```

## How the host boots .NET

[`src/App.tsx`](src/App.tsx) boots the runtime in `useEffect` and keeps a
`Counter` instance in a ref:

```ts
import { dotnet } from '_framework/dotnet';
import { Counter } from 'typeshim';

const runtime = await dotnet.create();
runtime.runMain();
const counter = new Counter(0);
```

Farm needs extra asset config the other bundlers do not: declare `.wasm` /
`.dat` / `.pdb` so they are emitted as files, and set `targetEnv` to
`browser-esnext` so Farm does not inject `core-js` into the .NET boot graph.

## What's special

- **TypeShim in React.** `Counter` is a real TypeScript class used from JSX,
  not `invokeMethod`.
- **Farm asset ceremony.** `compilation.assets.include` and
  `targetEnv: 'browser-esnext'` — easy to miss, and required for this bundler.
- **Farm + pnpm aliases.** Farm does not follow React's package exports under
  pnpm; `farm.config.ts` aliases `react`, `react-dom`, `scheduler`, and
  `react-refresh` to real files.

## Layout

```
samples/
├── libraries/WasmLibrary/     # shared with vite-vanilla-wasm and esbuild-node-wasm
│   └── Counter.cs
└── apps/farm-react-wasm/      # React + Farm host
    ├── src/App.tsx
    ├── src/main.tsx
    ├── index.html
    └── farm.config.ts
```
