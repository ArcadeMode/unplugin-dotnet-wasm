// Test-only build signals. Each bundler writes a monotonic sequence number into
// `.rebuild-start` when a (re)build begins and `.rebuild-done` = `${seq}:${status}`
// when it ends. Tests wait for a *quiescent* pair (start.seq === done.seq) so they
// never reload into a half-written dist/.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const START = resolve(HERE, '.rebuild-start');
const DONE = resolve(HERE, '.rebuild-done');

let seq = 0;
let currentSeq = 0;

export function startBuild() {
  currentSeq = ++seq;
  writeFileSync(START, String(currentSeq));
}

export function endBuild(status = 'ok') {
  writeFileSync(DONE, `${currentSeq}:${status}`);
}

/** Completion-only signal for bundlers without a start hook (bun/dist-only). */
export function touchSentinel() {
  endBuild('ok');
}

/** Rollup / Vite / Rolldown */
export function rollupSentinelPlugin() {
  return {
    name: 'test-sentinel',
    buildStart() {
      startBuild();
    },
    buildEnd(err) {
      // Success is signalled by writeBundle (after dist is flushed); only the
      // error path needs an end here, since writeBundle won't run.
      if (err) endBuild('error');
    },
    renderError() {
      endBuild('error');
    },
    writeBundle() {
      endBuild('ok');
    },
  };
}

/** Farm */
export function farmSentinelPlugin() {
  let isServe = false;
  const done = () => {
    if (isServe) return;
    startBuild(); // no start hook, so next best thing with start+end to essentially get an 'end' signal
    endBuild('ok');
  };
  return {
    name: 'test-sentinel',
    configureDevServer() {
      isServe = true;
    },
    writeResources: {
      executor: done,
    },
  };
}

/** Webpack / Rspack / Rsbuild (via api.onAfterCreateCompiler) */
export const webpackSentinelPlugin = {
  apply(compiler) {
    const compilers = compiler.compilers ?? [compiler];
    for (const c of compilers) {
      c.hooks.run.tap('TestSentinel', () => startBuild());
      c.hooks.watchRun.tap('TestSentinel', () => startBuild());
      c.hooks.done.tap('TestSentinel', (stats) => endBuild(stats.hasErrors() ? 'error' : 'ok'));
      c.hooks.failed.tap('TestSentinel', () => endBuild('error'));
    }
  },
};

/** Esbuild */
export const esbuildSentinelPlugin = {
  name: 'test-sentinel',
  setup(build) {
    build.onStart(() => startBuild());
    build.onEnd((result) => endBuild(result.errors?.length ? 'error' : 'ok'));
  },
};
