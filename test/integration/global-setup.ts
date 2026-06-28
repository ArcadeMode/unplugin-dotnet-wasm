import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default async function globalSetup(): Promise<void> {
  await build({
    root: resolve(__dirname, '../fixtures/library-build'),
    logLevel: 'error',
  });
}
