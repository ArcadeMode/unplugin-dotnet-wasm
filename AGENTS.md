# AGENTS.md

Build and test guide for AI coding agents working in this repository.
Monorepo: pnpm workspace, ESM-only, Node 24+, TypeScript strict.
Run all commands from repo root unless noted.

## Plugin - `unplugin-dotnet-wasm`

- Build: `pnpm build:plugin`
- Build unit-test Library fixture: `pnpm build:plugin:fixture`
- Unit test: `pnpm test:unit` (requires fixture build; tests live under `unplugin-dotnet-wasm/tests/`)

## Samples - `samples/`

Shared .NET libraries in `samples/libraries/` (`WasmLibrary`, `BlazorElements`, `BlazorApp`).
Hosts in `samples/apps/` (vanilla Vite/Webpack, Rsbuild+React, Farm+React, esbuild Node).

```
pnpm build:sample:vite-wasm
pnpm dev:sample:vite-wasm

pnpm build:sample:vite-blazor
pnpm dev:sample:vite-blazor

pnpm build:sample:webpack-blazor
pnpm dev:sample:webpack-blazor

pnpm build:sample:rsbuild-react
pnpm dev:sample:rsbuild-react

pnpm build:sample:farm-react
pnpm dev:sample:farm-react

pnpm build:sample:esbuild-node
pnpm start:sample:esbuild-node
```

## Fixture-builder E2E - `test/e2e` (CI)

CI shards by **os × bundler**; `run.mjs` fans out browser∥node in parallel when
`--platform` is omitted. At least one of `--bundler` / `--platform` is required.

`permuteFixture` axes: bundler × platform × serveMode × kind (`wasm`|`blazor`) ×
buildMode (`debug`|`publish`); omit an axis to expand it (`kind=blazor` never
pairs with `platform=node`). Fingerprint is **not** a CLI flag — tests assert
it internally (default `true`).

Each test materializes a fixture and runs `dotnet build` / `dotnet publish`
itself via the fixture builder.

```
pnpm build:plugin
pnpm test:e2e --bundler=vite
pnpm test:e2e --bundler=vite --platform=browser
pnpm test:e2e --platform=node
# equivalent:
pnpm --filter @unplugin-dotnet-wasm/e2e test:e2e --bundler=vite
```

- Templates: `test/fixture-builder/templates/{WasmLibrary,BlazorLibrary}` materialize
  into `.materialized/.../Library/` (csproj names preserved; `kind` →
  `DOTNET_PROJECT_NAME` `WasmLibrary`|`BlazorLibrary`).
- Implemented bundlers: `vite`, `webpack`, `esbuild`, `rollup`, `rolldown`, `rspack`, `rsbuild`, `farm`, `bun` (gated by capabilities: e.g. bun/esbuild skip watch/server).
- JUnit: `test/e2e/test-results/{browser,node}/<bundler>/*.junit.xml`
- Materialized fixtures: `test/fixture-builder/.materialized/` (gitignored)

## Repo-wide utilities

- Typecheck all: `pnpm typecheck`
- Lint all: `pnpm lint`
- Format all ts/js: `pnpm format`
- Check formatting: `pnpm format:check`
- Clean all: `pnpm clean`

## Gotchas

- **Post-edit formatting:** after editing any `.ts`/`.tsx`/`.js`/`.mjs`/`.cjs` file, run `pnpm format` before finishing the task. CI's `format` job blocks e2e if `pnpm format:check` fails. Prettier config lives at repo root (`.prettierrc`, `.prettierignore`). The single root ESLint config (`eslint.config.js`) also surfaces Prettier violations via `eslint-plugin-prettier`, so `pnpm lint` fails on unformatted JS/TS anywhere in the repo.
- **Windows PowerShell:** use `;` (not `&&`) to chain; use `Select-Object -Last N` (not `tail`).
