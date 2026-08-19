import { dotnetWasmUnplugin } from './unplugin/index';

const DotnetWasm = dotnetWasmUnplugin.rspack;
export default DotnetWasm;
export { DotnetWasm as 'module.exports' };
