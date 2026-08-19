import { dotnetWasmUnplugin } from './unplugin/index';

const DotnetWasm = dotnetWasmUnplugin.rsbuild;
export default DotnetWasm;
export { DotnetWasm as 'module.exports' };
