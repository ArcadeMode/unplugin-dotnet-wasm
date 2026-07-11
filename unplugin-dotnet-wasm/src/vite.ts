import { dotnetStaticAssets } from './unplugin/index';

const DotnetAssets = dotnetStaticAssets.vite;
export default DotnetAssets;
export { DotnetAssets as 'module.exports' };