import { dotnetStaticAssets } from './unplugin/index';

const DotnetAssets = dotnetStaticAssets.rollup;
export default DotnetAssets;
export { DotnetAssets as 'module.exports' };
