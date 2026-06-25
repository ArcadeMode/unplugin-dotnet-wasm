import { createUnplugin } from 'unplugin';
import type { DotnetAssetsOptions } from '../types.js';

/**
 * Shared unplugin factory.
 * Implementation begins in M1.5 — this stub satisfies the build for M1.1.
 */
export const dotnetStaticAssets = createUnplugin((_options: DotnetAssetsOptions) => {
  return {
    name: 'unplugin-dotnet-static-assets',
  };
});
