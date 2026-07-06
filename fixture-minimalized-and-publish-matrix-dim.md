# Publish matrix dimension + fixture minimization

Two related but separable proposals. Part 1 stands on its own. Part 2 only makes sense if Part 1 is done via Route C.

---

## Part 1 — Add `publish` as a matrix axis

### Goal

Make `publish ∈ {build, publish}` a first-class dimension alongside `bundler × platform × shape`, so E2E exercises `isPublish: true` (Release + `bin/Release/.../publish/`) in addition to today's `isPublish: false` (Debug + scattered `bin/Debug/.../wwwroot/_framework/`).

### Current state

- Integration tests (`build.test.ts`, `publish.test.ts`) already cover both `isPublish` cases via `IsolatedBundlerBuild`.
- E2E only tests Debug/build: browser E2E sirvs `test/fixtures/<platform>/library-app-<bundler>/dist/`, produced by each fixture's own bundler config, all hard-coded to `configuration: 'Debug'` with no `isPublish`.
- `pnpm build:library:{fingerprint,nofingerprint}` already produces both Debug and Release publish outputs — no .NET-side change needed.

### Routes considered

**Route A — Parameterize fixture configs, runner rebuilds fixtures per cell.** Each fixture reads `DOTNET_FIXTURE_PUBLISH` and switches `configuration` + `isPublish` in its bundler config. Matrix runner invokes `npm run build` per E2E cell.

**Route C — Extend `IsolatedBundlerBuild` to power E2E.** Fixture bundler configs stop being used by tests entirely; isolated harness builds fresh into `.tmp-test/<id>/dist/` and E2E targets that.

### Decision: Route A (preferred)

- Keeps the per-bundler fixture configs alive as **executable documentation** of "how to wire the plugin into vite/webpack/rspack/farm/bun/…".
- Matches how a real consumer uses the plugin (via bundler config, not via a programmatic build harness).
- Runner-driven fixture rebuilds are acceptable — these are cheap builds.
- Contract change (`AGENTS.md`: "runner does NOT rebuild fixtures") is a conscious flip.

### Concrete changes

1. **`test-matrix-parameters.ts`**
   - Add `type Publish = 'build' | 'publish'` and `readPublish()` reading `DOTNET_FIXTURE_PUBLISH`.

2. **Fixture bundler configs (all 13)**
   - Read `DOTNET_FIXTURE_PUBLISH` env var.
   - When `publish` → pass `configuration: 'Release'`, `isPublish: true` to the plugin.
   - When `build` (or unset) → keep today's `configuration: 'Debug'`.
   - Add a `build:production` npm script per fixture that sets the env var, so devs can reproduce locally without exporting envs.

3. **`matrix-lib.mjs`**
   - New required flag `--publish=<build|publish|both>` (mirrors `--fingerprint`).
   - `buildConfigs` expands over `publish`; config name becomes `${bundler}-${platform}-${shape}-${publish}`.
   - `runConfig` for E2E cells: first `spawnSync('pnpm', ['--filter', <fixture>, 'build'], { env: { ..., DOTNET_FIXTURE_PUBLISH } })`, then dispatch Playwright / vitest e2e as today.

4. **`test-matrix.ts`**
   - `currentPublish` export; extend `Constraint` with `publish?: readonly Publish[]`.
   - `assertFixtureMatches` also verifies Release/publish `_framework` dir exists when `publish=publish` and `shape !== 'none'`.

5. **`AGENTS.md`**
   - Document `--publish`, new env var, and updated fixture-rebuild contract.

### Open questions

- Naming: `publish` (matches plugin option `isPublish`) vs `mode` (mirrors NODE_ENV). Prefer `publish`.
- Default for `--publish`: require explicit like `--fingerprint`, or default to `both`? Prefer explicit for consistency.
- Do we parallelize fixture rebuilds across cells? Not now — same `dist/` per fixture, serial is fine.

---

## Part 2 — Fixture minimization (only if Route C is later chosen)

**Superseded by Part 1's decision for Route A.** Parked for reference.

### Observation (still true)

Under Route C, per-bundler fixture packages carry almost no signal:
- All 9 browser `entry.ts` files are byte-identical.
- Node `entry.ts`: 3 identical + esbuild has a trivial diff.
- Only 2 of 9 browser fixtures ship an `index.html` (vite, farm).
- Bundler runtimes come from `test/integration/package.json`, not fixture `node_modules`.
- Fixture `package.json` + per-bundler config would be unused by tests.

### What consolidation would look like

Delete `test/fixtures/{browser,node}/library-app-*/` and replace with:

```
test/fixtures/app-shell/
  browser/{entry.ts, typeshim.ts, index.html}
  node/{entry.ts, typeshim.ts}
  tsconfig.json
```

Also remove: `scripts/build-fixtures.js`, root `build:fixtures*` scripts, fixture entries in `pnpm-workspace.yaml`, redundant per-fixture devDeps.

`test-matrix.ts#getFixtureDir` drops the `bundler` argument; `IsolatedBundlerBuild.baseDir` moves to `test/integration/.tmp-test/<bundler>-build/<id>/`.

### Trade-offs

- **Loses** per-bundler config as executable docs. Under Route A this is the exact reason we don't do this — the fixtures ARE the docs.
- **Wins** ~13 packages of surface area, fewer devDeps, faster install.
- Risk: audit each `isolated-*-build.ts` for any fixture-local file writes (rsbuild, bun looked suspect).

### When to revisit

Only if we abandon Route A (e.g. fixture rebuild cost turns out to be prohibitive at scale, or the per-bundler configs drift into meaningless boilerplate).
