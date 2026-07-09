import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readBundler, readFingerprint, readBuildMode } from './test-matrix-parameters';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const BUNDLER = readBundler();
const DIST_DIR = process.env.DIST_DIR
  ?? resolve(__dirname, `../fixtures/browser/library-app-${BUNDLER}/dist`);
const configName = `e2e-playwright-${BUNDLER}-browser-${readFingerprint()}-${readBuildMode()}-${process.platform}`;

export default defineConfig({
  testDir: 'tests',
  testMatch: ['*.spec.ts'],
  timeout: 60_000,
  globalSetup: './global-setup.ts',
  reporter: [['junit', { outputFile: resolve(__dirname, `test-results/${configName}.junit.xml`) }]],
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
