import { describe, it, expect, vi } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { TsDefinitionEmitter } from './ts-definition-emitter';
import type { Logger } from '../logger';

function createMockLogger(): Logger {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

describe('TsDefinitionEmitter', () => {
  it('emits a declaration for a real .ts source when typescript resolves', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'emitter-'));
    const tsFile = join(tempDir, 'example.ts');
    // A simple TS file that should produce a declaration.
    await writeFile(tsFile, 'export function greet(name: string): string { return `Hello, ${name}`; }');

    const logger = createMockLogger();
    // Use the current working directory (the package dir) as root, where typescript should resolve.
    const emitter = new TsDefinitionEmitter({ root: process.cwd(), logger });

    const result = emitter.emit(tsFile);

    expect(result).not.toBeNull();
    expect(result).toContain('declare function greet');
    expect(result).toContain('string');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns null and warns once when typescript is not resolvable', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'emitter-no-ts-'));
    const tsFile = join(tempDir, 'example.ts');

    const logger = createMockLogger();
    // Use an isolated temp dir that has no typescript.
    const emitter = new TsDefinitionEmitter({ root: tempDir, logger });

    const first = emitter.emit(tsFile);
    expect(first).toBeNull();

    const warnCalls = (logger.warn as any).mock.calls;
    expect(warnCalls.length).toBe(1);
    expect(warnCalls[0][0]).toContain('typescript not resolvable from the consumer root');

    // Second call should return null without warning again.
    const second = emitter.emit(tsFile);
    expect(second).toBeNull();
    expect(warnCalls.length).toBe(1); // Still only one warning.
  });

  it('emits a minimal declaration for files with no exportable content', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'emitter-empty-'));
    const tsFile = join(tempDir, 'empty.ts');
    // A TS file with only comments produces minimal (empty) declaration content.
    await writeFile(tsFile, '// This is just a comment\n// with no exports\n');

    const logger = createMockLogger();
    const emitter = new TsDefinitionEmitter({ root: process.cwd(), logger });

    const result = emitter.emit(tsFile);

    // TypeScript emits an empty declaration file (not undefined), so we get an empty string.
    expect(typeof result).toBe('string');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('handles multiple ts files independently when typescript resolves', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'emitter-multi-'));
    const tsFile1 = join(tempDir, 'file1.ts');
    const tsFile2 = join(tempDir, 'file2.ts');
    await writeFile(tsFile1, 'export interface User { name: string; }');
    await writeFile(tsFile2, 'export type Status = "active" | "inactive";');

    const logger = createMockLogger();
    const emitter = new TsDefinitionEmitter({ root: process.cwd(), logger });

    const result1 = emitter.emit(tsFile1);
    const result2 = emitter.emit(tsFile2);

    expect(result1).not.toBeNull();
    expect(result1).toContain('User');
    expect(result2).not.toBeNull();
    expect(result2).toContain('Status');
  });
});
