import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AssetResolver } from '../asset-resolution/asset-resolver';
import type { Logger } from '../logger';
import { FRAMEWORK_JS_REGEX } from '../constants';

export type NextFn = (err?: unknown) => void;
export type ConnectMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: NextFn,
) => void;

export function createAssetMiddleware(
  resolver: AssetResolver,
  logger: Logger,
): ConnectMiddleware {
  return function dotnetAssetMiddleware(req: IncomingMessage, res: ServerResponse, next: NextFn) {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') return next();

    const url = req.url;
    if (typeof url !== 'string') return next();
    const pathname = url.split('?')[0]!.split('#')[0]!;

    // Runtime JS modules must reach the bundler transform, not us.
    if (FRAMEWORK_JS_REGEX.test(pathname)) return next();

    const physicalPath = resolver.resolve(pathname);
    if (physicalPath === null) return next();

    let size: number;
    try {
      const stat = statSync(physicalPath);
      if (stat.isDirectory()) return next();
      size = stat.size;
    } catch {
      return next();
    }

    for (const header of resolver.headersFor(pathname) ?? []) {
      res.setHeader(header.Name, header.Value);
    }
    res.setHeader('Content-Length', String(size)); // ensure matching actual file

    // Conditional request: 304 when the ETag matches.
    const etag = res.getHeader('ETag');
    const ifNoneMatch = req.headers['if-none-match'];
    if (typeof etag === 'string' && ifNoneMatch === etag) {
      res.statusCode = 304;
      res.end();
      return;
    }

    res.statusCode = 200;
    if (method === 'HEAD') {
      res.end();
      return;
    }

    logger.debug(`serving ${pathname} from ${physicalPath}`);
    const stream = createReadStream(physicalPath);
    stream.on('error', err => {
      logger.error(`failed streaming ${physicalPath}: ${(err as Error).message}`);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
    stream.pipe(res);
  };
}
