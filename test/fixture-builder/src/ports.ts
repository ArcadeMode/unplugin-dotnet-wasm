import net from 'node:net';

export function allocatePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address && typeof address === 'object') {
        const { port } = address;
        srv.close(() => resolvePort(port));
      } else {
        srv.close(() => reject(new Error('Failed to allocate an ephemeral port')));
      }
    });
  });
}

export function waitForPort(port: number, timeoutMs = 5_000, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePromise, reject) => {
    let socket: net.Socket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      socket?.destroy();
      if (timer !== undefined) clearTimeout(timer);
      fn();
    };

    const onAbort = (): void => {
      settle(() => reject(new Error(`Aborted waiting for port ${port}`)));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    const attempt = (): void => {
      if (settled) return;
      socket = net.connect(port, 'localhost');
      socket.once('connect', () => {
        settle(() => resolvePromise());
      });
      socket.once('error', () => {
        socket?.destroy();
        socket = undefined;
        if (settled) return;
        if (Date.now() > deadline) {
          settle(() =>
            reject(new Error(`Timed out after ${timeoutMs}ms waiting for port ${port}`)),
          );
        } else {
          timer = setTimeout(attempt, 200);
        }
      });
    };
    attempt();
  });
}

export async function waitForHttp(
  port: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://localhost:${port}/`;
  while (true) {
    if (signal?.aborted) throw new Error(`Aborted waiting for ${url}`);
    try {
      await fetch(url, { signal, redirect: 'manual' });
      return;
    } catch (err) {
      if (signal?.aborted) {
        throw new Error(`Aborted waiting for ${url}`, { cause: err });
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out after ${timeoutMs}ms waiting for ${url}`, { cause: err });
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}
