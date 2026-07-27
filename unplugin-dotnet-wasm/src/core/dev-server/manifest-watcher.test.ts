import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Logger } from '../logger';
import { ManifestWatcher } from './manifest-watcher';

const handlers: Record<string, (...args: unknown[]) => void> = {};
const closeMock = vi.fn().mockResolvedValue(undefined);

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        handlers[event] = cb;
      }),
      close: closeMock,
    })),
  },
}));

const nullLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('ManifestWatcher', () => {
  afterEach(() => {
    vi.clearAllMocks();
    Object.keys(handlers).forEach((key) => {
      delete handlers[key];
    });
  });

  it('invoking the captured "all" handler triggers onChange once', async () => {
    const filePath = '/tmp/manifest.json';
    const onChange = vi.fn().mockResolvedValue(undefined);
    const watcher = new ManifestWatcher({
      paths: [filePath],
      onChange,
      logger: nullLogger,
      debounceMs: 50,
    });

    watcher.start();

    // Invoke the captured 'all' handler
    const allHandler = handlers['all'];
    expect(allHandler).toBeDefined();
    allHandler?.();

    // Wait for onChange to execute
    await sleep(100);

    expect(onChange).toHaveBeenCalledTimes(1);

    watcher.dispose();
  });

  it('two rapid "all" invocations while onChange is in-flight coalesce per single-flight rule', async () => {
    const filePath = '/tmp/manifest.json';
    const onChange = vi.fn(async () => {
      await sleep(50); // Simulate async work
    });

    const watcher = new ManifestWatcher({
      paths: [filePath],
      onChange,
      logger: nullLogger,
      debounceMs: 10,
    });

    watcher.start();

    const allHandler = handlers['all'];
    expect(allHandler).toBeDefined();

    // First invocation starts onChange
    allHandler?.();
    await sleep(20); // Let it start

    // Second invocation while onChange is running should set #pending
    allHandler?.();

    // Wait for all processing to complete
    await sleep(200);

    // Should have been called exactly twice:
    // 1. First invocation
    // 2. Second invocation (retry after first completes due to #pending)
    expect(onChange).toHaveBeenCalledTimes(2);
    watcher.dispose();
  });

  it('after dispose(), invoking the "all" handler does NOT call onChange, and close() was called', async () => {
    const filePath = '/tmp/manifest.json';
    const onChange = vi.fn().mockResolvedValue(undefined);
    const watcher = new ManifestWatcher({
      paths: [filePath],
      onChange,
      logger: nullLogger,
      debounceMs: 50,
    });

    watcher.start();

    const allHandler = handlers['all'];
    expect(allHandler).toBeDefined();

    // Dispose the watcher
    watcher.dispose();

    // Verify close() was called
    expect(closeMock).toHaveBeenCalled();

    // Try to trigger a change after dispose
    await sleep(50);
    allHandler?.();

    // Wait to ensure no onChange fires
    await sleep(100);

    expect(onChange).not.toHaveBeenCalled();
  });
});
