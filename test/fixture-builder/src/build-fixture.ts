import { Fixture } from './fixture';
import { materialize } from './materialize';
import { projectNameFor } from './types';
import type { BuildFixtureOptions } from './types';

/**
 * Materialize a runnable project + isolated .NET Library on disk.
 *
 * `DOTNET_PROJECT_ROOT` points at the materialized `Library/` folder;
 * `DOTNET_PROJECT_NAME` is `WasmLibrary` or `BlazorLibrary` (csproj basename).
 * Template `bin/` is never copied (avoids stale fingerprint/publish outputs);
 * `obj/` is kept when present for restore/compile warmup.
 */
export async function buildFixture(options: BuildFixtureOptions): Promise<Fixture> {
  const keepOnDispose = options.keepOnDispose ?? false;

  const project = materialize({
    options: {
      bundler: options.bundler,
      platform: options.platform,
      serveMode: options.serveMode,
      buildMode: options.buildMode,
      kind: options.kind,
    },
  });

  return new Fixture({
    project,
    bundler: options.bundler,
    platform: options.platform,
    serveMode: options.serveMode,
    buildMode: options.buildMode,
    kind: options.kind,
    projectName: projectNameFor(options.kind),
    keepOnDispose,
  });
}
