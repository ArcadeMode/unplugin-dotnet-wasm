// Test-only build-completion signal. Each bundler writes `.rebuild-done` into
// the materialized app root at the end of every compile (one-shot build and
// watch re-emit). The fixture waits on this token instead of polling `dist/`.
// This file is copied verbatim into the app root by `materialize`.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SENTINEL = resolve(fileURLToPath(new URL('.', import.meta.url)), '.rebuild-done');
let seq = 0;

/** Write a monotonic `<timestamp>:<seq>` token; the reader compares the string. */
export function touchSentinel() {
  writeFileSync(SENTINEL, `${Date.now()}:${++seq}`);
}

/** Rollup / Vite / Rolldown / Farm shape (`finish` is farm-only, ignored elsewhere). */
export function rollupSentinelPlugin() {
  return {
    name: 'test-sentinel',
    writeBundle() {
      touchSentinel();
    },
    finish() {
      touchSentinel();
    },
  };
}

/** Webpack / Rspack shape (`compiler.hooks.done` fires after every compile). */
export const webpackSentinelPlugin = {
  apply(compiler) {
    compiler.hooks.done.tap('TestSentinel', () => touchSentinel());
  },
};

/** Esbuild shape (`build.onEnd` fires on every build / watch re-emit). */
export const esbuildSentinelPlugin = {
  name: 'test-sentinel',
  setup(build) {
    build.onEnd((result) => {
      if (!result.errors || result.errors.length === 0) touchSentinel();
    });
  },
};
