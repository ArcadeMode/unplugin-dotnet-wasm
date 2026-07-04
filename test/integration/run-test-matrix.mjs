import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BUNDLERS = ['vite', 'rollup', 'rolldown', 'webpack', 'rspack', 'rsbuild', 'esbuild', 'farm', 'bun'];
const PLATFORMS = ['node', 'browser'];
const BUNDLERS_SUPPORT = {
  node: ['vite', 'rollup', 'rolldown', 'farm'],
  browser: ['vite', 'rollup', 'rolldown', 'webpack', 'rspack', 'rsbuild', 'esbuild', 'farm', 'bun'],
};
const FINGERPRINT_SHAPES = {
  true: 'fingerprint',
  false: 'nofingerprint',
  none: 'none',
};



const options = {
  integration: { type: 'boolean', default: false },
  e2e: { type: 'boolean', default: false },
  fingerprint: { type: 'string' },
  bundler: { type: 'string' },
  platform: { type: 'string' },
};

const { values } = parseArgs({ options, allowPositionals: true });

// Validate fingerprint argument
if (!values.fingerprint) {
  console.error('ERROR: --fingerprint is required (true, false, or none)');
  process.exit(1);
}

if (!['true', 'false', 'none'].includes(values.fingerprint)) {
  console.error(`ERROR: --fingerprint must be 'true', 'false', or 'none', got '${values.fingerprint}'`);
  process.exit(1);
}

// Validate platform argument
if (values.platform && !PLATFORMS.includes(values.platform)) {
  console.error(`ERROR: --platform must be 'node' or 'browser', got '${values.platform}'`);
  process.exit(1);
}

// Default to both if neither specified
const runIntegration = values.integration || (!values.integration && !values.e2e);
const runE2e = values.e2e || (!values.integration && !values.e2e);

const bundlers = values.bundler ? [values.bundler] : BUNDLERS;
const platforms = values.platform ? [values.platform] : PLATFORMS;
const fixtureShape = FINGERPRINT_SHAPES[values.fingerprint];

const configs = [];
if (runIntegration) {
  bundlers.forEach(b => platforms.forEach(p => configs.push({ type: 'integration', bundler: b, platform: p, shape: fixtureShape })));
}
if (runE2e) {
  bundlers.forEach(b => platforms.forEach(p => configs.push({ type: 'e2e', bundler: b, platform: p, shape: fixtureShape })));
}

console.log(`Running ${configs.length} test configuration(s)...`);
console.log(`Fixture Shape: ${fixtureShape}\n`);

const results = [];
let totalFailed = 0;

for (const config of configs) {
  const configName = `${config.bundler}-${config.platform}-${config.shape}`;
  const testType = config.type === 'integration' ? 'test' : 'test:e2e';
  
  // Check if bundler is supported on this platform
  const supportedBundlers = BUNDLERS_SUPPORT[config.platform];
  if (!supportedBundlers.includes(config.bundler)) {
    console.warn(`⚠️  SKIPPING: ${config.bundler} is not supported on ${config.platform} platform`);
    results.push({
      config: configName,
      type: config.type,
      status: 'skipped',
      exitCode: null,
    });
    continue;
  }
  
  console.log(`[${configs.indexOf(config) + 1}/${configs.length}] Running ${config.type} tests for ${config.platform} (${configName})...`);

  const env = {
    ...process.env,
    BUNDLER: config.bundler,
    PLATFORM: config.platform,
    DOTNET_FIXTURE_SHAPE: config.shape,
  };

  const result = spawnSync('pnpm', [testType], {
    cwd: __dirname,
    env,
    stdio: 'inherit',
    shell: true,
  });

  const exitCode = result.status ?? result.error?.code ?? 1;
  const status = result.status === 0 ? 'passed' : 'failed';
  results.push({
    config: configName,
    type: config.type,
    status,
    exitCode,
  });

  if (status === 'failed') {
    totalFailed++;
    console.error(`✗ FAILED: ${config.type} tests for ${configName} (exit code: ${exitCode})\n`);
  } else {
    console.log(`✓ PASSED: ${config.type} tests for ${configName}\n`);
  }
}

// Print summary
console.log('\n' + '='.repeat(80));
console.log('TEST MATRIX SUMMARY');
console.log('='.repeat(80));
results.forEach(r => {
  let status;
  if (r.status === 'passed') status = '✓ PASSED';
  else if (r.status === 'failed') status = '✗ FAILED';
  else status = '⊘ SKIPPED';
  console.log(`${status.padEnd(12)} ${r.config.padEnd(40)} (${r.type})`);
});
console.log('='.repeat(80));
const skipped = results.filter(r => r.status === 'skipped').length;
const passed = results.length - totalFailed - skipped;
console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${totalFailed} | Skipped: ${skipped}`);
console.log('='.repeat(80) + '\n');

process.exit(totalFailed > 0 ? 1 : 0);
