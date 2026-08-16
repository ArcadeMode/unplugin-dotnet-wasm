import { rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import sirv from 'sirv';
import { buildLibrary, dotnetConfigFor } from './dotnet';
import {
  readDoneSentinel,
  waitForBuildSentinelFiles,
  type WaitForSentinelOptions,
} from './sentinel';
import { ManagedProcess, runToCompletion, spawnManaged } from './proc';
import { allocatePort, waitForPort } from './ports';
import type { MaterializedProject } from './materialize';
import type {
  BuildMode,
  Bundler,
  FixtureKind,
  FixtureProjectName,
  Platform,
  RunResult,
  ServeMode,
  WaitForLogOptions,
} from './types';

const DEV_SERVER_ATTEMPTS = 3;
const DEV_SERVER_PROBE_MS = 30_000;
const STATIC_SERVER_ATTEMPTS = 3;

export interface FixtureInit {
  project: MaterializedProject;
  bundler: Bundler;
  platform: Platform;
  serveMode: ServeMode;
  buildMode: BuildMode;
  kind: FixtureKind;
  projectName: FixtureProjectName;
  keepOnDispose: boolean;
}

export class Fixture {
  readonly dir: string;
  readonly libraryDir: string;
  readonly bundler: Bundler;
  readonly platform: Platform;
  readonly serveMode: ServeMode;
  readonly buildMode: BuildMode;
  readonly kind: FixtureKind;
  readonly projectName: FixtureProjectName;
  port: number;

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
    this.kind = init.kind;
    this.projectName = init.projectName;
    this.port = 0;
    this.keepOnDispose = init.keepOnDispose;
  }

  get baseUrl(): string {
    return `http://localhost:${this.port}`;
  }

  get distPath(): string {
    return join(this.dir, 'dist');
  }

  private get scriptEnv(): NodeJS.ProcessEnv {
    const { configuration, isPublish } = dotnetConfigFor(this.buildMode);
    return {
      ...process.env,
      DOTNET_PROJECT_ROOT: this.libraryDir,
      DOTNET_PROJECT_NAME: this.projectName,
      DOTNET_CONFIGURATION: configuration,
      DOTNET_IS_PUBLISH: String(isPublish),
      DOTNET_FIXTURE_PLATFORM: this.platform,
    };
  }

  get logs(): string {
    return this.server?.output ?? '';
  }

  async buildLibrary(opts: { fingerprint?: boolean; altered?: boolean } = {}): Promise<void> {
    await buildLibrary({
      libraryDir: this.libraryDir,
      projectName: this.projectName,
      buildMode: this.buildMode,
      fingerprint: opts.fingerprint ?? true,
      altered: opts.altered ?? false,
    });
  }

  runScript(name: string): Promise<RunResult> {
    return runToCompletion('npm', ['run', name], {
      cwd: this.dir,
      env: this.scriptEnv,
    });
  }

  build(): Promise<RunResult> {
    return this.runScript('build');
  }

  run(): Promise<RunResult> {
    return this.runScript('start');
  }

  rebuildToken(): string | null {
    return readDoneSentinel(this.dir);
  }

  async waitForRebuild(baseline: string | null, opts?: WaitForSentinelOptions): Promise<string> {
    try {
      return await waitForBuildSentinelFiles(this.dir, baseline, opts);
    } catch (err) {
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}\n--- watcher output ---\n${this.logs || '(none)'}\n--- end output ---`,
        { cause: err },
      );
    }
  }

  async serve(): Promise<void> {
    if (this.serveMode !== 'dist') {
      throw new Error(`Fixture.serve() supports serveMode "dist" only (got "${this.serveMode}").`);
    }
    if (this.platform !== 'browser') {
      throw new Error(`Fixture.serve() supports platform "browser" only (got "${this.platform}").`);
    }
    await this.startStaticServer();
  }

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

    for (let attempt = 1; attempt <= DEV_SERVER_ATTEMPTS; attempt++) {
      const port = await allocatePort();
      this.server = spawnManaged('npm', ['run', 'dev', '--', '--port', String(port)], {
        cwd: this.dir,
        env: { ...this.scriptEnv, PORT: String(port) },
      });

      const ac = new AbortController();
      void this.server.whenExited().then(() => ac.abort());

      try {
        await waitForPort(port, DEV_SERVER_PROBE_MS, ac.signal);
        if (this.server.hasExited) {
          throw new Error('server process exited early');
        }
        this.port = port;
        return;
      } catch (err) {
        const output = this.server.output;
        const exitedEarly = this.server.hasExited;
        await this.server.stop();
        this.server = undefined;
        ac.abort();

        // Live process + probe timeout: still booting or hung. Do not retry.
        if (!exitedEarly || attempt === DEV_SERVER_ATTEMPTS) {
          const reason = exitedEarly ? 'server process exited early' : 'port never opened';
          throw new Error(
            `Dev server failed to start (${reason}) after ${attempt} attempt(s).\n--- server output ---\n${output}\n--- end output ---`,
            { cause: err },
          );
        }
      }
    }

    throw new Error('Dev server failed to start.');
  }

  private async startWatch(): Promise<void> {
    this.server = spawnManaged('npm', ['run', 'watch'], {
      cwd: this.dir,
      env: this.scriptEnv,
    });
    try {
      await waitForBuildSentinelFiles(this.dir, null);
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

    for (let attempt = 1; attempt <= STATIC_SERVER_ATTEMPTS; attempt++) {
      const port = await allocatePort();
      this.staticServer = createServer((req, res) => handler(req, res));
      try {
        await new Promise<void>((resolvePromise, reject) => {
          this.staticServer!.once('error', reject);
          this.staticServer!.listen(port, resolvePromise);
        });
        this.port = port;
        return;
      } catch (err) {
        const server = this.staticServer;
        this.staticServer = undefined;
        if (server) {
          await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
        }
        const inUse =
          err !== null &&
          typeof err === 'object' &&
          'code' in err &&
          (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
        if (!inUse || attempt === STATIC_SERVER_ATTEMPTS) {
          throw err;
        }
      }
    }

    throw new Error('Static server failed to start.');
  }

  waitForLog(pattern: RegExp, opts: WaitForLogOptions = {}): Promise<void> {
    if (!this.server) throw new Error('No running server; call start() first.');
    return this.server.waitForLog(pattern, opts.timeout);
  }

  async stop(): Promise<void> {
    await this.server?.stop();
    this.server = undefined;
    if (this.staticServer) {
      await new Promise<void>((resolvePromise) => this.staticServer!.close(() => resolvePromise()));
      this.staticServer = undefined;
    }
  }

  async dispose(): Promise<void> {
    await this.stop();
    if (this.keepOnDispose) return;
    try {
      rmSync(this.rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (err) {
      console.warn(
        `[fixture] could not remove ${this.rootDir}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
