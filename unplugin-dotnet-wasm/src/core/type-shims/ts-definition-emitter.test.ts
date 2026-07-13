import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NULL_LOGGER, type Logger } from '../logger';
import { TsDefinitionEmitter } from './ts-definition-emitter';

describe('TsDefinitionEmitter.forwardDTS', () => {
  it('returns export statement with posix path for .d.ts', () => {
    const emitter = new TsDefinitionEmitter('/', NULL_LOGGER);
    const result = emitter.forwardDTS('C:\\path\\to\\pkg\\mod.d.ts');
    expect(result).toBe("export * from 'C:/path/to/pkg/mod';\n");
  });

  it('normalizes backslashes to forward slashes in posix path', () => {
    const emitter = new TsDefinitionEmitter('/', NULL_LOGGER);
    const result = emitter.forwardDTS('C:\\deep\\nested\\path\\pkg\\nested\\mod.d.ts');
    expect(result).toBe("export * from 'C:/deep/nested/path/pkg/nested/mod';\n");
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
