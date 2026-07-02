import { dotnetStaticAssets } from './unplugin/index.js';

const DotnetAssets = dotnetStaticAssets.rspack;
export default DotnetAssets;
export { DotnetAssets as 'module.exports' };
