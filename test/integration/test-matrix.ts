import { describe, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export type FixtureShape = 'fingerprint' | 'nofingerprint' | 'none';
export type Bundler =
  | 'vite'
  | 'rollup'
  | 'rolldown'
  | 'webpack'
  | 'rspack'
  | 'rsbuild'
  | 'esbuild'
  | 'farm'
  | 'bun';

export interface Constraint {
  shapes?:   readonly FixtureShape[];
  bundlers?: readonly Bundler[];
}

const VALID_SHAPES: readonly FixtureShape[] = ['fingerprint', 'nofingerprint', 'none'];
const VALID_BUNDLERS: readonly Bundler[]    = [
  'vite', 'rollup', 'rolldown', 'webpack', 'rspack', 'rsbuild', 'esbuild', 'farm', 'bun',
];

// Bundlers we can drive from vitest via a Node API. `bun` requires the Bun
// runtime for `Bun.build`, so integration tests that construct an
// `IsolatedBundlerBuild` gate themselves on this list.
export const NODE_API_BUNDLERS: readonly Bundler[] = [
  'vite', 'rollup', 'rolldown', 'webpack', 'rspack', 'rsbuild', 'esbuild', 'farm',
];

function readShape(): FixtureShape {
  const raw = process.env.DOTNET_FIXTURE_SHAPE ?? 'fingerprint';
  if (!VALID_SHAPES.includes(raw as FixtureShape)) {
    throw new Error(`DOTNET_FIXTURE_SHAPE='${raw}' is not one of: ${VALID_SHAPES.join(', ')}.`);
  }
  return raw as FixtureShape;
}

function readBundler(): Bundler {
  const raw = process.env.BUNDLER ?? 'vite';
  if (!VALID_BUNDLERS.includes(raw as Bundler)) {
    throw new Error(`BUNDLER='${raw}' is not implemented yet. Supported: ${VALID_BUNDLERS.join(', ')}.`);
  }
  return raw as Bundler;
}

export const currentShape:   FixtureShape = readShape();
export const currentBundler: Bundler      = readBundler();

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLISH_FRAMEWORK_DIR = resolve(
  __dirname,
  '../fixtures/Library/bin/Release/net10.0/publish/wwwroot/_framework',
);

const FINGERPRINTED_LIBRARY_RE = /^Library\.[a-z0-9]+\.wasm$/;

function listLibraryWasm(): string[] {
  if (!existsSync(PUBLISH_FRAMEWORK_DIR)) return [];
  return readdirSync(PUBLISH_FRAMEWORK_DIR).filter(f => /^Library.*\.wasm$/.test(f));
}

function assertFixtureMatches(shape: FixtureShape): void {
  const wasms = listLibraryWasm();
  const hasCanonical  = wasms.includes('Library.wasm');
  const fingerprinted = wasms.filter(f => FINGERPRINTED_LIBRARY_RE.test(f));

  switch (shape) {
    case 'fingerprint':
      if (fingerprinted.length === 0) {
        throw new Error(`DOTNET_FIXTURE_SHAPE=fingerprint but no fingerprinted Library.<hash>.wasm found in ${PUBLISH_FRAMEWORK_DIR}.`);
      }
      return;

    case 'nofingerprint':
      if (!hasCanonical) {
        throw new Error(`DOTNET_FIXTURE_SHAPE=nofingerprint but canonical Library.wasm not found in ${PUBLISH_FRAMEWORK_DIR}.`);
      }
      if (fingerprinted.length > 0) {
        throw new Error(`DOTNET_FIXTURE_SHAPE=nofingerprint but found fingerprinted files in ${PUBLISH_FRAMEWORK_DIR}.`);
      }
      return;

    case 'none':
      if (wasms.length > 0) {
        throw new Error(`DOTNET_FIXTURE_SHAPE=none but found ${wasms.length} Library wasm file(s) in ${PUBLISH_FRAMEWORK_DIR}.`);
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
  return `requires ${parts.join(' & ')}; current shape=${currentShape}, bundler=${currentBundler}`;
}

type DescribeFn = (name: string, fn: () => void) => void;
type ItFn       = (name: string, fn: () => void | Promise<void>, timeout?: number) => void;

export function describeWhen(c: Constraint): DescribeFn {
  if (matches(c)) return describe as unknown as DescribeFn;
  const reason = skipReason(c);
  return (name, fn) => describe.skip(`${name} [skipped: ${reason}]`, fn);
}

export function itWhen(c: Constraint): ItFn {
  if (matches(c)) return it as unknown as ItFn;
  const reason = skipReason(c);
  return (name, fn, timeout) => it.skip(`${name} [skipped: ${reason}]`, fn, timeout);
}
