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
