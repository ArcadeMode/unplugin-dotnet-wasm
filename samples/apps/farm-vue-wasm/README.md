# farm-vue-wasm

A Vue 3 + Farm front-end that boots the shared
[`WasmLibrary`](../../libraries/WasmLibrary) via
[`unplugin-dotnet-wasm`](../../../unplugin-dotnet-wasm) and drives the TypeShim
`Counter` from a single-file component.

Same C# as [`vite-vanilla-wasm`](../vite-vanilla-wasm); Farm is the host, and
Vue owns the UI.

## Run

From the repo root (Node 24+, .NET 10 SDK, `pnpm install` already done):

```bash
pnpm build:sample:farm-vue
pnpm dev:sample:farm-vue
# or serve the built dist without the Farm dev server
# pnpm preview:sample:farm-vue
```

Production (`dotnet publish` + Farm production mode):

```bash
pnpm --filter @dotnet-wasm-bundler/farm-vue-wasm build:release
```

## How the host boots .NET

[`src/App.vue`](src/App.vue) boots the runtime in `onMounted` and keeps a
`Counter` instance in the setup closure:

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

- **TypeShim in Vue.** `Counter` is a real TypeScript class used from an SFC,
  not `invokeMethod`.
- **Farm asset ceremony.** `compilation.assets.include` and
  `targetEnv: 'browser-esnext'` — easy to miss, and required for this bundler.

## Layout

```
samples/
├── libraries/WasmLibrary/     # shared with vite-vanilla-wasm and esbuild-node-wasm
│   └── Counter.cs
└── apps/farm-vue-wasm/        # Vue 3 + Farm host
    ├── src/App.vue
    ├── src/main.ts
    ├── index.html
    └── farm.config.ts
```
