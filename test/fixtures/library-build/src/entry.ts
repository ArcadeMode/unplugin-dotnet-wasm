import { dotnet } from './_framework/dotnet';
import { TypeShimInitializer } from './typeshim';

async function initializeWasmRuntime(): Promise<void> {
  const runtimeInfo = await dotnet.create();
  await TypeShimInitializer.initialize(runtimeInfo);
  runtimeInfo.runMain();
  console.log('WASM runtime initialized successfully.');
}

initializeWasmRuntime();

