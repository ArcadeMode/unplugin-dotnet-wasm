import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { NULL_LOGGER, type Logger } from '../logger';
import { TsDefinitionEmitter, selectTsStrategy } from './ts-definition-emitter';

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
    const inPath =
      platform() === 'win32'
        ? 'C:\\deep\\nested\\path\\pkg\\nested\\mod.d.ts'
        : '/deep/nested/path/pkg/nested/mod.d.ts';
    const outPath =
      platform() === 'win32'
        ? 'C:/deep/nested/path/pkg/nested/mod'
        : '/deep/nested/path/pkg/nested/mod';
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

describe('selectTsStrategy', () => {
  it('selects the in-process strategy for TypeScript 5', () => {
    expect(selectTsStrategy({ version: '5.5.4' }, '/pkg')).toEqual({ kind: 'in-process' });
  });

  it('selects the in-process strategy for TypeScript 6', () => {
    expect(selectTsStrategy({ version: '6.0.0-beta' }, '/pkg')).toEqual({ kind: 'in-process' });
  });

  it('selects the CLI strategy for TypeScript 7 with a bin.tsc entry', () => {
    const selection = selectTsStrategy({ version: '7.0.2', bin: { tsc: './bin/tsc' } }, '/pkg');
    expect(selection).toEqual({ kind: 'cli', tscPath: join('/pkg', './bin/tsc') });
  });

  it('supports a string bin field for the CLI strategy', () => {
    const selection = selectTsStrategy({ version: '7.1.0', bin: './bin/tsc' }, '/pkg');
    expect(selection).toEqual({ kind: 'cli', tscPath: join('/pkg', './bin/tsc') });
  });

  it('is unsupported for TypeScript 7 without a locatable tsc bin', () => {
    expect(selectTsStrategy({ version: '7.0.2' }, '/pkg').kind).toBe('unsupported');
  });

  it('is unsupported for TypeScript older than 5', () => {
    expect(selectTsStrategy({ version: '4.9.5' }, '/pkg').kind).toBe('unsupported');
  });

  it('is unsupported for a missing or unparseable version', () => {
    expect(selectTsStrategy({}, '/pkg').kind).toBe('unsupported');
  });
});
