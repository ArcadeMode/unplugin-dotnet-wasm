# AGENTS.md

Build and test guide for AI coding agents working in this repository.
Monorepo: pnpm workspace, ESM-only, Node 20+, TypeScript strict.
Run all commands from repo root unless noted.

## Plugin — `unplugin-dotnet-static-assets`

- Build: `pnpm build:plugin`
- Unit test: `pnpm test:unit` (auto-builds `SampleLibrary` first)

## .NET Library fixture — `test/fixtures/Library`

- Build (fingerprint on):  `pnpm build:library:fingerprint`
- Build (fingerprint off): `pnpm build:library:nofingerprint`
- Clean: `pnpm clean:library`

## Fixture apps — `test/fixtures/{browser,node}/library-app-<bundler>`

- Build all: `pnpm build:fixtures`
- Build one: `cd test/fixtures/<platform>/library-app-<bundler>; npm run build`
- **The matrix runner does NOT rebuild fixtures.** After editing a fixture's `src/entry.ts` or bundler config, rebuild the fixture manually.

## Integration + E2E matrix

Runner: [test/integration/run-test-matrix.mjs](test/integration/run-test-matrix.mjs) (via `pnpm test:matrix`).

- **Required flag:** `--fingerprint=<true|false|none>`
- Optional filters: `--bundler=<name>`, `--platform=<node|browser>`, `--integration`, `--e2e`

Examples:

```
pnpm test:matrix -- --fingerprint=false                              # full matrix
pnpm test:matrix -- --e2e --bundler=vite --fingerprint=false         # one bundler, E2E only
pnpm test:matrix -- --integration --fingerprint=false                # integration only
```

Bundler support:
- **node:** `vite`, `rollup`, `rolldown`, `farm`
- **browser:** `vite`, `rollup`, `rolldown`, `webpack`, `rspack`, `rsbuild`, `esbuild`, `farm`, `bun`

Env vars set per run: `BUNDLER`, `DOTNET_FIXTURE_SHAPE` (`fingerprint` | `nofingerprint` | `none`), `PLATFORM` (`node` | `browser`).

## E2E dispatcher — `test/integration`

`pnpm test:e2e` → [test/integration/run-e2e.mjs](test/integration/run-e2e.mjs) routes by `PLATFORM`:

- `PLATFORM=node`    → `vitest run --config vitest.e2e.config.ts` (runs `*.e2e.test.ts`)
- `PLATFORM=browser` → `playwright test` (runs `runtime.spec.ts`)

Integration vitest config excludes `*.e2e.test.ts` so tests don't double-run.

## Quick single-fixture E2E cycle (PowerShell)

```powershell
cd test/fixtures/node/library-app-vite; npm run build
cd ../../../integration
$env:BUNDLER='vite'; $env:DOTNET_FIXTURE_SHAPE='nofingerprint'; $env:PLATFORM='node'
npm run test:e2e
```

## Repo-wide utilities

- Typecheck all: `pnpm typecheck`
- Lint all: `pnpm lint`
- Clean all: `pnpm clean`

## Gotchas

- **Windows PowerShell:** use `;` (not `&&`) to chain; use `Select-Object -Last N` (not `tail`).
