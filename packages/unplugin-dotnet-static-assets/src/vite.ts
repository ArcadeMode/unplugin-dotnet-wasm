import { dotnetStaticAssets } from './unplugin/index.js';

/**
 * Vite-specific adapter.
 * Implementation begins in M1.5.
 */
export default dotnetStaticAssets.vite;
export const DotnetAssets = dotnetStaticAssets.vite;
