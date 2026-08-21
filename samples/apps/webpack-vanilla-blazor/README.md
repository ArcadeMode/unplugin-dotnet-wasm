# webpack-vanilla-blazor

A bare Webpack front-end that hosts a full Blazor WebAssembly app via
[`unplugin-dotnet-wasm`](../../../unplugin-dotnet-wasm).

Where [`vite-vanilla-blazor`](../vite-vanilla-blazor) embeds individual Blazor
components as custom elements inside a Vite page, this sample takes the opposite
route: [`BlazorApp`](../../libraries/BlazorApp) owns the UI (router, layout,
pages), and Webpack is just the host that builds, serves, and ships it.

## Run

From the repo root (Node 24+, .NET 10 SDK, `pnpm install` already done):

```bash
pnpm build:sample:webpack-blazor
pnpm dev:sample:webpack-blazor
#or use preview to serve the dist folder without the dev server
#pnpm preview:sample:webpack-blazor
```

## How the host boots Blazor

[`src/index.ts`](src/index.ts) is intentionally tiny:

```ts
import './styles.css';
import '_framework/blazor.webassembly';
import 'favicon.png';
import './sample-data/weather.json';
```

- Importing `_framework/blazor.webassembly` (without `scriptLoading: 'module'` on
  `HtmlWebpackPlugin`) lets Blazor auto-start and mount `<App>` on `#app`, the
  same way a stock Blazor `index.html` would.
- CSS from the library is imported in `styles.css` as bare paths
  (`css/app.css`, `BlazorApp.styles.css`); the plugin resolves them against the
  .NET output directory for both build and publish layouts.
- `favicon.png` and `sample-data/weather.json` are emitted at stable URLs so
  Blazor's `<link rel="icon">` and `HttpClient` GET keep working after the
  bundler run.

## Differences from the default Blazor template

- **Blazor as JS app** The blazor app is distributed as a JavaScript bundle.
- **Bootstrap via npm.** Bootstrap is a dependency of the Webpack app
  (`bootstrap@5.3.3`), imported from `src/styles.css`, instead of the
  template's `wwwroot/lib` copy.
- **No ASP.NET static-file host.** Webpack (dev server or `dist/`) is the only
  HTTP server; there is no `dotnet run` web host in front of the app.
- **Bundler owns asset URLs.** Things Blazor would normally serve from
  `wwwroot` (framework JS, razor component CSS, favicon) are resolved and
  emitted by Webpack through `unplugin-dotnet-wasm`.

## Layout

```
samples/
├── libraries/BlazorApp/              # Blazor WebAssembly project (net10.0)
│   ├── Pages/                        # Home, Counter, Weather, …
│   ├── Layout/                       # MainLayout + NavMenu
│   └── wwwroot/                      # .NET static web assets (css, favicon, …)
└── apps/webpack-vanilla-blazor/      # Vanilla Webpack + TypeScript host
    ├── src/
    │   ├── index.ts                  # boots Blazor + pulls in assets
    │   ├── styles.css                # Bootstrap + BlazorApp CSS
    │   └── sample-data/              # JSON fetched by the Weather page
    ├── index.html
    └── webpack.config.js
```

`BlazorApp` is a normal Blazor WASM app with
[`WasmBundlerFriendlyBootConfig`](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0#javascript-bundler-support)
enabled. The Webpack app never copies `_framework` by hand — the plugin resolves
`_framework/blazor.webassembly`, static web assets, and CSS imports straight from
the `dotnet build` / `dotnet publish` output.
