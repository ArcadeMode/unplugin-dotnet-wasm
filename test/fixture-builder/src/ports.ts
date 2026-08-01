import net from 'node:net';

/**
 * Allocate a free TCP port by binding to port 0 and reading the assigned port.
 *
 * There is an inherent TOCTOU gap between releasing the probe socket and the
 * server binding it; ephemeral high ports make a collision unlikely, and dev
 * servers are launched with `--strictPort` so a collision fails loudly rather
 * than silently rebinding.
 */
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

/**
 * Resolve once a TCP connection to `localhost:port` succeeds, else reject on
 * timeout. Uses `localhost` (not a fixed `127.0.0.1`) so the probe follows the
 * same IPv4/IPv6 resolution as the dev server bind and the browser `baseUrl`;
 * on Windows `localhost` resolves to `::1` first, where Vite actually listens.
 */
export function waitForPort(port: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePromise, reject) => {
    const attempt = (): void => {
      const socket = net.connect(port, 'localhost');
      socket.once('connect', () => {
        socket.destroy();
        resolvePromise();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Timed out after ${timeoutMs}ms waiting for port ${port}`));
        } else {
          setTimeout(attempt, 200);
        }
      });
    };
    attempt();
  });
}
