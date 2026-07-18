import { dotnetStaticAssets } from './unplugin/index';

const DotnetAssets = dotnetStaticAssets.esbuild;
export default DotnetAssets;
export { DotnetAssets as 'module.exports' };
