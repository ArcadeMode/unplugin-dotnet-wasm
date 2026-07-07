# Build-mode matrix dimension

Plan for adding `build-mode ∈ {debug, publish, none}` as a matrix parameter, following the same model already used for `fingerprint`: **single value per matrix invocation, caller prepares fixtures for that value, runner never rebuilds.**

Supersedes the earlier "Part 1 / Part 2 / Route A vs C" analysis. Route A is chosen. Fixture minimization (Part 2) is not pursued — per-bundler fixture configs stay as executable documentation.

---

## Goal

Exercise `isPublish: true` (Release + `bin/Release/.../publish/`) in E2E in addition to today's `isPublish: false` (Debug + scattered `bin/Debug/.../wwwroot/_framework/`), without introducing a runtime fixture-rebuild step in the matrix runner.

## Decisions locked

1. **Single `dist/` per fixture.** No `dist-debug` / `dist-release` split. Whatever the last `build:*` script produced is what the matrix consumes.
2. **`build-mode` is fixed per matrix invocation**, exactly like `fingerprint` today. `--build-mode=<debug|publish|none>` is a required single-value flag. There is no `--build-mode=all`.
3. **Caller responsibility.** Before running the matrix, the caller runs `npm run build:debug` or `npm run build:release` on the fixtures they intend to test. The runner does not rebuild fixtures per cell. The existing AGENTS.md contract stands.
4. **Bundler-idiomatic mode signalling.** Each fixture's `build:debug` / `build:release` npm scripts use the bundler's native mode mechanism (vite `--mode`, webpack `--mode`, rollup `--environment`, esbuild/bun script branch, etc.). No `DOTNET_BUILD_MODE` env var reaches into fixture configs — that env var is test-suite plumbing only.
5. **Shape `none` collapses into `build-mode`.** The current `FixtureShape = 'fingerprint' | 'nofingerprint' | 'none'` becomes:
   - `Fingerprint = 'fingerprint' | 'nofingerprint'`
   - `BuildMode = 'debug' | 'publish' | 'none'`
   - `build-mode=none` means the .NET project is not built. The plugin is still loaded (a consumer pulls it from npm regardless) and is expected to surface file-not-found errors — same failure mode as a real user misconfiguration. Achieved by running `pnpm clean:library` before invoking a fixture's `build:debug` or `build:release` script — no dedicated `build:none` script per fixture. `fingerprint` remains a valid axis under `build-mode=none`; both values are exercised.
6. **Integration tests filter by build-mode**, E2E is rejected by the matrix runner when `build-mode=none`. `build.test.ts` / `publish.test.ts` add conditions to skip when the current `--build-mode` isn't the one they exercise. E2E runs for `debug` and `publish` to validate runtime correctness; under `none` the fixture build itself is expected to fail (plugin surfaces file-not-found), so runtime tests are meaningless. `--e2e --build-mode=none` is rejected at arg-parse time with `exit 1` and an explanatory message.
7. **Identical / near-identical cells are acceptable.** No pruning, no memoization, no fingerprint-pinning under `build-mode=none`. The matrix stays simple. We are aware that `fingerprint=fingerprint` and `fingerprint=nofingerprint` produce indistinguishable behavior under `build-mode=none` (no artifacts either way) — this is accepted for simplicity, not fixed.
8. **Root library scripts split by verb.** `build:library:*` currently does both `dotnet build -c Debug` and `dotnet publish -c Release`. Split into `build:library:*` (Debug build only) and `publish:library:*` (Release publish only) so callers only pay for the artifacts their matrix run consumes.
9. **`build:fixtures` gains a `--mode` parameter.** `scripts/build-fixtures.js` accepts `--mode=<debug|release>` (required) plus optional `--bundler` / `--platform` filters and dispatches `pnpm --filter <…> build:<mode>`. `build:fixtures:node` and `build:fixtures:browser` root scripts are dropped in favor of `--platform=<node|browser>`.
10. **The 4-combo `(configuration × isPublish)` space collapses to 2.** `debug = (Debug, isPublish:false)`, `publish = (Release, isPublish:true)`. We intentionally do not matrix `Release + isPublish:false` or `Debug + isPublish:true` — the former is a rare user config, the latter is nonsensical. Existing `m2-dotnet-output-dir` block in `publish.test.ts` covers the explicit-output-dir variant of the publish combo and stays.
11. **Env var rename.** `DOTNET_FIXTURE_SHAPE` is deleted. Two new env vars: `DOTNET_FINGERPRINT ∈ {fingerprint, nofingerprint}` and `DOTNET_BUILD_MODE ∈ {debug, publish, none}`. `readShape()` is deleted and replaced with `readFingerprint()` + `readBuildMode()`. No transitional alias — clean cutover in Phase 3.

## Axes after collapse

| Axis | Values | Iteration |
| --- | --- | --- |
| `bundler` | 13 values (per platform) | iterated |
| `platform` | `node \| browser` | iterated |
| `fingerprint` | `fingerprint \| nofingerprint` | fixed per invocation (unchanged) |
| `build-mode` | `debug \| publish \| none` | fixed per invocation (new) |

Config name: `${bundler}-${platform}-${fingerprint}-${build-mode}`.

## Per-bundler idiom map (verify in Phase 2)

| Bundler | `build:release` idiom |
| --- | --- |
| vite | `vite build --mode production` → `defineConfig(({ mode }) => …)` |
| webpack | `webpack --mode production` → `(env, argv) => argv.mode` |
| rspack | `rspack build --mode production` → same callback |
| rsbuild | `rsbuild build --mode production` (verify) |
| rollup | `rollup -c --environment BUILD:production` → `process.env.BUILD` |
| rolldown | Same pattern as rollup |
| farm | `farm build --mode production` (verify) |
| esbuild | Two config scripts (`esbuild.debug.mjs` / `esbuild.release.mjs`) invoked by the two npm scripts |
| bun | Two config scripts (`bun.debug.ts` / `bun.release.ts`) invoked by the two npm scripts |

Where the idiom is `NODE_ENV`, that's fine — universally understood, not test-suite plumbing. NODE_ENV side effects (dep resolution, prod-only warnings) are part of what we want to exercise, since real users hit them too.

## Phased delivery

Ordering: **fixture scripts land before the caller that invokes them.** Phase 1 (vite pilot) and Phase 2 (remaining bundlers) introduce `build:debug` / `build:release` on each fixture. Phase 2a then splits the root library scripts and updates `scripts/build-fixtures.js` to require `--mode`. If Phase 2a lands while some bundlers still lack `build:debug` / `build:release` scripts, `build-fixtures.js --mode=<…>` will simply fail on those bundlers — that's fine; the failure is loud and locally recoverable by running the migrated bundlers with `--bundler=<name>`. Phase 3 (matrix plumbing) introduces the new env vars in the same commit that renames `readShape` / `Constraint.shapes`.

### Phase 2a — Split root library scripts + extend `build:fixtures`

- Root `package.json`: split `build:library:fingerprint` and `build:library:nofingerprint` into separate `build:` (Debug) and `publish:` (Release) commands. Update any callers (README, AGENTS.md recipes, CI).
- `scripts/build-fixtures.js`: add required `--mode=<debug|release>` flag, keep optional `--bundler` / `--platform` filters. Dispatch `pnpm --filter <pattern> build:<mode>`. The filter pattern is unchanged — only the invoked script (`build` → `build:<mode>`) differs at the invocation site.
- Drop `build:fixtures:node` and `build:fixtures:browser` from root `package.json` (superseded by `--platform`).

Root `package.json` (fixtures section):

```json
{
  "scripts": {
    "build:library:fingerprint":     "dotnet build   test/fixtures/Library/Library.csproj -c Debug   -p:WasmFingerprintAssets=true",
    "publish:library:fingerprint":   "dotnet publish test/fixtures/Library/Library.csproj -c Release -p:WasmFingerprintAssets=true",
    "build:library:nofingerprint":   "dotnet build   test/fixtures/Library/Library.csproj -c Debug   -p:WasmFingerprintAssets=false",
    "publish:library:nofingerprint": "dotnet publish test/fixtures/Library/Library.csproj -c Release -p:WasmFingerprintAssets=false",

    "build:fixtures": "node scripts/build-fixtures.js"
  }
}
```

`scripts/build-fixtures.js`:

```js
#!/usr/bin/env node
const { execSync } = require('node:child_process');
const { parseArgs } = require('node:util');

const { values } = parseArgs({
  options: {
    mode:     { type: 'string' },                // required: 'debug' | 'release'
    bundler:  { type: 'string', default: '*' },  // e.g. 'vite'
    platform: { type: 'string', default: '*' },  // 'node' | 'browser'
  },
});

if (!['debug', 'release'].includes(values.mode)) {
  console.error("ERROR: --mode is required (debug or release)");
  process.exit(1);
}

const filter = `@dotnet-wasm-bundler/library-app-${values.platform}-${values.bundler}-fixture`;
execSync(`pnpm --filter "${filter}" build:${values.mode}`, { stdio: 'inherit' });
```

### Phase 1 — Pilot on vite

`test/fixtures/browser/library-app-vite` + `test/fixtures/node/library-app-vite`:

- Add `build:debug` and `build:release` npm scripts using vite's `--mode`.
- Rewrite `vite.config.ts` as a function form: `defineConfig(({ mode }) => ({ … }))`, deriving `configuration` + `isPublish` for the plugin from `mode`.
- Verify manually: both scripts produce a working `dist/` for their mode.
- No matrix changes yet.

Fixture `package.json`:

```json
{
  "scripts": {
    "build:debug":   "vite build --mode development",
    "build:release": "vite build --mode production",
    "preview":       "vite preview --open",
    "typecheck":     "tsc --noEmit",
    "clean":         "rimraf dist"
  }
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import DotnetAssets from 'unplugin-dotnet-wasm/vite';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const isRelease = mode === 'production';
  return {
    plugins: [
      DotnetAssets({
        projectRoot: resolve(__dirname, '../../Library'),
        projectName: 'Library',
        configuration: isRelease ? 'Release' : 'Debug',
        isPublish: isRelease,
        targetFramework: 'net10.0',
        logLevel: 'info',
      }),
    ],
    build: {
      outDir: 'dist',
      rollupOptions: { input: resolve(__dirname, 'index.html') },
    },
  };
});
```

### Phase 2 — Roll out to remaining fixtures

One PR per bundler family, using each bundler's native idiom from the table above:

#### rollup + rolldown

```json
{
  "scripts": {
    "build:debug":   "rollup -c --environment BUILD:development",
    "build:release": "rollup -c --environment BUILD:production"
  }
}
```

```js
// rollup.config.js
import DotnetAssets from 'unplugin-dotnet-wasm/rollup';
import { resolve } from 'node:path';

const isRelease = process.env.BUILD === 'production';

export default {
  input: 'src/entry.ts',
  output: { dir: 'dist', format: 'es' },
  plugins: [
    DotnetAssets({
      projectRoot: resolve(process.cwd(), '../../Library'),
      projectName: 'Library',
      configuration: isRelease ? 'Release' : 'Debug',
      isPublish: isRelease,
      targetFramework: 'net10.0',
    }),
  ],
};
```

#### webpack + rspack + rsbuild

```json
{
  "scripts": {
    "build:debug":   "webpack --mode development",
    "build:release": "webpack --mode production"
  }
}
```

```js
// webpack.config.cjs
const { DotnetAssetsWebpack } = require('unplugin-dotnet-wasm/webpack');
const { resolve } = require('node:path');

module.exports = (_env, argv) => {
  const isRelease = argv.mode === 'production';
  return {
    entry: './src/entry.ts',
    output: { path: resolve(__dirname, 'dist') },
    plugins: [
      DotnetAssetsWebpack({
        projectRoot: resolve(__dirname, '../../Library'),
        projectName: 'Library',
        configuration: isRelease ? 'Release' : 'Debug',
        isPublish: isRelease,
        targetFramework: 'net10.0',
      }),
    ],
  };
};
```

rspack: same pattern with `rspack build` and `DotnetAssetsRspack`. rsbuild: `rsbuild build --mode <…>`, branch on `env.mode` inside `tools.rspack`. Webpack/rspack/rsbuild all require `--mode` values `development | production | none`; use those verbatim.

#### esbuild + bun

```json
{
  "scripts": {
    "build:debug":   "node esbuild.debug.mjs",
    "build:release": "node esbuild.release.mjs"
  }
}
```

```js
// esbuild.debug.mjs
import { build } from 'esbuild';
import DotnetAssets from 'unplugin-dotnet-wasm/esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: ['src/entry.ts'],
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  plugins: [DotnetAssets({
    projectRoot: resolve(here, '../../Library'),
    projectName: 'Library',
    configuration: 'Debug',
    isPublish: false,
    targetFramework: 'net10.0',
  })],
});
```

`esbuild.release.mjs`: same file with `Debug` → `Release` and `isPublish: false` → `true`. Zero-branch scripts; no shared logic to accidentally misconfigure. Same pattern for bun (`bun build …` invoked from two scripts).

#### farm

```json
{
  "scripts": {
    "build:debug":   "farm build --mode development",
    "build:release": "farm build --mode production"
  }
}
```

```ts
// farm.config.ts
import { defineConfig } from '@farmfe/core';
import DotnetAssets from 'unplugin-dotnet-wasm/farm';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const isRelease = mode === 'production';
  return {
    compilation: { input: { entry: 'src/entry.ts' }, output: { path: 'dist' } },
    plugins: [
      DotnetAssets({
        projectRoot: resolve(__dirname, '../../Library'),
        projectName: 'Library',
        configuration: isRelease ? 'Release' : 'Debug',
        isPublish: isRelease,
        targetFramework: 'net10.0',
      }),
    ],
  };
});
```

(Farm's config-callback signature to be verified during rollout.)

### Phase 3 — Matrix parameter plumbing

#### `test-matrix-parameters.ts`

- Delete `FixtureShape`, `VALID_SHAPES`, `readShape()`.
- Add `Fingerprint = 'fingerprint' | 'nofingerprint'` and `BuildMode = 'debug' | 'publish' | 'none'`.
- Add `readFingerprint()` reading `DOTNET_FINGERPRINT` and `readBuildMode()` reading `DOTNET_BUILD_MODE`. Both throw on missing/invalid values, same pattern as `readPlatform` / `readBundler` today.

#### `test-matrix.ts`

- Replace `currentShape` with `currentFingerprint: Fingerprint` and `currentBuildMode: BuildMode`.
- Replace `Constraint.shapes` with `Constraint.fingerprints?: readonly Fingerprint[]` and `Constraint.buildModes?: readonly BuildMode[]`. Update `matches()` and `skipReason()` accordingly.
- Rewrite `TARGET_LIBRARY_OUTPUT_DIR` as a function of `(fingerprint, buildMode)`:
  - `buildMode='debug'`  → `bin/Debug/net10.0/wwwroot/_framework/`
  - `buildMode='publish'` → `bin/Release/net10.0/publish/wwwroot/_framework/`
  - `buildMode='none'`   → validator asserts the Debug dir is either absent or empty (matches existing `shape='none'` semantics).
- Rewrite `assertFixtureMatches` to switch on `buildMode` first, then `fingerprint`. The fingerprint checks remain the same, just relocated to the correct directory.
- Update the `describe`/`it` prefix from `[platform][bundler][shape]` to `[platform][bundler][fingerprint][buildMode]`.

#### `matrix-lib.mjs`

- Add required `--build-mode=<debug|publish|none>` flag; validate values (exit 1 with explanatory error otherwise).
- **Reject `--e2e --build-mode=none` at arg-parse time**: exit 1 with `"ERROR: --e2e is not runnable with --build-mode=none (fixture build fails by design; runtime tests are meaningless). Use --integration."`. Do this *before* `buildConfigs`, not by silently emitting an empty matrix.
- Rename `FINGERPRINT_SHAPES` map and its `fixtureShape` output to `fingerprint` (values `'fingerprint' | 'nofingerprint'`). Add parallel handling for `buildMode`.
- `buildConfigs` entries: `{ type, bundler, platform, fingerprint, buildMode }`.
- `runConfig` env: set `BUNDLER`, `PLATFORM`, `DOTNET_FINGERPRINT`, `DOTNET_BUILD_MODE`. Remove `DOTNET_FIXTURE_SHAPE`.
- Config-name string: `${bundler}-${platform}-${fingerprint}-${buildMode}`.

#### `describeWhen` call-site migration

All files below use `describeWhen({ shapes: [...] })` today and must be rewritten to the new axes. This is a mechanical rename, but each block's semantic intent needs to be re-derived:

- [test/integration/tests/build.test.ts](test/integration/tests/build.test.ts) — sole block `describeWhen({ shapes: ['fingerprint', 'nofingerprint'] })` covering Debug scattered output → `describeWhen({ buildModes: ['debug'] })`. Fingerprint is orthogonal here (both variants pass), so no `fingerprints` constraint.
- [test/integration/tests/publish.test.ts](test/integration/tests/publish.test.ts) — three blocks:
  - `'Publish build (isPublish: true)'` → `describeWhen({ buildModes: ['publish'] })`
  - `'Publish build (explicit dotnetOutputDir)'` → `describeWhen({ buildModes: ['publish'] })`
  - `'DiscoveryError when publish output is absent'` → `describeWhen({ buildModes: ['none'] })`
- [test/integration/tests/runtime-node.e2e.test.ts](test/integration/tests/runtime-node.e2e.test.ts) — audit each `describeWhen`; blocks that assert runtime behavior work under both debug and publish, so gate with `describeWhen({ buildModes: ['debug', 'publish'] })` unless the block is mode-specific.
- [test/integration/tests/runtime.spec.ts](test/integration/tests/runtime.spec.ts) — same audit as above.

Grep target during Phase 3: `describeWhen\(\{\s*shapes:` must return zero hits after the migration.

#### Downstream config files

- [test/integration/playwright.config.ts](test/integration/playwright.config.ts) and [test/integration/vitest.e2e.config.ts](test/integration/vitest.e2e.config.ts): audit for `DOTNET_FIXTURE_SHAPE` references; rename to `DOTNET_FINGERPRINT` / `DOTNET_BUILD_MODE` as appropriate (typically for report-path templating).

### Phase 4 — Docs

- `AGENTS.md`: document `--build-mode` flag, `DOTNET_FINGERPRINT` + `DOTNET_BUILD_MODE` env vars, and the new `build:library:*` / `publish:library:*` scripts. Update every existing recipe to include `--build-mode=<…>` (it's now a required flag, so recipes without it will fail). Extend the "quick single-fixture E2E cycle" recipe to show `npm run build:release` before running the matrix. **The "runner does NOT rebuild fixtures" contract stays.**
- `README.md`: brief mention if user-facing.
- Delete Route A / Route C historical framing from this file once Phase 3 lands.

## Final-state caller recipes

After all phases land:

```powershell
# Debug matrix, fingerprint enabled
pnpm build:library:fingerprint
pnpm build:fixtures --mode=debug
pnpm test:matrix --fingerprint=true --build-mode=debug

# Publish matrix, fingerprint disabled
pnpm publish:library:nofingerprint
pnpm build:fixtures --mode=release
pnpm test:matrix --fingerprint=false --build-mode=publish

# Single-bundler focused loop
pnpm publish:library:fingerprint
pnpm build:fixtures --mode=release --bundler=vite
pnpm test:matrix --fingerprint=true --build-mode=publish --bundler=vite

# None matrix (integration only; E2E rejected by matrix runner)
pnpm clean:library
pnpm test:matrix --fingerprint=false --build-mode=none --integration
```

Note: `pnpm` forwards args to scripts directly — no `--` separator required.


