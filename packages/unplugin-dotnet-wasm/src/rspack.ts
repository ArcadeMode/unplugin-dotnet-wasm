import { dotnetStaticAssets } from './unplugin/index';

const DotnetAssets = dotnetStaticAssets.rspack;
export default DotnetAssets;
export { DotnetAssets as 'module.exports' };
