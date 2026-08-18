# rsbuild-react-blazor

A React + Rsbuild front-end that hosts the same Blazor WebAssembly **custom
elements** as [`vite-vanilla-blazor`](../vite-vanilla-blazor), via
[`unplugin-dotnet-wasm`](../../../unplugin-dotnet-wasm).

The .NET library is shared: [`BlazorElements`](../../libraries/BlazorElements)
registers `<blazor-counter>` and `<blazor-date-time-now>`. This host renders
those tags from JSX. Primitive parameters can be React props; complex types
(`DateTime`) must be set as JS properties after `Blazor.start()`.

## Run

From the repo root (Node 24+, .NET 10 SDK, `pnpm install` already done):

```bash
pnpm build:sample:rsbuild-react
pnpm dev:sample:rsbuild-react
# or serve the built dist without the Rsbuild dev server
# pnpm preview:sample:rsbuild-react
```

## How the host boots Blazor

[`src/blazor.ts`](src/blazor.ts) starts Blazor once — the SDK's
`blazor.webassembly.js` has no ESM exports, so the import only sets
`window.Blazor`. [`src/App.tsx`](src/App.tsx) then renders the custom elements:

```tsx
<blazor-counter ref={counterRef} initial={42}></blazor-counter>
```

- `initial={42}` is a primitive, so Blazor can read it from the attribute.
- `DateTime Initial` is a complex type: React still writes custom-element props
  as attributes, so the sample sets `el.initial = new Date()` on the ref after
  `Blazor.start()` instead.
- `CountChanged` still surfaces as a DOM `CustomEvent` (`countchanged`); the
  sample listens with `addEventListener` on a ref.
- Manual `Blazor.start()` is required because the bundle is an ESM module.

## What's special

- **Islands in React.** Same Razor components as the vanilla Vite sample, inside
  a React tree instead of static HTML.
- **Rsbuild, not Vite.** Proves custom elements are not a Vite-only trick; the
  webpack-family successor has a real `rsbuild dev` loop.

## Layout

```
samples/
├── libraries/BlazorElements/      # shared with vite-vanilla-blazor
│   ├── Counter.razor              # → <blazor-counter>
│   ├── DateTimeNow.razor          # → <blazor-date-time-now>
│   └── Program.cs
└── apps/rsbuild-react-blazor/     # React + Rsbuild host
    ├── src/App.tsx
    ├── src/main.tsx
    ├── index.html
    └── rsbuild.config.ts
```
