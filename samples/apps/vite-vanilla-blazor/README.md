# vite-vanilla-blazor

A bare Vite front-end that hosts Blazor WebAssembly **components** as custom
elements via [`unplugin-dotnet-wasm`](../../../unplugin-dotnet-wasm).

Where a full Blazor WASM template (or a host like
[`webpack-vanilla-blazor`](../webpack-vanilla-blazor)) lets Blazor own the router
and pages, this sample does the opposite: Vite owns the page, and Blazor only
upgrades a few tags (`<blazor-counter>`, `<blazor-date-time-now>`) into
interactive components.

## Run

From the repo root (Node 24+, .NET 10 SDK, `pnpm install` already done):

```bash
pnpm build:sample:vite-blazor
pnpm dev:sample:vite-blazor
# or serve the built dist without the Vite dev server
# pnpm preview:sample:vite-blazor
```

## How the host boots Blazor

[`src/entry.ts`](src/entry.ts) starts Blazor explicitly — the SDK's
`blazor.webassembly.js` has no ESM exports, so the import only sets
`window.Blazor`:

```ts
import '_framework/blazor.webassembly.js';
const Blazor = window.Blazor;

await Blazor.start();
// then set JS properties / listen for CustomEvents on the elements
```

- Custom elements are registered in
  [`BlazorElements/Program.cs`](../../libraries/BlazorElements/Program.cs) with
  `RegisterCustomElement<T>("…")`.
- Parameters are JS properties (`el.initial = 42`); Blazor
  `EventCallback`s surface as DOM `CustomEvent`s (`countchanged`).
- The tags live in plain [`index.html`](index.html) — any host that can
  render custom elements works the same way.

## What's special

- **Components in a non-Blazor page.** Drop Razor islands into Vanilla / React /
  Vue without a Blazor router or layout.
- **Manual `Blazor.start()`.** Needed because the boot script isn't an ESM
  module with a default export.
- **No ASP.NET static-file host.** Vite is the only HTTP server; the plugin
  resolves `_framework/blazor.webassembly.js` from the .NET output.

## Layout

```
samples/
├── libraries/BlazorElements/     # shared Blazor WASM library (net10.0)
│   ├── Counter.razor             # → <blazor-counter>
│   ├── DateTimeNow.razor         # → <blazor-date-time-now>
│   └── Program.cs                # RegisterCustomElement
└── apps/vite-vanilla-blazor/     # Vanilla Vite + TypeScript host
    ├── src/entry.ts              # Blazor.start + wire parameters/events
    ├── index.html                # hosts the custom elements
    └── vite.config.ts
```
