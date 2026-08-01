# AGENTS.md

Build and test guide for AI coding agents working in this repository.
Monorepo: pnpm workspace, ESM-only, Node 20+, TypeScript strict.
Run all commands from repo root unless noted.

## Plugin - `unplugin-dotnet-wasm`

- Build: `pnpm build:plugin`
- Unit test: `pnpm test:unit` (auto-builds `SampleLibrary` first)

## Fixture-builder E2E - `test/e2e` (CI)

CI shards by **os × bundler** and runs browser then node sequentially. Fingerprint /
build-mode / serve-mode live in the tests (default fingerprint true).

```
pnpm build:plugin
pnpm test:e2e --bundler=vite --platform=browser
pnpm test:e2e --bundler=vite --platform=node
# equivalent:
pnpm --filter @dotnet-wasm-bundler/e2e test:e2e --bundler=vite --platform=browser
```

- Implemented bundlers today: `vite`, `webpack`, `esbuild` (others skipped via capabilities).
- Skip the isolated vite node SSR spec: `SKIP_VITE_NODE_SERVER=1`
- JUnit: `test/e2e/test-results/{browser,node}/<bundler>/*.junit.xml`
- Materialized fixtures: `test/fixture-builder/.materialized/` (gitignored)

## .NET Library fixture - `test/fixtures/Library` (legacy matrix)

Still used by the retired env-var matrix / checked-in fixtures (cleanup later).

- Build debug (fingerprint on): `pnpm build:library:fingerprint`
- Build debug (fingerprint off): `pnpm build:library:nofingerprint`
- Publish release (fingerprint on): `pnpm publish:library:fingerprint`
- Publish release (fingerprint off): `pnpm publish:library:nofingerprint`
- Clean: `pnpm clean:library`

## Fixture apps - `test/fixtures/{browser,node}/library-app-<bundler>` (legacy)

- Build all: `pnpm build:fixtures --mode=<debug|release>` (`--mode` is required)
- Optional filters: `--bundler=<name>`, `--platform=<node|browser>`
- Build one: `cd test/fixtures/<platform>/library-app-<bundler>; npm run build`
- **The matrix runner does NOT rebuild fixtures.** After editing a fixture's `src/entry.ts` or bundler config, rebuild the fixture manually.

## Integration + E2E matrix (legacy — not in CI)

Runner: [test/integration/run-test-matrix.mjs](test/integration/run-test-matrix.mjs) (via `pnpm test:matrix`).
Still on disk for local use; CI no longer invokes it.

- **Required flags:** `--fingerprint=<true|false>` and `--build-mode=<debug|publish|none>`
- Optional filters: `--bundler=<name>`, `--platform=<node|browser>`, `--integration`, `--e2e`
- `--e2e --build-mode=none` is rejected (exit 1)

Examples:

```
pnpm test:matrix -- --fingerprint=false --build-mode=debug
pnpm test:matrix -- --e2e --bundler=vite --fingerprint=false --build-mode=debug
pnpm test:matrix -- --integration --fingerprint=false --build-mode=none
```

## Full test suites (legacy orchestrator)

Orchestrator: [scripts/run-tests.mjs](scripts/run-tests.mjs).

```
pnpm test:debug-fingerprint
pnpm test:debug-nofingerprint
pnpm test:publish-fingerprint
pnpm test:publish-nofingerprint
pnpm test:no-build
pnpm test
```

## Repo-wide utilities

- Typecheck all: `pnpm typecheck`
- Lint all: `pnpm lint`
- Format all ts/js: `pnpm format`
- Check formatting: `pnpm format:check`
- Clean all: `pnpm clean`

## Gotchas

- **Post-edit formatting:** after editing any `.ts`/`.tsx`/`.js`/`.mjs`/`.cjs` file, run `pnpm format` before finishing the task. CI's `format` job blocks e2e if `pnpm format:check` fails. Prettier config lives at repo root (`.prettierrc`, `.prettierignore`). The single root ESLint config (`eslint.config.js`) also surfaces Prettier violations via `eslint-plugin-prettier`, so `pnpm lint` fails on unformatted JS/TS anywhere in the repo.
- **Windows PowerShell:** use `;` (not `&&`) to chain; use `Select-Object -Last N` (not `tail`).
