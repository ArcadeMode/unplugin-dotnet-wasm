import { describe, it, SuiteFactory } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { FixtureShape, Platform, Bundler, readShape, readPlatform, readBundler } from './test-matrix-parameters';

export type { FixtureShape, Platform, Bundler };

export interface Constraint {
  shapes?:   readonly FixtureShape[];
  bundlers?: readonly Bundler[];
}

// Bundlers we can drive from vitest via a Node API. `bun` is driven via a
// subprocess call to `bun run`, so it requires the Bun runtime to be installed.
export const NODE_API_BUNDLERS: readonly Bundler[] = [
  'vite', 'rollup', 'rolldown', 'webpack', 'rspack', 'rsbuild', 'esbuild', 'farm', 'bun',
];

export const currentShape:   FixtureShape = readShape();
export const currentPlatform: Platform     = readPlatform();
export const currentBundler: Bundler      = readBundler();

export function getFixtureDir(platform?: Platform, bundler?: Bundler): string {
  const p = platform ?? currentPlatform;
  const b = bundler ?? currentBundler;
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  return resolve(__dirname, `../fixtures/${p}/library-app-${b}`);
}

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const TARGET_LIBRARY_OUTPUT_DIR = resolve(
  __dirname,
  '../fixtures/Library/bin/Debug/net10.0/wwwroot/_framework',
);

const FINGERPRINTED_LIBRARY_RE = /^Library\.[a-z0-9]+\.wasm$/;

function listLibraryWasm(): string[] {
  if (!existsSync(TARGET_LIBRARY_OUTPUT_DIR)) return [];
  return readdirSync(TARGET_LIBRARY_OUTPUT_DIR).filter(f => /^Library.*\.wasm$/.test(f));
}

function assertFixtureMatches(shape: FixtureShape): void {
  const wasms = listLibraryWasm();
  const hasCanonical  = wasms.includes('Library.wasm');
  const fingerprinted = wasms.filter(f => FINGERPRINTED_LIBRARY_RE.test(f));

  switch (shape) {
    case 'fingerprint':
      if (fingerprinted.length === 0) {
        throw new Error(`DOTNET_FIXTURE_SHAPE=fingerprint but no fingerprinted Library.<hash>.wasm found in ${TARGET_LIBRARY_OUTPUT_DIR}.`);
      }
      return;

    case 'nofingerprint':
      if (!hasCanonical) {
        throw new Error(`DOTNET_FIXTURE_SHAPE=nofingerprint but canonical Library.wasm not found in ${TARGET_LIBRARY_OUTPUT_DIR}.`);
      }
      if (fingerprinted.length > 0) {
        throw new Error(`DOTNET_FIXTURE_SHAPE=nofingerprint but found fingerprinted files in ${TARGET_LIBRARY_OUTPUT_DIR}.`);
      }
      return;

    case 'none':
      if (wasms.length > 0) {
        throw new Error(`DOTNET_FIXTURE_SHAPE=none but found ${wasms.length} Library wasm file(s) in ${TARGET_LIBRARY_OUTPUT_DIR}.`);
      }
      return;
  }
}

assertFixtureMatches(currentShape);

function matches(c: Constraint): boolean {
  if (c.shapes   && !c.shapes.includes(currentShape))     return false;
  if (c.bundlers && !c.bundlers.includes(currentBundler)) return false;
  return true;
}

function skipReason(c: Constraint): string {
  const parts: string[] = [];
  if (c.shapes)   parts.push(`shape ∈ {${c.shapes.join(',')}}`);
  if (c.bundlers) parts.push(`bundler ∈ {${c.bundlers.join(',')}}`);
  return `requires ${parts.join(' & ')}; current platform=${currentPlatform}, shape=${currentShape}, bundler=${currentBundler}`;
}

type DescribeFn = (name: string, fn: () => void) => void;
type ItFn       = (name: string, fn: () => void | Promise<void>, timeout?: number) => void;

export function describeWhen(c: Constraint): DescribeFn {
  if (matches(c)) {
    const prefix = `[${currentPlatform}][${currentBundler}][${currentShape}]`;
    return ((name: string, fn: SuiteFactory<object>) => describe(`${prefix} ${name}`, fn)) as unknown as DescribeFn;
  }
  const reason = skipReason(c);
  return (name, fn) => describe.skip(`${name} [skipped: ${reason}]`, fn);
}

export function itWhen(c: Constraint): ItFn {
  if (matches(c)) return it as unknown as ItFn;
  const reason = skipReason(c);
  return (name, fn, timeout) => it.skip(`${name} [skipped: ${reason}]`, fn, timeout);
}
