import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { RunResult } from './types';

/** `npm` executable name for the current platform. */
export const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * Best-effort kill of whatever process is listening on `port`.
 *
 * The dev server is launched via `npm run dev`, so the real bundler process is
 * a grandchild of the spawned `npm.cmd` wrapper. On Windows that chain can
 * orphan the bundler past a wrapper tree-kill, leaving it alive with its cwd
 * inside the materialized dir (which then blocks removal). Killing by port
 * reliably targets the actual server regardless of a broken parent-PID chain.
 */
export function killPort(port: number): void {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
      const pids = new Set<string>();
      for (const line of out.split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/);
        // Columns: TCP  <local>  <foreign>  LISTENING  <pid>
        if (cols.length >= 5 && cols[0] === 'TCP' && cols[3] === 'LISTENING') {
          if (cols[1].endsWith(`:${port}`)) pids.add(cols[4]);
        }
      }
      for (const pid of pids) {
        try {
          execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
        } catch {
          /* already gone */
        }
      }
    } else {
      try {
        const out = execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' });
        for (const pid of out.split(/\s+/).filter(Boolean)) {
          try {
            process.kill(Number(pid), 'SIGKILL');
          } catch {
            /* already gone */
          }
        }
      } catch {
        /* lsof missing or nothing listening */
      }
    }
  } catch {
    /* best effort — teardown must not throw */
  }
}

/** Accumulates stdout/stderr from a child process. */
export interface LogSink {
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
}

export interface RunProcessOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Spawn a process and resolve when it exits. Rejects on nonzero exit with the
 * captured output attached to the error message.
 */
export function runToCompletion(
  command: string,
  args: string[],
  options: RunProcessOptions,
): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, spawnOptions(options));
    let stdout = '';
    let stderr = '';
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      output += text;
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      output += text;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      const result: RunResult = { exitCode: code, stdout, stderr, output };
      if (code === 0) {
        resolvePromise(result);
      } else {
        reject(new Error(`"${command} ${args.join(' ')}" exited with code ${code}\n${output}`));
      }
    });
  });
}

/** A long-running child (dev server / watcher) with buffered logs. */
export class ManagedProcess implements LogSink {
  private _stdout = '';
  private _stderr = '';
  private _output = '';
  private readonly waiters: Array<{ re: RegExp; fromIndex: number; resolve: () => void }> = [];
  private exited = false;

  constructor(private readonly child: ChildProcess) {
    child.stdout?.on('data', (chunk: Buffer) => this.append(chunk.toString(), 'out'));
    child.stderr?.on('data', (chunk: Buffer) => this.append(chunk.toString(), 'err'));
    // Use 'exit' (not 'close') for liveness: with `shell: true` on Windows the
    // grandchild (node/vite) can keep the stdio pipes open after the wrapper
    // dies, so 'close' may never fire.
    child.once('exit', () => {
      this.exited = true;
    });
  }

  get stdout(): string {
    return this._stdout;
  }
  get stderr(): string {
    return this._stderr;
  }
  get output(): string {
    return this._output;
  }
  get hasExited(): boolean {
    return this.exited;
  }

  private append(text: string, stream: 'out' | 'err'): void {
    if (stream === 'out') this._stdout += text;
    else this._stderr += text;
    this._output += text;
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const waiter = this.waiters[i];
      if (waiter.re.test(this._output.slice(waiter.fromIndex))) {
        waiter.resolve();
        this.waiters.splice(i, 1);
      }
    }
  }

  /**
   * Wait until `pattern` matches process output. Pass `fromIndex` to ignore
   * earlier log content (e.g. detect a `node --watch` restart).
   */
  waitForLog(pattern: RegExp, timeoutMs = 5_000, fromIndex = 0): Promise<void> {
    if (pattern.test(this._output.slice(fromIndex))) return Promise.resolve();
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Timed out after ${timeoutMs}ms waiting for ${pattern} in process output` +
              ` (fromIndex=${fromIndex}):\n${this._output.slice(fromIndex)}`,
          ),
        );
      }, timeoutMs);
      this.waiters.push({
        re: pattern,
        fromIndex,
        resolve: () => {
          clearTimeout(timer);
          resolvePromise();
        },
      });
    });
  }

  async stop(): Promise<void> {
    if (this.exited || this.child.pid === undefined) return;
    const pid = this.child.pid;
    await new Promise<void>((resolvePromise) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        resolvePromise();
      };
      this.child.once('exit', done);
      if (process.platform === 'win32') {
        // `shell: true` means `this.child` is the cmd.exe wrapper; SIGTERM would
        // orphan the real node/vite grandchild, which keeps holding file locks
        // on the materialized dir. taskkill /T tears down the whole tree.
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
        });
        killer.once('exit', done);
        killer.once('error', done);
      } else {
        this.child.kill('SIGTERM');
        // Fallback hard-kill if the process ignores SIGTERM.
        setTimeout(() => {
          if (!this.exited) this.child.kill('SIGKILL');
        }, 5_000).unref();
      }
    });
  }
}

export function spawnManaged(
  command: string,
  args: string[],
  options: RunProcessOptions,
): ManagedProcess {
  return new ManagedProcess(spawn(command, args, spawnOptions(options)));
}

function spawnOptions(options: RunProcessOptions): SpawnOptions {
  return {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // npm.cmd on Windows requires a shell; args here are internal constants.
    shell: process.platform === 'win32',
  };
}
