import { createUnplugin } from 'unplugin';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
export const REAL_WASM = resolve(
  REPO_ROOT,
  'test/fixtures/Library/bin/Debug/net10.0/wwwroot/_framework/Library.wasm',
);

export const VIRTUAL_SPECIFIER = 'dotnet-asset-test';

const WEBPACK_LIKE_RULE = {
  // Scope by absolute file path via `include`, not by extension via `test`.
  // A naked `test: /\.wasm$/` would claim every `.wasm` in a downstream project
  // (and, on rsbuild, would still have to fight rsbuild's default wasm-ESM
  // handling). Matching only paths our `resolveId` actually returns lets the
  // bundler keep its normal wasm behavior — including `experiments.asyncWebAssembly`
  // — for every wasm file we didn't own.
  test: /\.wasm$/,
  include: REAL_WASM,
  type: 'asset/resource',
};

export const spikePlugin = createUnplugin((_options, meta) => {
  const framework = meta.framework;
  const isRollupFamily =
    framework === 'rollup' || framework === 'vite' || framework === 'rolldown';
  const isWebpackFamily =
    framework === 'webpack' || framework === 'rspack' || framework === 'rsbuild';
  const isEsbuildFamily = framework === 'esbuild' || framework === 'bun';

  const resolveHook = {
    resolveId(source) {
      if (source !== VIRTUAL_SPECIFIER) return null;
      return REAL_WASM;
    },
  };

  const base = {
    name: 'spike-asset-emission',
    enforce: 'pre',
  };

  if (isRollupFamily) {
    return {
      ...base,
      ...resolveHook,
      async load(id) {
        if (!id.endsWith('.wasm')) return null;
        const source = await readFile(id);
        const refId = this.emitFile({ type: 'asset', name: basename(id), source });
        return `export default import.meta.ROLLUP_FILE_URL_${refId};`;
      },
    };
  }

  if (isWebpackFamily) {
    // Omit `load` on webpack-family — unplugin's webpack load-loader is not
    // `raw: true`, so binary bytes would get UTF-8 round-tripped and corrupted.
    // Inject an `asset/resource` module rule via the framework hook instead;
    // it kicks in because our resolveId returns a real `.wasm` file path.
    return {
      ...base,
      ...resolveHook,
      webpack(compiler) {
        compiler.options.module ??= { rules: [] };
        compiler.options.module.rules ??= [];
        compiler.options.module.rules.push(WEBPACK_LIKE_RULE);
      },
      rspack(compiler) {
        compiler.options.module ??= { rules: [] };
        compiler.options.module.rules ??= [];
        compiler.options.module.rules.push(WEBPACK_LIKE_RULE);
      },
      // Rsbuild's built-in rule for `.wasm` runs ahead of our appended rule,
      // so on rsbuild we prepend into `config.module.rules` via the rsbuild
      // hook rather than push through the shared rspack hook. The rule is
      // scoped by absolute path (see WEBPACK_LIKE_RULE), so it only claims
      // files we resolved — user `.wasm` imports keep going through rsbuild's
      // default `experiments.asyncWebAssembly` ES-module handling.
      rsbuild: {
        setup(api) {
          api.modifyRspackConfig(config => {
            config.module ??= { rules: [] };
            config.module.rules ??= [];
            config.module.rules.unshift(WEBPACK_LIKE_RULE);
          });
        },
      },
    };
  }

  if (isEsbuildFamily) {
    // Skip unplugin's `resolveId` on esbuild/bun — it would place the resolved
    // path in unplugin's own namespace, bypassing the bundler's native
    // extension-loader mapping (`.wasm` → `file`). Register onResolve directly
    // via the framework hook so the file lands in the default namespace where
    // esbuild/bun's `file` loader will hash + emit it. Both adapters use
    // `plugin.<framework>.setup(build)` in unplugin 3.x (not a bare function).
    const filter = new RegExp(`^${VIRTUAL_SPECIFIER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    const setup = build => {
      build.onResolve({ filter }, () => ({ path: REAL_WASM }));
    };
    return {
      ...base,
      esbuild: { setup },
      bun: { setup },
    };
  }

  // farm: farm's build config marks `.wasm` as an asset via
  // `compilation.assets.include`; resolveId is enough for it to see the file.
  return { ...base, ...resolveHook };
});


