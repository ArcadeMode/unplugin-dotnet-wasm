#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readPlatform } from './test-matrix-parameters.ts';

const platform = readPlatform();
const args = process.argv.slice(2);

let cmd, cmdArgs;

if (platform === 'node') {
  cmd = 'pnpm';
  cmdArgs = ['exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts', ...args];
} else {
  cmd = 'pnpm';
  cmdArgs = ['exec', 'playwright', 'test', ...args];
}

const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
