import { dotnetStaticAssets } from './unplugin/index.js';

const DotnetAssets = dotnetStaticAssets.vite;
export default DotnetAssets;
export { DotnetAssets as 'module.exports' };