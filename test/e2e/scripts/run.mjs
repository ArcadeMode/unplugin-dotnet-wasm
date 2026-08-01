#!/usr/bin/env node
// Thin E2E dispatcher: `--bundler=<name>` + `--platform=<browser|node>` become
// the shard filter (FIXTURE_BUNDLER / FIXTURE_PLATFORM env, read by
// permuteFixture) and select the test framework. No env-var cartesian.
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    bundler: { type: 'string' },
    platform: { type: 'string', default: 'browser' },
  },
});

const env = { ...process.env };
if (values.bundler) env.FIXTURE_BUNDLER = values.bundler;
if (values.platform) env.FIXTURE_PLATFORM = values.platform;

let command;
let args;
if (values.platform === 'node') {
  command = 'npx';
  args = ['vitest', 'run', '--config', 'vitest.e2e.config.ts'];
} else {
  command = 'npx';
  args = ['playwright', 'test', '--project=chromium'];
}

const result = spawnSync(command, args, {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
