// Test-only build-completion signal. Each bundler writes `.rebuild-done` into
// the materialized app root at the end of every compile. Tests wait on this token instead of polling `dist/`.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SENTINEL = resolve(fileURLToPath(new URL('.', import.meta.url)), '.rebuild-done');
let seq = 0;

export function touchSentinel() {
  writeFileSync(SENTINEL, `${Date.now()}:${++seq}`);
}

/** Rollup / Vite / Rolldown / Farm */
export function rollupSentinelPlugin() {
  return {
    name: 'test-sentinel',
    writeBundle() {
      touchSentinel();
    },
    finish: {
      executor() {
        touchSentinel();
      },
    },
  };
}

/** Webpack / Rspack */
export const webpackSentinelPlugin = {
  apply(compiler) {
    compiler.hooks.done.tap('TestSentinel', () => touchSentinel());
  },
};

/** Esbuild */
export const esbuildSentinelPlugin = {
  name: 'test-sentinel',
  setup(build) {
    build.onEnd((result) => {
      if (!result.errors || result.errors.length === 0) touchSentinel();
    });
  },
};
