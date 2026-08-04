import chokidar, { type FSWatcher } from 'chokidar';
import type { Logger } from '../logger';

export interface ManifestWatcherOptions {
  paths: string[];
  onChange: () => void | Promise<void>;
  logger: Logger;
  debounceMs?: number;
}

export class ManifestWatcher {
  readonly #paths: string[];
  readonly #onChange: () => void | Promise<void>;
  readonly #logger: Logger;
  readonly #debounceMs: number;
  #watcher: FSWatcher | null = null;
  #running = false;
  #pending = false;
  #disposed = false;

  constructor(opts: ManifestWatcherOptions) {
    this.#paths = opts.paths;
    this.#onChange = opts.onChange;
    this.#logger = opts.logger;
    this.#debounceMs = opts.debounceMs ?? 100;
  }

  start(): void {
    if (this.#disposed) return;
    this.#logger.debug(
      `ManifestWatcher start: ${this.#paths.length} path(s), debounceMs=${this.#debounceMs}` +
        (this.#paths.length ? `\n  ${this.#paths.join('\n  ')}` : ' (none)'),
    );
    this.#watcher = chokidar.watch(this.#paths, {
      ignoreInitial: true,
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: this.#debounceMs, pollInterval: 20 },
    });
    this.#watcher.on('all', (event, path) => {
      this.#logger.debug(`ManifestWatcher event: ${event} ${path}`);
      void this.#run();
    });
    this.#watcher.on('error', (err) =>
      this.#logger.error(
        `manifest watcher error: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  async #run(): Promise<void> {
    if (this.#disposed || this.#running) {
      this.#pending = true;
      this.#logger.debug('ManifestWatcher onChange coalesced (already running)');
      return;
    }

    this.#running = true;
    this.#pending = false;

    try {
      this.#logger.debug('ManifestWatcher onChange begin');
      await this.#onChange();
      this.#logger.debug('ManifestWatcher onChange end');
    } catch (err) {
      this.#logger.error(
        `manifest onChange handler failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.#running = false;

    if (this.#pending && !this.#disposed) {
      this.#pending = false;
      this.#logger.debug('ManifestWatcher onChange re-run (pending)');
      void this.#run();
    }
  }

  dispose(): void {
    this.#disposed = true;
    void this.#watcher?.close().catch(() => {});
    this.#watcher = null;
  }
}
