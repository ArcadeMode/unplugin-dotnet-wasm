import { rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import sirv from 'sirv';
import { buildLibrary, dotnetConfigFor } from './dotnet';
import {
  snapshotDist,
  waitForDistChange,
  waitForDistReady,
  type DistInventory,
  type WaitForDistOptions,
} from './dist-ready';
import { ManagedProcess, NPM, killPort, runToCompletion, spawnManaged } from './proc';
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
  private readonly rootDir: string;
  private server?: ManagedProcess;
  private nodeRunner?: ManagedProcess;
  private staticServer?: Server;

  constructor(init: FixtureInit) {
    this.dir = init.project.dir;
    this.libraryDir = init.project.libraryDir;
    this.rootDir = init.project.rootDir;
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

  /** Buffered `node --watch` output (node watch mode only). */
  get nodeLogs(): string {
    return this.nodeRunner?.output ?? '';
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

  /**
   * Execute the built node artifact (`node dist/entry.js`) to completion and
   * return its output. Node `dist` serve mode only; the entry prints
   * `INCREMENT:<n>` on stdout for assertions.
   */
  run(): Promise<RunResult> {
    return this.runScript('start');
  }

  /** Snapshot of every file under `dist/` (path → mtime + size). */
  snapshotDist(): DistInventory {
    return snapshotDist(this.distPath);
  }

  /**
   * Wait until `dist/` differs from `baseline` and then stays quiet (rebuild
   * complete). Capture the baseline with {@link snapshotDist} before triggering
   * the library rebuild.
   */
  waitForDistChange(baseline: DistInventory, opts?: WaitForDistOptions): Promise<DistInventory> {
    return waitForDistChange(this.distPath, baseline, opts);
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
    this.server = spawnManaged(NPM, ['run', 'dev'], {
      cwd: this.dir,
      env: this.scriptEnv,
    });
    try {
      // Wait for the pre-allocated port to accept connections (not port
      // allocation). Default 5s is tight when vite + plugin init runs under
      // parallel Playwright workers; 15s covers that without masking hangs.
      await this.waitForPort(15_000);
    } catch (err) {
      const reason = this.server.hasExited ? 'server process exited early' : 'port never opened';
      throw new Error(
        `Dev server failed to start (${reason}).\n--- server output ---\n${this.server.output}\n--- end output ---`,
        { cause: err },
      );
    }
  }

  private async startWatch(): Promise<void> {
    this.server = spawnManaged(NPM, ['run', 'watch'], {
      cwd: this.dir,
      env: this.scriptEnv,
    });
    try {
      await waitForDistReady(this.distPath);
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

    if (this.platform === 'node') {
      this.nodeRunner = spawnManaged(process.execPath, ['--watch', 'dist/entry.js'], {
        cwd: this.dir,
        env: this.scriptEnv,
      });
      try {
        // Wait for the second increment so both baseline markers are present
        // before the test body runs (INCREMENT: matches the first line alone).
        await this.nodeRunner.waitForLog(/INCREMENT:6/, 30_000);
      } catch (err) {
        throw new Error(
          `node --watch failed to print INCREMENT:6.\n--- node output ---\n${this.nodeRunner.output}\n--- end output ---\n--- watcher output ---\n${this.server.output}\n--- end output ---`,
          { cause: err },
        );
      }
      return;
    }

    throw new Error(`Unsupported platform for watch: ${this.platform}`);
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

  /**
   * Wait for a pattern in `node --watch` stdout, optionally ignoring earlier
   * output via `fromIndex` (use `nodeLogs.length` before the rebuild).
   */
  waitForNodeLog(
    pattern: RegExp,
    opts: WaitForLogOptions & { fromIndex?: number } = {},
  ): Promise<void> {
    if (!this.nodeRunner) throw new Error('No node --watch process; call start() in node watch.');
    return this.nodeRunner.waitForLog(pattern, opts.timeout ?? 30_000, opts.fromIndex ?? 0);
  }

  waitForPort(timeoutMs = 5_000): Promise<void> {
    return waitForPort(this.port, timeoutMs);
  }

  /** Stop the running server/watcher, if any. */
  async stop(): Promise<void> {
    await this.nodeRunner?.stop();
    this.nodeRunner = undefined;
    await this.server?.stop();
    this.server = undefined;
    if (this.staticServer) {
      await new Promise<void>((resolvePromise) => this.staticServer!.close(() => resolvePromise()));
      this.staticServer = undefined;
    }
    // The npm.cmd → node → bundler chain can orphan the real process past
    // the wrapper's tree-kill; ensure nothing keeps holding the port (and, via
    // its cwd, the materialized dir) before removal.
    killPort(this.port);
  }

  /** Stop and remove the whole materialized instance (unless `keepOnDispose`). */
  async dispose(): Promise<void> {
    await this.stop();
    if (!this.keepOnDispose) {
      // Remove the instance root (both app/ and Library/). Windows may briefly
      // hold handles after tree-kill; retry the removal.
      rmSync(this.rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
}
