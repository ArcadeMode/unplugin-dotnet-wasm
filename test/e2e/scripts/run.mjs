#!/usr/bin/env node

import { availableParallelism } from 'node:os';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execa } from 'execa';
import pLimit from 'p-limit';

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
const PLATFORMS = ['browser', 'node'];

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
const concurrency = platforms.includes('browser')
  ? Math.max(1, Math.floor(parallelism / 2))
  : parallelism;

const bodyOf = (/** @type {{ bundler: string, platform: string }} */ s) =>
  `${s.bundler}/${s.platform}`;
const bodyWidth = Math.max(...shards.map((s) => bodyOf(s).length));
const prefixOf = (/** @type {{ bundler: string, platform: string }} */ s) =>
  `[${bodyOf(s).padEnd(bodyWidth)}] `;

/**
 * @param {import('node:stream').Readable | null | undefined} stream
 * @param {string} prefix
 */
async function pipePrefixed(stream, prefix) {
  if (!stream) return;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    process.stdout.write(`${prefix}${line}\n`);
  }
}

/**
 * @param {{ bundler: string, platform: string }} shard
 * @param {{ inherit: boolean }} opts
 */
async function runShard(shard, opts) {
  const args =
    shard.platform === 'node'
      ? ['vitest', 'run', '--config', 'vitest.e2e.config.ts']
      : ['playwright', 'test', '--project=chromium'];

  const env = {
    ...process.env,
    FIXTURE_BUNDLER: shard.bundler,
    FIXTURE_PLATFORM: shard.platform,
  };

  if (opts.inherit) {
    const result = await execa('npx', args, {
      cwd: PACKAGE_ROOT,
      env,
      stdio: 'inherit',
      reject: false,
      shell: process.platform === 'win32',
    });
    return { shard, exitCode: result.exitCode ?? 1 };
  }

  const prefix = prefixOf(shard);
  const subprocess = execa('npx', args, {
    cwd: PACKAGE_ROOT,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
    reject: false,
    shell: process.platform === 'win32',
  });

  const [result] = await Promise.all([
    subprocess,
    pipePrefixed(subprocess.stdout, prefix),
    pipePrefixed(subprocess.stderr, prefix),
  ]);

  const exitCode = result.exitCode ?? 1;
  const mark = exitCode === 0 ? '✓' : '✗';
  process.stdout.write(`${prefix}${mark} exit ${exitCode}\n`);
  return { shard, exitCode };
}

const inherit = shards.length === 1;
const limit = pLimit(concurrency);

console.log(
  `e2e: ${shards.length} shard(s), concurrency=${concurrency}` +
    ` (parallelism=${parallelism}` +
    `${platforms.includes('browser') ? ', browser⇒⌊P/2⌋' : ''})`,
);

const results = await Promise.all(shards.map((shard) => limit(() => runShard(shard, { inherit }))));

const failed = results.filter((r) => r.exitCode !== 0);
if (failed.length > 0) {
  console.error(`\ne2e: ${failed.length}/${results.length} shard(s) failed`);
  process.exit(1);
}
