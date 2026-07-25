import { dotnetWasmUnplugin } from './unplugin/index';

const DotnetWasm = dotnetWasmUnplugin.webpack;
export default DotnetWasm;
export { DotnetWasm as 'module.exports' };
