import { rmSync } from 'node:fs';
import { buildLibrary, dotnetConfigFor } from './dotnet';
import { ManagedProcess, NPM, runToCompletion, spawnManaged } from './proc';
import { waitForPort } from './ports';
import type { MaterializedProject } from './materialize';
import type {
  BuildMode,
  Bundler,
  Platform,
  RunResult,
  ServeMode,
  WaitForLogOptions,
} from './types';

export interface FixtureInit {
  project: MaterializedProject;
  bundler: Bundler;
  platform: Platform;
  serveMode: ServeMode;
  buildMode: BuildMode;
  fingerprint: boolean;
  port: number;
  keepOnDispose: boolean;
}

/** A materialized, runnable project bound to an isolated .NET Library copy. */
export class Fixture {
  readonly dir: string;
  readonly libraryDir: string;
  readonly bundler: Bundler;
  readonly platform: Platform;
  readonly serveMode: ServeMode;
  readonly buildMode: BuildMode;
  readonly fingerprint: boolean;
  readonly port: number;

  private readonly keepOnDispose: boolean;
  private server?: ManagedProcess;

  constructor(init: FixtureInit) {
    this.dir = init.project.dir;
    this.libraryDir = init.project.libraryDir;
    this.bundler = init.bundler;
    this.platform = init.platform;
    this.serveMode = init.serveMode;
    this.buildMode = init.buildMode;
    this.fingerprint = init.fingerprint;
    this.port = init.port;
    this.keepOnDispose = init.keepOnDispose;
  }

  get baseUrl(): string {
    return `http://localhost:${this.port}`;
  }

  /** Env passed to every bundler script: locates the Library, selects config. */
  private get scriptEnv(): NodeJS.ProcessEnv {
    const { configuration, isPublish } = dotnetConfigFor(this.buildMode);
    return {
      ...process.env,
      DOTNET_PROJECT_ROOT: this.libraryDir,
      DOTNET_CONFIGURATION: configuration,
      DOTNET_IS_PUBLISH: String(isPublish),
    };
  }

  /** Buffered dev-server/watcher output (empty until `start()`). */
  get logs(): string {
    return this.server?.output ?? '';
  }

  /**
   * (Re)build the isolated Library. Passing `altered: true` is the change
   * trigger for the change test.
   */
  async buildLibrary(opts: { altered?: boolean } = {}): Promise<void> {
    await buildLibrary({
      libraryDir: this.libraryDir,
      buildMode: this.buildMode,
      fingerprint: this.fingerprint,
      altered: opts.altered ?? false,
    });
  }

  /** Run an npm script from the generated `package.json` to completion. */
  runScript(name: string): Promise<RunResult> {
    return runToCompletion(NPM, ['run', name], {
      cwd: this.dir,
      env: this.scriptEnv,
    });
  }

  /** One-shot `build` script → `dist/`. */
  build(): Promise<RunResult> {
    return this.runScript('build');
  }

  /** Start the long-running runtime for the serve mode and wait until ready. */
  async start(): Promise<void> {
    if (this.serveMode !== 'server') {
      throw new Error(
        `Fixture.start() currently supports serveMode "server" only (got "${this.serveMode}").`,
      );
    }
    if (this.platform !== 'browser') {
      throw new Error(
        `serveMode "server" currently supports platform "browser" only (got "${this.platform}").`,
      );
    }
    this.server = spawnManaged(NPM, ['run', 'dev'], {
      cwd: this.dir,
      env: this.scriptEnv,
    });
    try {
      await this.waitForPort();
    } catch (err) {
      const reason = this.server.hasExited ? 'server process exited early' : 'port never opened';
      throw new Error(
        `Dev server failed to start (${reason}).\n--- server output ---\n${this.server.output}\n--- end output ---`,
        { cause: err },
      );
    }
  }

  waitForLog(pattern: RegExp, opts: WaitForLogOptions = {}): Promise<void> {
    if (!this.server) throw new Error('No running server; call start() first.');
    return this.server.waitForLog(pattern, opts.timeout);
  }

  waitForPort(timeoutMs = 5_000): Promise<void> {
    return waitForPort(this.port, timeoutMs);
  }

  /** Stop the running server/watcher, if any. */
  async stop(): Promise<void> {
    await this.server?.stop();
    this.server = undefined;
  }

  /** Stop and remove the materialized dir (unless `keepOnDispose`). */
  async dispose(): Promise<void> {
    await this.stop();
    if (!this.keepOnDispose) {
      // Windows may briefly hold handles after tree-kill; retry the removal.
      rmSync(this.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
}
