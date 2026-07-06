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

const FINGERPRINT_SHAPES = {
  true: 'fingerprint',
  false: 'nofingerprint',
  none: 'none',
};

export function resolveBin(pkgName, binName = pkgName) {
  const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
  const pkg = require(pkgJsonPath);
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[binName];
  if (!bin) throw new Error(`No bin entry '${binName}' found in ${pkgName}/package.json`);
  return resolve(dirname(pkgJsonPath), bin);
}

export function parseMatrixArgs() {
  const options = {
    integration: { type: 'boolean', default: false },
    e2e:         { type: 'boolean', default: false },
    fingerprint: { type: 'string' },
    bundler:     { type: 'string' },
    platform:    { type: 'string' },
  };
  const { values } = parseArgs({ options, allowPositionals: true });

  if (!values.fingerprint) {
    console.error('ERROR: --fingerprint is required (true, false, or none)');
    process.exit(1);
  }
  if (!['true', 'false', 'none'].includes(values.fingerprint)) {
    console.error(`ERROR: --fingerprint must be 'true', 'false', or 'none', got '${values.fingerprint}'`);
    process.exit(1);
  }
  if (values.platform && !PLATFORMS.includes(values.platform)) {
    console.error(`ERROR: --platform must be 'node' or 'browser', got '${values.platform}'`);
    process.exit(1);
  }

  const runIntegration = values.integration || (!values.integration && !values.e2e);
  const runE2e         = values.e2e         || (!values.integration && !values.e2e);

  return {
    bundlers:     values.bundler   ? [values.bundler]   : BUNDLERS,
    platforms:    values.platform  ? [values.platform]  : PLATFORMS,
    fixtureShape: FINGERPRINT_SHAPES[values.fingerprint],
    runIntegration,
    runE2e,
  };
}

/** @returns {Array<{ type, bundler, platform, shape }>} */
export function buildConfigs({ bundlers, platforms, fixtureShape, runIntegration, runE2e }) {
  const configs = [];
  if (runIntegration) {
    bundlers.forEach(b => platforms.forEach(p =>
      configs.push({ type: 'integration', bundler: b, platform: p, shape: fixtureShape })
    ));
  }
  if (runE2e) {
    bundlers.forEach(b => platforms.forEach(p =>
      configs.push({ type: 'e2e', bundler: b, platform: p, shape: fixtureShape })
    ));
  }
  return configs;
}

/**
 * @returns {{ config: string, type: string, status: 'passed'|'failed'|'skipped', exitCode: number|null }}
 */
export function runConfig(config, { cwd, vitestBin, playwrightBin, index, total }) {
  const configName = `${config.bundler}-${config.platform}-${config.shape}`;

  if (!BUNDLERS_SUPPORT[config.platform].includes(config.bundler)) {
    return { config: configName, type: config.type, status: 'skipped', exitCode: null };
  }

  console.log(`[${index + 1}/${total}] Running ${config.type} tests for ${config.platform} (${configName})...`);

  const env = {
    ...process.env,
    BUNDLER:              config.bundler,
    PLATFORM:             config.platform,
    DOTNET_FIXTURE_SHAPE: config.shape,
  };

  const [cmd, cmdArgs] = config.type === 'integration'
    ? [process.execPath, [vitestBin, 'run']]
    : config.platform === 'node'
      ? [process.execPath, [vitestBin, 'run', '--config', 'vitest.e2e.config.ts']]
      : [process.execPath, [playwrightBin, 'test']];

  const proc = spawnSync(cmd, cmdArgs, { cwd, env, stdio: 'inherit' });

  const exitCode = proc.status ?? proc.error?.code ?? 1;
  const status   = proc.status === 0 ? 'passed' : 'failed';

  if (status === 'failed') {
    console.error(`✗ FAILED: ${config.type} tests for ${configName} (exit code: ${exitCode})\n`);
  } else {
    console.log(`✓ PASSED: ${config.type} tests for ${configName}\n`);
  }

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
