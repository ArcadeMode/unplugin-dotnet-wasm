import { defineConfig } from '@farmfe/core';
import DotnetWasm from 'unplugin-dotnet-wasm/farm';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error - sibling .mjs helper materialized next to this config
import { farmSentinelPlugin } from './sentinel.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const projectRoot = process.env.DOTNET_PROJECT_ROOT;
if (!projectRoot) {
  throw new Error('DOTNET_PROJECT_ROOT env var is required (set by the fixture-builder).');
}
const projectName = process.env.DOTNET_PROJECT_NAME;
if (!projectName) {
  throw new Error('DOTNET_PROJECT_NAME env var is required (set by the fixture-builder).');
}
const configuration = (process.env.DOTNET_CONFIGURATION ?? 'Debug') as 'Debug' | 'Release';
const isPublish = process.env.DOTNET_IS_PUBLISH === 'true';
const platform = process.env.DOTNET_FIXTURE_PLATFORM === 'node' ? 'node' : 'browser';

const htmlInjectScriptAutostartFalse = {
  name: 'disable-blazor-autostart',
  transformHtml: {
    order: 2,
    executor({ htmlResource }: { htmlResource: { bytes: number[] } }) {
      const html = Buffer.from(htmlResource.bytes)
        .toString()
        .replace(/<script\b([^>]*)>/gi, (tag, attrs) =>
          /\bautostart\s*=/i.test(attrs) ? tag : `<script autostart="false"${attrs}>`,
        );
      htmlResource.bytes = [...Buffer.from(html)];
      return htmlResource;
    },
  },
};

export default defineConfig(() => {
  const plugins = [
    DotnetWasm({
      projectRoot,
      projectName,
      configuration,
      isPublish,
      targetFramework: 'net10.0',
      logLevel: 'info',
    }),
    farmSentinelPlugin(),
    htmlInjectScriptAutostartFalse,
  ];

  if (platform === 'node') {
    return {
      compilation: {
        input: { entry: resolve(__dirname, 'src/entry.ts') },
        output: {
          path: resolve(__dirname, 'dist'),
          entryFilename: '[entryName].js',
          filename: 'assets/[name].[hash].[ext]',
          assetsFilename: 'assets/[resourceName].[hash].[ext]',
          targetEnv: 'node-next' as const,
        },
        assets: {
          include: ['wasm', 'dat', 'pdb'],
          mode: 'browser' as const,
        },
        partialBundling: {
          enforceResources: [{ name: 'entry', test: ['.+'] }],
        },
        minify: false,
        persistentCache: false,
        progress: false,
      },
      plugins,
    };
  }

  return {
    compilation: {
      input: { index: resolve(__dirname, 'index.html') },
      output: {
        path: resolve(__dirname, 'dist'),
        filename: 'assets/[name].[hash].[ext]',
        assetsFilename: 'assets/[resourceName].[hash].[ext]',
        targetEnv: 'browser-esnext' as const,
      },
      assets: {
        include: ['wasm', 'dat', 'pdb'],
      },
      minify: false,
      persistentCache: false,
      progress: false,
    },
    server: { strictPort: true },
    plugins,
  };
});
