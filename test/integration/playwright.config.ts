import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const BUNDLER = process.env.BUNDLER ?? 'vite';
const DIST_DIR = process.env.DIST_DIR
  ?? resolve(__dirname, `../fixtures/library-build-${BUNDLER}/dist`);

export default defineConfig({
  testDir: '.',
  testMatch: ['*.spec.ts'],
  timeout: 60_000,
  globalSetup: './global-setup.ts',
  use: {
    baseURL: 'http://localhost:5174',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: `pnpm exec sirv "${DIST_DIR}" --port 5174 --single`,
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
