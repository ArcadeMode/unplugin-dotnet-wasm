import { dotnetWasmUnplugin } from './unplugin/index';

const DotnetWasm = dotnetWasmUnplugin.vite;
export default DotnetWasm;
export { DotnetWasm as 'module.exports' };
