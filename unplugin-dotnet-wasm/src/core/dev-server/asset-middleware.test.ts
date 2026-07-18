import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, vi } from 'vitest';
import type { AssetResolver } from '../asset-resolution/asset-resolver';
import type { Logger } from '../logger';
import { createAssetMiddleware } from './asset-middleware';

interface FakeReq {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  headersSent: boolean;
  setHeader(name: string, value: string): void;
  getHeader(name: string): string | string[] | number | undefined;
  removeHeader(name: string): void;
  end(): void;
}

function createFakeRes(): FakeRes {
  const headers: Record<string, string> = {};
  let headersSent = false;

  const res: FakeRes = {
    statusCode: 200,
    headers,
    headersSent,
    setHeader(name: string, value: string): void {
      headers[name] = value;
    },
    getHeader(name: string): string | string[] | number | undefined {
      return headers[name];
    },
    removeHeader(name: string): void {
      delete headers[name];
    },
    end(): void {
      headersSent = true;
    },
  };

  return res;
}

function createTempFile(content: Buffer | string): string {
  const filename = join(
    tmpdir(),
    `dotnet-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  );
  const data = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
  writeFileSync(filename, data);
  return filename;
}

const nullLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

/**
 * A response backed by a real writable stream so `stream.pipe(res)` actually
 * flows - lets us assert the streamed body bytes, not just the headers.
 */
function createStreamingRes(): {
  res: FakeRes & PassThrough;
  body: () => Promise<Buffer>;
} {
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on('data', (c) => chunks.push(Buffer.from(c)));
  const headers: Record<string, string> = {};
  const res = Object.assign(sink, {
    statusCode: 200,
    headers,
    headersSent: false,
    setHeader(name: string, value: string): void {
      headers[name] = value;
    },
    getHeader(name: string): string | string[] | number | undefined {
      return headers[name];
    },
    removeHeader(name: string): void {
      delete headers[name];
    },
  }) as FakeRes & PassThrough;
  const body = () =>
    new Promise<Buffer>((resolve) => sink.on('end', () => resolve(Buffer.concat(chunks))));
  return { res, body };
}

describe('createAssetMiddleware', () => {
  it('passes through non-GET/HEAD requests', async () => {
    const resolver: Partial<AssetResolver> = {
      resolve: vi.fn(() => null),
    };
    const middleware = createAssetMiddleware(resolver as AssetResolver, nullLogger);
    const next = vi.fn();
    const req: FakeReq = { method: 'POST', url: '/_framework/foo.wasm', headers: {} };
    const res = createFakeRes();

    middleware(req as unknown as IncomingMessage, res as unknown as ServerResponse, next);

    expect(next).toHaveBeenCalled();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('passes through unknown routes', () => {
    const resolver: Partial<AssetResolver> = {
      resolve: vi.fn(() => null),
      headersFor: vi.fn(() => undefined),
    };
    const middleware = createAssetMiddleware(resolver as AssetResolver, nullLogger);
    const next = vi.fn();
    const req: FakeReq = { method: 'GET', url: '/_framework/foo.wasm', headers: {} };
    const res = createFakeRes();

    middleware(req as unknown as IncomingMessage, res as unknown as ServerResponse, next);

    expect(next).toHaveBeenCalled();
  });

  it('passes through _framework/dotnet.js without calling resolve', () => {
    const resolver: Partial<AssetResolver> = {
      resolve: vi.fn(() => null),
    };
    const middleware = createAssetMiddleware(resolver as AssetResolver, nullLogger);
    const next = vi.fn();
    const req: FakeReq = { method: 'GET', url: '/_framework/dotnet.js', headers: {} };
    const res = createFakeRes();

    middleware(req as unknown as IncomingMessage, res as unknown as ServerResponse, next);

    expect(next).toHaveBeenCalled();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('304 on matching If-None-Match', () => {
    const tempFile = createTempFile(Buffer.from([0x00, 0x61, 0x73, 0x6d]));

    const resolver: Partial<AssetResolver> = {
      resolve: vi.fn(() => tempFile),
      headersFor: vi.fn(() => [{ Name: 'ETag', Value: '"abc123"' }]),
    };
    const middleware = createAssetMiddleware(resolver as AssetResolver, nullLogger);
    const next = vi.fn();
    const req: FakeReq = {
      method: 'GET',
      url: '/_framework/foo.wasm',
      headers: { 'if-none-match': '"abc123"' },
    };
    const res = createFakeRes();
    const endSpy = vi.spyOn(res, 'end');

    middleware(req as unknown as IncomingMessage, res as unknown as ServerResponse, next);

    expect(res.statusCode).toBe(304);
    expect(res.getHeader('Content-Length')).toBeUndefined();
    expect(endSpy).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('GET streams the file body with manifest headers, real size wins over manifest Content-Length', async () => {
    const bytes = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x02, 0x03]);
    const tempFile = createTempFile(bytes);

    const resolver: Partial<AssetResolver> = {
      resolve: vi.fn(() => tempFile),
      headersFor: vi.fn(() => [
        { Name: 'Content-Type', Value: 'application/wasm' },
        { Name: 'Cache-Control', Value: 'immutable' },
        // Stale/compressed value from the manifest - must be ignored.
        { Name: 'Content-Length', Value: '999' },
      ]),
    };
    const middleware = createAssetMiddleware(resolver as AssetResolver, nullLogger);
    const next = vi.fn();
    const req: FakeReq = { method: 'GET', url: '/_framework/foo.wasm', headers: {} };
    const { res, body } = createStreamingRes();

    middleware(req as unknown as IncomingMessage, res as unknown as ServerResponse, next);
    const received = await body();

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/wasm');
    expect(res.headers['Cache-Control']).toBe('immutable');
    expect(res.headers['Content-Length']).toBe(String(bytes.length));
    expect(received.equals(bytes)).toBe(true);
  });

  it('HEAD method returns headers without body', () => {
    const tempFile = createTempFile(Buffer.from([0x00, 0x61, 0x73, 0x6d]));

    const resolver: Partial<AssetResolver> = {
      resolve: vi.fn(() => tempFile),
      headersFor: vi.fn(() => [{ Name: 'Content-Type', Value: 'application/wasm' }]),
    };
    const middleware = createAssetMiddleware(resolver as AssetResolver, nullLogger);
    const next = vi.fn();
    const req: FakeReq = { method: 'HEAD', url: '/_framework/foo.wasm', headers: {} };
    const res = createFakeRes();
    const endSpy = vi.spyOn(res, 'end');

    middleware(req as unknown as IncomingMessage, res as unknown as ServerResponse, next);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/wasm');
    expect(res.headers['Content-Length']).toBe('4');
    expect(endSpy).toHaveBeenCalled();
  });
});
