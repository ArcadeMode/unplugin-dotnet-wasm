import { Fixture } from './fixture';
import { materialize } from './materialize';
import { allocatePort } from './ports';
import type { BuildFixtureOptions } from './types';

/**
 * Materialize a runnable project + isolated .NET Library, build the baseline
 * library, and return a {@link Fixture}. The caller is responsible for
 * `start()` / `build()` and, ultimately, `dispose()`.
 */
export async function buildFixture(options: BuildFixtureOptions): Promise<Fixture> {
  const buildMode = options.buildMode ?? 'debug';
  const fingerprint = options.fingerprint ?? false;
  const altered = options.altered ?? false;
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

  const fixture = new Fixture({
    project,
    bundler: options.bundler,
    platform: options.platform,
    serveMode: options.serveMode,
    buildMode,
    fingerprint,
    port,
    keepOnDispose,
  });

  await fixture.buildLibrary({ altered });
  return fixture;
}
