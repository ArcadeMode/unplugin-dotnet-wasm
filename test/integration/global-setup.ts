import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const BUNDLER = process.env.BUNDLER ?? 'vite';

export default async function globalSetup(): Promise<void> {
  // Only the Vite consumer fixture exists today; future bundler-specific
  // global-setups will branch on BUNDLER.
  if (BUNDLER !== 'vite') {
    throw new Error(`global-setup: BUNDLER='${BUNDLER}' is not implemented yet.`);
  }
  await build({
    root: resolve(__dirname, `../fixtures/library-build-${BUNDLER}`),
    logLevel: 'error',
  });
}
