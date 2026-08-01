import { Fixture } from './fixture';
import { materialize } from './materialize';
import { allocatePort } from './ports';
import type { BuildFixtureOptions } from './types';

/**
 * Materialize a runnable project + isolated .NET Library and return a
 * {@link Fixture}. The Library is NOT built yet: call `fixture.buildLibrary()`
 * before `build()`/`start()` when the test needs the .NET output to exist
 * (some tests, e.g. `DiscoveryError` coverage, deliberately skip it).
 */
export async function buildFixture(options: BuildFixtureOptions): Promise<Fixture> {
  const buildMode = options.buildMode ?? 'debug';
  const fingerprint = options.fingerprint ?? false;
  const keepOnDispose = options.keepOnDispose ?? false;
  const port = options.port ?? (await allocatePort());

  const project = materialize({
    options: {
      bundler: options.bundler,
      platform: options.platform,
      serveMode: options.serveMode,
      buildMode,
    },
    port,
  });

  return new Fixture({
    project,
    bundler: options.bundler,
    platform: options.platform,
    serveMode: options.serveMode,
    buildMode,
    fingerprint,
    port,
    keepOnDispose,
  });
}
