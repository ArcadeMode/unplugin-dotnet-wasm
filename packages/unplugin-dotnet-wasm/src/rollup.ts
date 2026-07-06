import { dotnetStaticAssets } from './unplugin/index.js';

const DotnetAssets = dotnetStaticAssets.rollup;
export default DotnetAssets;
export { DotnetAssets as 'module.exports' };
