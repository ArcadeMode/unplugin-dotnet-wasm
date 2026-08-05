import { execa, type ResultPromise } from 'execa';
import type { RunResult } from './types';

export interface LogSink {
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
}

export interface RunProcessOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

export async function runToCompletion(
  command: string,
  args: string[],
  options: RunProcessOptions,
): Promise<RunResult> {
  const result = await execa(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdin: 'ignore',
    all: true,
    timeout: options.timeout,
    forceKillAfterDelay: 1_000,
    reject: false,
  });
  const output = result.all ?? `${result.stdout}${result.stderr}`;
  const mapped: RunResult = {
    exitCode: result.exitCode ?? null,
    stdout: result.stdout,
    stderr: result.stderr,
    output,
  };
  if (result.timedOut) {
    throw new Error(
      `"${command} ${args.join(' ')}" timed out after ${options.timeout}ms\n${output}`,
    );
  }
  if (result.exitCode === 0) return mapped;
  throw new Error(`"${command} ${args.join(' ')}" exited with code ${result.exitCode}\n${output}`);
}

export class ManagedProcess implements LogSink {
  private _stdout = '';
  private _stderr = '';
  private _output = '';
  private readonly echo = process.env.FIXTURE_ECHO_LOGS === '1';
  private readonly waiters: Array<{ re: RegExp; fromIndex: number; resolve: () => void }> = [];
  private exited = false;

  constructor(private readonly subprocess: ResultPromise) {
    subprocess.stdout?.on('data', (chunk: string | Uint8Array) => {
      this.append(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(), 'out');
    });
    subprocess.stderr?.on('data', (chunk: string | Uint8Array) => {
      this.append(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(), 'err');
    });
    void subprocess.then(
      () => {
        this.exited = true;
      },
      () => {
        this.exited = true;
      },
    );
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
    if (this.echo) process.stdout.write(text);
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const waiter = this.waiters[i];
      if (waiter.re.test(this._output.slice(waiter.fromIndex))) {
        waiter.resolve();
        this.waiters.splice(i, 1);
      }
    }
  }

  /** `fromIndex` ignores earlier log content (e.g. detect a restart). */
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
    if (this.exited) return;
    await forceKillTree(this.subprocess);
    await this.subprocess.catch(() => {});
  }
}

/** Force-kill the subprocess and every descendant (watcher grandchildren orphan on win32). */
async function forceKillTree(subprocess: ResultPromise): Promise<void> {
  const { pid } = subprocess;
  if (process.platform === 'win32' && pid !== undefined) {
    await execa('taskkill', ['/PID', String(pid), '/T', '/F'], { reject: false });
  } else {
    subprocess.kill('SIGKILL');
  }
}

export function spawnManaged(
  command: string,
  args: string[],
  options: RunProcessOptions,
): ManagedProcess {
  return new ManagedProcess(
    execa(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdin: 'ignore',
      buffer: false,
      killDescendants: true,
    }),
  );
}
