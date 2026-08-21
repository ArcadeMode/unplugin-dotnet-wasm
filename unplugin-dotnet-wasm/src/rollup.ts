import { dotnetWasmUnplugin } from './unplugin/index';

const DotnetWasm = dotnetWasmUnplugin.rollup;
export default DotnetWasm;
export { DotnetWasm as 'module.exports' };
