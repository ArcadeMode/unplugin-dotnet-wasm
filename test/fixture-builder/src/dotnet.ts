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

export interface BuildLibraryParams {
  libraryDir: string;
  buildMode: BuildMode;
  fingerprint: boolean;
  /** `true` compiles the `#if LIBRARY_ALTERED` branch (Hola greeting). */
  altered: boolean;
}

/**
 * Build (or publish) the isolated Library copy. No shared build cache — each
 * fixture owns its output dir, so concurrent builds never collide.
 */
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
    // Isolated build: don't leave persistent build servers (MSBuild node reuse
    // + Roslyn VBCSCompiler) alive. They keep handles/cwd inside the Library
    // obj/ dir and block removal of the materialized fixture on Windows.
    '-nodeReuse:false',
    '-p:UseSharedCompilation=false',
  ];
  if (altered) args.push('-p:LibraryAltered=true');
  await runToCompletion('dotnet', args, { cwd: libraryDir });
}
