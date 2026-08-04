import { join } from 'node:path';
import { runToCompletion } from './proc';
import type { BuildMode } from './types';

export interface DotnetConfig {
  configuration: 'Debug' | 'Release';
  isPublish: boolean;
}

export function dotnetConfigFor(buildMode: BuildMode): DotnetConfig {
  return buildMode === 'publish'
    ? { configuration: 'Release', isPublish: true }
    : { configuration: 'Debug', isPublish: false };
}

export const TARGET_FRAMEWORK = 'net10.0';

export function libraryOutputDir(libraryDir: string, buildMode: BuildMode): string {
  const { configuration, isPublish } = dotnetConfigFor(buildMode);
  return join(libraryDir, 'bin', configuration, TARGET_FRAMEWORK, isPublish ? 'publish' : '');
}

export interface BuildLibraryParams {
  libraryDir: string;
  buildMode: BuildMode;
  fingerprint: boolean;
  altered: boolean;
}

export async function buildLibrary(params: BuildLibraryParams): Promise<void> {
  const { libraryDir, buildMode, fingerprint, altered } = params;
  const { configuration, isPublish } = dotnetConfigFor(buildMode);
  const csproj = join(libraryDir, 'Library.csproj');
  const args = [
    isPublish ? 'publish' : 'build',
    csproj,
    '-c',
    configuration,
    `-p:WasmFingerprintAssets=${fingerprint}`,
  ];
  if (altered) args.push('-p:LibraryAltered=true');
  await runToCompletion('dotnet', args, { cwd: libraryDir });
}
