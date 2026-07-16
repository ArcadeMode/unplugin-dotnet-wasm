import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);

export const BUNDLERS = ['vite', 'rollup', 'rolldown', 'webpack', 'rspack', 'rsbuild', 'esbuild', 'farm', 'bun'];
export const PLATFORMS = ['node', 'browser'];
export const BUNDLERS_SUPPORT = {
  node: ['vite', 'rollup', 'rolldown', 'esbuild'],
  browser: ['vite', 'rollup', 'rolldown', 'webpack', 'rspack', 'rsbuild', 'esbuild', 'farm', 'bun'],
};

export const SERVE_MODES = ['dist', 'server'];
// Bundlers whose dev server + middleware are wired for serve=server. Append per Parts 4–7.
export const DEV_SERVER_BUNDLERS = ['vite', 'webpack', 'rspack', 'rsbuild'];

const FINGERPRINT_MAP = { true: 'fingerprint', false: 'nofingerprint' };

export function resolveBin(pkgName, binName = pkgName) {
  const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
  const pkg = require(pkgJsonPath);
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[binName];
  if (!bin) throw new Error(`No bin entry '${binName}' found in ${pkgName}/package.json`);
  return resolve(dirname(pkgJsonPath), bin);
}

export function parseMatrixArgs() {
  const options = {
    integration:  { type: 'boolean', default: false },
    e2e:          { type: 'boolean', default: false },
    fingerprint:  { type: 'string' },
    'build-mode': { type: 'string' },
    bundler:      { type: 'string' },
    platform:     { type: 'string' },
    'serve-mode': { type: 'string' },
  };
  const { values } = parseArgs({ options, allowPositionals: true });

  if (!values.fingerprint || !['true', 'false'].includes(values.fingerprint)) {
    console.error("ERROR: --fingerprint is required and must be 'true' or 'false'");
    process.exit(1);
  }
  const buildMode = values['build-mode'];
  if (!buildMode || !['debug', 'publish', 'none'].includes(buildMode)) {
    console.error("ERROR: --build-mode is required (debug, publish, or none)");
    process.exit(1);
  }
  if (values.platform && !PLATFORMS.includes(values.platform)) {
    console.error(`ERROR: --platform must be 'node' or 'browser', got '${values.platform}'`);
    process.exit(1);
  }

  const serveMode = values['serve-mode'] ?? 'dist';
  if (!SERVE_MODES.includes(serveMode)) {
    console.error(`ERROR: --serve-mode must be one of: ${SERVE_MODES.join(', ')}`);
    process.exit(1);
  }

  const runIntegration = values.integration || (!values.integration && !values.e2e);
  const runE2e         = values.e2e         || (!values.integration && !values.e2e);

  if (runE2e && buildMode === 'none') {
    console.error('ERROR: --e2e is not runnable with --build-mode=none (fixture build fails by design; runtime tests are meaningless). Use --integration.');
    process.exit(1);
  }

  return {
    bundlers:    values.bundler  ? [values.bundler]  : BUNDLERS,
    platforms:   values.platform ? [values.platform] : PLATFORMS,
    fingerprint: FINGERPRINT_MAP[values.fingerprint],
    buildMode,
    serveMode,
    runIntegration,
    runE2e,
  };
}

/** @returns {Array<{ type, bundler, platform, fingerprint, buildMode, serveMode }>} */
export function buildConfigs({ bundlers, platforms, fingerprint, buildMode, serveMode, runIntegration, runE2e }) {
  const configs = [];
  const push = type => bundlers.forEach(b => platforms.forEach(p =>
    configs.push({ type, bundler: b, platform: p, fingerprint, buildMode, serveMode })
  ));
  if (runIntegration) push('integration');
  if (runE2e) push('e2e');
  return configs;
}

/**
 * @returns {{ config: string, type: string, status: 'passed'|'failed'|'skipped', exitCode: number|null }}
 */
export function runConfig(config, { cwd, vitestBin, index, total }) {
  const configName = `${config.bundler}-${config.platform}-${config.serveMode}-${config.fingerprint}-${config.buildMode}`;

  const serverIllegal = config.serveMode === 'server' && (
    config.type !== 'e2e' || config.platform !== 'browser' ||
    !DEV_SERVER_BUNDLERS.includes(config.bundler) || config.buildMode === 'none'
  );
  if (serverIllegal || !BUNDLERS_SUPPORT[config.platform].includes(config.bundler)) {
    return { config: configName, type: config.type, status: 'skipped', exitCode: null };
  }

  console.log(`[${index + 1}/${total}] Running ${config.type} tests for ${config.platform} (${configName})...`);

  const env = {
    ...process.env,
    BUNDLER:            config.bundler,
    PLATFORM:           config.platform,
    DOTNET_FINGERPRINT: config.fingerprint,
    DOTNET_BUILD_MODE:  config.buildMode,
    SERVE_MODE:         config.serveMode,
  };

  const [cmd, cmdArgs, opts] = config.type === 'integration'
    ? [process.execPath, [vitestBin, 'run'], {}]
    : config.platform === 'node'
      ? [process.execPath, [vitestBin, 'run', '--config', 'vitest.e2e.config.ts'], {}]
      : ['pnpm', ['exec', 'playwright', 'test'], { shell: true }];

  const proc = spawnSync(cmd, cmdArgs, { cwd, env, stdio: 'inherit', ...opts });

  const exitCode = proc.status ?? proc.error?.code ?? 1;
  const status   = proc.status === 0 ? 'passed' : 'failed';

  console[status === 'failed' ? 'error' : 'log'](
    status === 'failed'
      ? `✗ FAILED: ${config.type} tests for ${configName} (exit code: ${exitCode})\n`
      : `✓ PASSED: ${config.type} tests for ${configName}\n`
  );

  return { config: configName, type: config.type, status, exitCode };
}

/**
 * @returns {number} count of failed cells
 */
export function printSummary(results) {
  const W = 80;
  console.log('\n' + '='.repeat(W));
  console.log('TEST MATRIX SUMMARY');
  console.log('='.repeat(W));
  for (const r of results) {
    const label = r.status === 'passed' ? '✓ PASSED' : r.status === 'failed' ? '✗ FAILED' : '⊘ SKIPPED';
    console.log(`${label.padEnd(12)} ${r.config.padEnd(40)} (${r.type})`);
  }
  console.log('='.repeat(W));
  const failed  = results.filter(r => r.status === 'failed').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const passed  = results.length - failed - skipped;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`);
  console.log('='.repeat(W) + '\n');
  return failed;
}
