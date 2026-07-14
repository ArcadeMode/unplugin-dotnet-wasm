import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { NULL_LOGGER, type Logger } from '../logger';
import { TsDefinitionEmitter } from './ts-definition-emitter';

describe('TsDefinitionEmitter.forwardDTS', () => {
  it('returns export statement with posix path for .d.ts', () => {
    const emitter = new TsDefinitionEmitter('/', NULL_LOGGER);
    const inPath = platform() === 'win32' ? 'C:\\path\\to\\pkg\\mod.d.ts' : '/path/to/pkg/mod.d.ts';
    const outPath = platform() === 'win32' ? 'C:/path/to/pkg/mod' : '/path/to/pkg/mod';
    const result = emitter.forwardDTS(inPath);
    expect(result).toBe(`export * from '${outPath}';\n`);
  });

  it('normalizes backslashes to forward slashes in posix path', () => {
    const emitter = new TsDefinitionEmitter('/', NULL_LOGGER);
    const inPath = platform() === 'win32' ? 'C:\\deep\\nested\\path\\pkg\\nested\\mod.d.ts' : '/deep/nested/path/pkg/nested/mod.d.ts';
    const outPath = platform() === 'win32' ? 'C:/deep/nested/path/pkg/nested/mod' : '/deep/nested/path/pkg/nested/mod';
    const result = emitter.forwardDTS(inPath);
    expect(result).toBe(`export * from '${outPath}';\n`);
  });
});

describe('TsDefinitionEmitter.compileToDTS', () => {
  it('returns null and warns once when TypeScript is unavailable', () => {
    const logger: Logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    const emptyRoot = mkdtempSync(join(tmpdir(), 'no-ts-'));
    const emitter = new TsDefinitionEmitter(emptyRoot, logger);
    const result = emitter.compileToDTS('/path/to/pkg/mod.ts');
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('caches unavailable state and only warns once on repeated calls', () => {
    const logger: Logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    const emptyRoot = mkdtempSync(join(tmpdir(), 'no-ts-'));
    const emitter = new TsDefinitionEmitter(emptyRoot, logger);
    const result1 = emitter.compileToDTS('/path/to/pkg/mod1.ts');
    const result2 = emitter.compileToDTS('/path/to/pkg/mod2.ts');
    expect(result1).toBeNull();
    expect(result2).toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
