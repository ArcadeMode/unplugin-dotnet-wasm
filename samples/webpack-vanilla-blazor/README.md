# webpack-vanilla-blazor

Bare Webpack front-end that bundles a Blazor WebAssembly Library via `unplugin-dotnet-wasm`.

## Differences from the default Blazor sample

- Bootstrap is an npm dependency of the webpack app (`bootstrap`), imported from `app/src/styles.css`, instead of the template’s `Library/wwwroot/lib` copy.
