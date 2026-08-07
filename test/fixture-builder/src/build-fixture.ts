import { Fixture } from './fixture';
import { materialize } from './materialize';
import { allocatePort } from './ports';
import type { BuildFixtureOptions } from './types';

/**
 * Materialize a runnable project + isolated .NET Library on disk.
 */
export async function buildFixture(options: BuildFixtureOptions): Promise<Fixture> {
  const buildMode = options.buildMode ?? 'debug';
  const keepOnDispose = options.keepOnDispose ?? false;
  const clean = options.clean ?? false;
  const port = options.port ?? (await allocatePort());

  const project = materialize({
    options: {
      bundler: options.bundler,
      platform: options.platform,
      serveMode: options.serveMode,
      buildMode,
    },
    port,
    clean,
  });

  return new Fixture({
    project,
    bundler: options.bundler,
    platform: options.platform,
    serveMode: options.serveMode,
    buildMode,
    port,
    keepOnDispose,
  });
}
