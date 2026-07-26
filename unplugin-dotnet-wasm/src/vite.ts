import { dotnetWasmUnplugin } from './unplugin/index';

const DotnetWasm = dotnetWasmUnplugin.vite;
export default DotnetWasm;
export { DotnetWasm as 'module.exports' };

/**
 * @deprecated Use `DotnetWasm` instead. `DotnetAssets` will be removed in a future release.
 */
export const DotnetAssets = DotnetWasm;
