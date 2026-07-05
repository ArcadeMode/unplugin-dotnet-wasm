import { execFileSync } from 'node:child_process';
import { readBundler } from './test-matrix-parameters';

const BUNDLER = readBundler();
const VALID_BUNDLERS = new Set([
  'vite', 'rollup', 'rolldown', 'webpack', 'rspack', 'rsbuild', 'esbuild', 'farm', 'bun',
]);

export default async function globalSetup(): Promise<void> {
  if (!VALID_BUNDLERS.has(BUNDLER)) {
    throw new Error(`[global-setup] BUNDLER='${BUNDLER}' is not one of ${[...VALID_BUNDLERS].join(', ')}.`);
  }
  const fixtureName = `@dotnet-wasm-bundler/library-app-browser-${BUNDLER}-fixture`;
  execFileSync('pnpm', ['--filter', fixtureName, 'build'], { stdio: 'inherit', shell: true });
}
