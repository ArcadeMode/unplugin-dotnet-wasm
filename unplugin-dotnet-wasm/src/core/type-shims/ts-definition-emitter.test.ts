import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NULL_LOGGER, type Logger } from '../logger';
import { TsDefinitionEmitter } from './ts-definition-emitter';
import { TypeEntry } from './type-entry';

describe('TsDefinitionEmitter.emit', () => {
  describe('with dts entry', () => {
    it('returns export statement with posix path', () => {
      const emitter = new TsDefinitionEmitter('/', NULL_LOGGER);
      const entry = new TypeEntry(
        'pkg/mod.d.ts',
        'C:\\path\\to\\pkg\\mod.d.ts',
        'dts',
      );

      const result = emitter.emit(entry);

      expect(result).toBe("export * from 'C:/path/to/pkg/mod';\n");
    });

    it('normalizes backslashes to forward slashes in posix path', () => {
      const emitter = new TsDefinitionEmitter('/', NULL_LOGGER);
      const entry = new TypeEntry(
        'pkg/nested/mod.d.ts',
        'C:\\deep\\nested\\path\\pkg\\nested\\mod.d.ts',
        'dts',
      );

      const result = emitter.emit(entry);

      expect(result).toBe("export * from 'C:/deep/nested/path/pkg/nested/mod';\n");
    });
  });

  describe('with ts entry (no TypeScript)', () => {
    it('returns null and warns when TypeScript is unavailable', () => {
      const logger: Logger = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      };

      // Create a temp directory with no node_modules/typescript
      const emptyRoot = mkdtempSync(join(tmpdir(), 'no-ts-'));
      const emitter = new TsDefinitionEmitter(emptyRoot, logger);
      const entry = new TypeEntry('pkg/mod.ts', '/path/to/pkg/mod.ts', 'ts');
      const result = emitter.emit(entry);

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it('caches unavailable state and only warns once', () => {
      const logger: Logger = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      };

      const emptyRoot = mkdtempSync(join(tmpdir(), 'no-ts-'));
      const emitter = new TsDefinitionEmitter(emptyRoot, logger);
      const entry1 = new TypeEntry('pkg/mod1.ts', '/path/to/pkg/mod1.ts', 'ts');
      const entry2 = new TypeEntry('pkg/mod2.ts', '/path/to/pkg/mod2.ts', 'ts');

      const result1 = emitter.emit(entry1);
      const result2 = emitter.emit(entry2);

      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(logger.warn).toHaveBeenCalledOnce();
    });
  });
});
