#!/usr/bin/env node

import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execa } from 'execa';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Keep in sync with CAPABILITIES keys in fixture-builder/src/capabilities.ts */
const BUNDLERS = [
  'vite',
  'rollup',
  'rolldown',
  'webpack',
  'rspack',
  'rsbuild',
  'esbuild',
  'farm',
  'bun',
];
const PLATFORMS = ['node', 'browser'];

const USAGE = `Usage:
  pnpm test:e2e --bundler=<name>                 # fan out platforms
  pnpm test:e2e --platform=<browser|node>        # fan out bundlers
  pnpm test:e2e --bundler=<name> --platform=…    # single shard

Bundlers: ${BUNDLERS.join(', ')}
Platforms: ${PLATFORMS.join(', ')}
At least one of --bundler / --platform is required.`;

const { values } = parseArgs({
  options: {
    bundler: { type: 'string' },
    platform: { type: 'string' },
  },
  strict: true,
});

if (!values.bundler && !values.platform) {
  console.error('error: provide --bundler and/or --platform.\n');
  console.error(USAGE);
  process.exit(1);
}

if (values.bundler && !BUNDLERS.includes(values.bundler)) {
  console.error(`error: unknown bundler "${values.bundler}".\n`);
  console.error(USAGE);
  process.exit(1);
}

if (values.platform && !PLATFORMS.includes(values.platform)) {
  console.error(`error: unknown platform "${values.platform}".\n`);
  console.error(USAGE);
  process.exit(1);
}

const bundlers = values.bundler ? [values.bundler] : [...BUNDLERS];
const platforms = values.platform ? [values.platform] : [...PLATFORMS];

/** @type {{ bundler: string, platform: string }[]} */
const shards = [];
for (const bundler of bundlers) {
  for (const platform of platforms) {
    shards.push({ bundler, platform });
  }
}

const parallelism = availableParallelism();
const workers = Math.max(1, Math.floor(parallelism / 2));

/**
 * @param {{ bundler: string, platform: string }} shard
 */
async function runShard(shard) {
  const args =
    shard.platform === 'node'
      ? ['vitest', 'run', '--config', 'vitest.e2e.config.ts', `--maxWorkers=${workers}`]
      : ['playwright', 'test', '--project=chromium', `--workers=${workers}`];

  const result = await execa('npx', args, {
    cwd: PACKAGE_ROOT,
    env: {
      ...process.env,
      FIXTURE_BUNDLER: shard.bundler,
      FIXTURE_PLATFORM: shard.platform,
    },
    stdio: 'inherit',
    reject: false,
    shell: process.platform === 'win32',
  });
  return { shard, exitCode: result.exitCode ?? 1 };
}

console.log(
  `e2e: ${shards.length} shard(s), sequential, workers=${workers} (parallelism=${parallelism})`,
);

/** @type {{ shard: { bundler: string, platform: string }, exitCode: number }[]} */
const results = [];
for (const shard of shards) {
  console.log(`\ne2e: ${shard.bundler}/${shard.platform}`);
  results.push(await runShard(shard));
}

const failed = results.filter((r) => r.exitCode !== 0);
if (failed.length > 0) {
  console.error(`\ne2e: ${failed.length}/${results.length} shard(s) failed`);
  process.exit(1);
}
