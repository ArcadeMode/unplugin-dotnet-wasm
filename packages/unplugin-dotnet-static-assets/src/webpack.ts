import { dotnetStaticAssets } from './unplugin/index.js';

const DotnetAssets = dotnetStaticAssets.webpack;
export default DotnetAssets;
export { DotnetAssets as 'module.exports' };
