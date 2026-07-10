# AGENTS.md

Build and test guide for AI coding agents working in this repository.
Monorepo: pnpm workspace, ESM-only, Node 20+, TypeScript strict.
Run all commands from repo root unless noted.

## Plugin — `unplugin-dotnet-wasm`

- Build: `pnpm build:plugin`
- Unit test: `pnpm test:unit` (auto-builds `SampleLibrary` first)

## .NET Library fixture — `test/fixtures/Library`

- Build debug (fingerprint on):   `pnpm build:library:fingerprint`
- Build debug (fingerprint off):  `pnpm build:library:nofingerprint`
- Publish release (fingerprint on):   `pnpm publish:library:fingerprint`
- Publish release (fingerprint off):  `pnpm publish:library:nofingerprint`
- Clean: `pnpm clean:library`

## Fixture apps — `test/fixtures/{browser,node}/library-app-<bundler>`

- Build all: `pnpm build:fixtures --mode=<debug|release>` (`--mode` is required)
- Optional filters: `--bundler=<name>`, `--platform=<node|browser>`
- Build one: `cd test/fixtures/<platform>/library-app-<bundler>; npm run build`
- **The matrix runner does NOT rebuild fixtures.** After editing a fixture's `src/entry.ts` or bundler config, rebuild the fixture manually.

## Integration + E2E matrix

Runner: [test/integration/run-test-matrix.mjs](test/integration/run-test-matrix.mjs) (via `pnpm test:matrix`).

- **Required flags:** `--fingerprint=<true|false>` and `--build-mode=<debug|publish|none>`
- Optional filters: `--bundler=<name>`, `--platform=<node|browser>`, `--integration`, `--e2e`
- `--e2e --build-mode=none` is rejected (exit 1)

Examples:

```
pnpm test:matrix -- --fingerprint=false --build-mode=debug                              # full matrix
pnpm test:matrix -- --e2e --bundler=vite --fingerprint=false --build-mode=debug         # one bundler, E2E only
pnpm test:matrix -- --integration --fingerprint=false --build-mode=none                 # integration only, no build
```

Bundler support:
- **node:** `vite`, `rollup`, `rolldown`, `esbuild`
- **browser:** `vite`, `rollup`, `rolldown`, `webpack`, `rspack`, `rsbuild`, `esbuild`, `farm`, `bun`

Env vars set per run: `BUNDLER`, `DOTNET_FINGERPRINT` (`fingerprint` | `nofingerprint`), `DOTNET_BUILD_MODE` (`debug` | `publish` | `none`), `PLATFORM` (`node` | `browser`).

## E2E dispatch — `test/integration`

The matrix runner dispatches directly based on `config.platform`:

- `platform=node`    → `vitest run --config vitest.e2e.config.ts` (runs `*.e2e.test.ts`)
- `platform=browser` → `playwright test` (runs `runtime.spec.ts`)

Integration vitest config excludes `*.e2e.test.ts` so tests don't double-run.

## Full test suites

Orchestrator: [scripts/run-tests.mjs](scripts/run-tests.mjs).

Named suites (each cleans, builds plugin, builds library, builds fixtures, then runs the matrix):

```
pnpm test:debug-fingerprint      # dotnet build -c Debug, fingerprint on
pnpm test:debug-nofingerprint    # dotnet build -c Debug, fingerprint off
pnpm test:publish-fingerprint    # dotnet publish -c Release, fingerprint on
pnpm test:publish-nofingerprint  # dotnet publish -c Release, fingerprint off
pnpm test:no-build               # integration tests only, no library build
pnpm test                        # runs all five suites in sequence
```

## Quick single-fixture E2E cycle (PowerShell)

```powershell
cd test/fixtures/node/library-app-vite; npm run build
cd ../../../..
$env:BUNDLER='vite'; $env:DOTNET_FINGERPRINT='nofingerprint'; $env:DOTNET_BUILD_MODE='debug'
pnpm test:matrix --e2e --fingerprint=false --build-mode=debug --bundler=vite --platform=node
```

## Repo-wide utilities

- Typecheck all: `pnpm typecheck`
- Lint all: `pnpm lint`
- Clean all: `pnpm clean`

## Gotchas

- **Windows PowerShell:** use `;` (not `&&`) to chain; use `Select-Object -Last N` (not `tail`).
