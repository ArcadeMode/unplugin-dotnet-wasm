import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readBundler, readFingerprint, readBuildMode, readServeMode } from './test-matrix-parameters';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const BUNDLER = readBundler();
const SERVE_MODE = readServeMode();
const BUILD_MODE = readBuildMode();
const FIXTURE = resolve(__dirname, `../fixtures/browser/library-app-${BUNDLER}`);
const DIST_DIR = process.env.DIST_DIR ?? resolve(FIXTURE, 'dist');
const configName = `e2e-playwright-${BUNDLER}-browser-${SERVE_MODE}-${readFingerprint()}-${BUILD_MODE}-${process.platform}`;

const prod = BUILD_MODE === 'publish' ? ' --mode production' : '';
const DEV_COMMANDS = {
  vite:    `pnpm --dir "${FIXTURE}" exec vite --port 5174 --strictPort${prod}`,
  webpack: `pnpm --dir "${FIXTURE}" exec webpack serve --config webpack.config.mjs --port 5174${prod}`,
  rspack:  `pnpm --dir "${FIXTURE}" exec rspack serve --config rspack.config.mjs --port 5174${prod}`,
};

export default defineConfig({
  testDir: 'tests',
  testMatch: ['*.spec.ts'],
  timeout: 60_000,
  globalSetup: './global-setup.ts',
  outputDir: resolve(__dirname, `test-results/e2e/${BUNDLER}`),
  reporter: [['junit', {
    outputFile: resolve(__dirname, `test-results/e2e/${BUNDLER}/${configName}.junit.xml`)
  }]],
  use: {
    baseURL: 'http://localhost:5174',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: SERVE_MODE === 'server'
    ? {
        command: DEV_COMMANDS[BUNDLER],
        url: 'http://localhost:5174',
        reuseExistingServer: false,
        timeout: 30_000,
      }
    : {
        command: `pnpm exec sirv "${DIST_DIR}" --port 5174 --single`,
        url: 'http://localhost:5174',
        reuseExistingServer: true,
        timeout: 30_000,
      },
});
