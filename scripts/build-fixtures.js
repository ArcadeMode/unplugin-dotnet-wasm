#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    mode: { type: 'string' },
    bundler: { type: 'string', default: '*' },
    platform: { type: 'string', default: '*' },
  },
});

if (!['debug', 'release'].includes(values.mode)) {
  console.error('ERROR: --mode is required (debug or release)');
  process.exit(1);
}

const filter = `@dotnet-wasm-bundler/library-app-${values.platform}-${values.bundler}-fixture`;
const res = spawnSync('pnpm', ['--filter', filter, `build:${values.mode}`], {
  stdio: 'inherit',
  shell: true,
});
process.exit(res.status ?? 1);
