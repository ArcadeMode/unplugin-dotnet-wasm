import { rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import sirv from 'sirv';
import { buildLibrary, dotnetConfigFor } from './dotnet';
import { readSentinel, waitForSentinel, type WaitForSentinelOptions } from './sentinel';
import { ManagedProcess, runToCompletion, spawnManaged } from './proc';
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
  readonly port: number;

  private readonly keepOnDispose: boolean;
  private readonly rootDir: string;
  private server?: ManagedProcess;
  private staticServer?: Server;

  constructor(init: FixtureInit) {
    this.dir = init.project.dir;
    this.libraryDir = init.project.libraryDir;
    this.rootDir = init.project.rootDir;
    this.bundler = init.bundler;
    this.platform = init.platform;
    this.serveMode = init.serveMode;
    this.buildMode = init.buildMode;
    this.port = init.port;
    this.keepOnDispose = init.keepOnDispose;
  }

  get baseUrl(): string {
    return `http://localhost:${this.port}`;
  }

  get distPath(): string {
    return join(this.dir, 'dist');
  }

  /** Env passed to every bundler script: locates the Library, selects config. */
  private get scriptEnv(): NodeJS.ProcessEnv {
    const { configuration, isPublish } = dotnetConfigFor(this.buildMode);
    return {
      ...process.env,
      DOTNET_PROJECT_ROOT: this.libraryDir,
      DOTNET_CONFIGURATION: configuration,
      DOTNET_IS_PUBLISH: String(isPublish),
      DOTNET_FIXTURE_PLATFORM: this.platform,
    };
  }

  /** Buffered bundler watcher / dev-server output (empty until `start()`). */
  get logs(): string {
    return this.server?.output ?? '';
  }

  /**
   * (Re)build the isolated Library. `fingerprint` maps to
   * `-p:WasmFingerprintAssets` (default `true`, SDK default). Passing
   * `altered: true` is the change trigger for the change test.
   */
  async buildLibrary(opts: { fingerprint?: boolean; altered?: boolean } = {}): Promise<void> {
    await buildLibrary({
      libraryDir: this.libraryDir,
      buildMode: this.buildMode,
      fingerprint: opts.fingerprint ?? true,
      altered: opts.altered ?? false,
    });
  }

  /** Run an npm script from the generated `package.json` to completion. */
  runScript(name: string): Promise<RunResult> {
    return runToCompletion('npm', ['run', name], {
      cwd: this.dir,
      env: this.scriptEnv,
    });
  }

  /** One-shot `build` script → `dist/`. */
  build(): Promise<RunResult> {
    return this.runScript('build');
  }

  /**
   * Execute the built node artifact (`node dist/entry.js`) to completion and
   * return its output. Node `dist` serve mode only; the entry prints
   * `INCREMENT:<n>` on stdout for assertions.
   */
  run(): Promise<RunResult> {
    return this.runScript('start');
  }

  /** Current build-done token from the bundler sentinel (`null` before first emit). */
  rebuildToken(): string | null {
    return readSentinel(this.dir);
  }

  /**
   * Wait until the bundler emits a new build-done token (rebuild complete) and
   * it settles. Capture the baseline with {@link rebuildToken} before triggering
   * the library rebuild.
   */
  async waitForRebuild(baseline: string | null, opts?: WaitForSentinelOptions): Promise<string> {
    try {
      return await waitForSentinel(this.dir, baseline, opts);
    } catch (err) {
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}\n--- watcher output ---\n${this.logs || '(none)'}\n--- end output ---`,
        { cause: err },
      );
    }
  }

  /**
   * Serve the built `dist/` statically on the allocated port (browser `dist`
   * serve mode). Runs in-process so teardown is a clean `server.close()` — no
   * child process to orphan. Call {@link build} first; after an altered rebuild,
   * rebuild and `page.reload()` to pick up the new bundle.
   */
  async serve(): Promise<void> {
    if (this.serveMode !== 'dist') {
      throw new Error(`Fixture.serve() supports serveMode "dist" only (got "${this.serveMode}").`);
    }
    if (this.platform !== 'browser') {
      throw new Error(`Fixture.serve() supports platform "browser" only (got "${this.platform}").`);
    }
    await this.startStaticServer();
  }

  /** Start the long-running runtime for the serve mode and wait until ready. */
  async start(): Promise<void> {
    if (this.serveMode === 'server') {
      await this.startDevServer();
      return;
    }
    if (this.serveMode === 'watch') {
      await this.startWatch();
      return;
    }
    throw new Error(
      `Fixture.start() supports serveMode "server" or "watch" (got "${this.serveMode}").`,
    );
  }

  private async startDevServer(): Promise<void> {
    if (this.platform !== 'browser') {
      throw new Error(
        `Fixture.start() for serveMode "server" supports platform "browser" only ` +
          `(got "${this.platform}"). For vite node server (Vitest SSR), use runScript("dev").`,
      );
    }
    this.server = spawnManaged('npm', ['run', 'dev'], {
      cwd: this.dir,
      env: this.scriptEnv,
    });
    try {
      await waitForPort(this.port, 15_000);
    } catch (err) {
      const reason = this.server.hasExited ? 'server process exited early' : 'port never opened';
      throw new Error(
        `Dev server failed to start (${reason}).\n--- server output ---\n${this.server.output}\n--- end output ---`,
        { cause: err },
      );
    }
  }

  private async startWatch(): Promise<void> {
    this.server = spawnManaged('npm', ['run', 'watch'], {
      cwd: this.dir,
      env: this.scriptEnv,
    });
    try {
      await waitForSentinel(this.dir, null);
    } catch (err) {
      const reason = this.server.hasExited ? 'watcher process exited early' : 'dist never settled';
      throw new Error(
        `Watch build failed to produce dist/ (${reason}).\n--- watcher output ---\n${this.server.output}\n--- end output ---`,
        { cause: err },
      );
    }

    if (this.platform === 'browser') {
      await this.startStaticServer();
      return;
    }
    if (this.platform === 'node') return;
    throw new Error(`Unsupported platform for watch: ${this.platform}`);
  }

  /** Run `node dist/entry.js` once and wait until it exits. */
  async runNode(opts: { timeout?: number } = {}): Promise<RunResult> {
    try {
      return await runToCompletion(process.execPath, ['dist/entry.js'], {
        cwd: this.dir,
        env: this.scriptEnv,
        timeout: opts.timeout ?? 30_000,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `node dist/entry.js failed.\n${detail}\n--- watcher output ---\n${this.server?.output ?? ''}\n--- end output ---`,
        { cause: err },
      );
    }
  }

  private async startStaticServer(): Promise<void> {
    const handler = sirv(this.distPath, { dev: true, single: true });
    this.staticServer = createServer((req, res) => handler(req, res));
    await new Promise<void>((resolvePromise, reject) => {
      this.staticServer!.once('error', reject);
      this.staticServer!.listen(this.port, resolvePromise);
    });
  }

  waitForLog(pattern: RegExp, opts: WaitForLogOptions = {}): Promise<void> {
    if (!this.server) throw new Error('No running server; call start() first.');
    return this.server.waitForLog(pattern, opts.timeout);
  }

  /** Stop the running server/watcher, if any. */
  async stop(): Promise<void> {
    await this.server?.stop();
    this.server = undefined;
    if (this.staticServer) {
      await new Promise<void>((resolvePromise) => this.staticServer!.close(() => resolvePromise()));
      this.staticServer = undefined;
    }
  }

  /** Stop and remove the whole materialized instance (unless `keepOnDispose`). */
  async dispose(): Promise<void> {
    await this.stop();
    if (!this.keepOnDispose) {
      rmSync(this.rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
}
