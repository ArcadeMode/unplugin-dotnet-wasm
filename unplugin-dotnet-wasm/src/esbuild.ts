import { dotnetWasmUnplugin } from './unplugin/index';

const DotnetWasm = dotnetWasmUnplugin.esbuild;
export default DotnetWasm;
export { DotnetWasm as 'module.exports' };
