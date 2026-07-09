import { describe, it, SuiteFactory } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  Fingerprint, BuildMode, Platform, Bundler,
  readFingerprint, readBuildMode, readPlatform, readBundler,
} from './test-matrix-parameters';

export type { Fingerprint, BuildMode, Platform, Bundler };

export interface Constraint {
  fingerprints?: readonly Fingerprint[];
  buildModes?:   readonly BuildMode[];
  bundlers?:     readonly Bundler[];
}

export const currentFingerprint: Fingerprint = readFingerprint();
export const currentBuildMode:    BuildMode   = readBuildMode();
export const currentPlatform:     Platform    = readPlatform();
export const currentBundler:      Bundler     = readBundler();

export function getFixtureDir(platform?: Platform, bundler?: Bundler): string {
  const p = platform ?? currentPlatform;
  const b = bundler ?? currentBundler;
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  return resolve(__dirname, `../fixtures/${p}/library-app-${b}`);
}

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function targetLibraryOutputDir(buildMode: BuildMode): string {
  if (buildMode === 'publish') {
    return resolve(__dirname, '../fixtures/Library/bin/Release/net10.0/publish/wwwroot/_framework');
  }
  return resolve(__dirname, '../fixtures/Library/bin/Debug/net10.0/wwwroot/_framework');
}

const TARGET_LIBRARY_OUTPUT_DIR = targetLibraryOutputDir(currentBuildMode);

const FINGERPRINTED_LIBRARY_RE = /^Library\.[a-z0-9]+\.wasm$/;

function listLibraryWasm(): string[] {
  if (!existsSync(TARGET_LIBRARY_OUTPUT_DIR)) return [];
  return readdirSync(TARGET_LIBRARY_OUTPUT_DIR).filter(f => /^Library.*\.wasm$/.test(f));
}

function assertFingerprint(fingerprint: Fingerprint): void {
  const wasms = listLibraryWasm();
  const hasCanonical  = wasms.includes('Library.wasm');
  const fingerprinted = wasms.filter(f => FINGERPRINTED_LIBRARY_RE.test(f));

  if (fingerprint === 'fingerprint') {
    if (fingerprinted.length === 0) {
      throw new Error(`DOTNET_FINGERPRINT=fingerprint but no fingerprinted Library.<hash>.wasm found in ${TARGET_LIBRARY_OUTPUT_DIR}.`);
    }
  } else {
    if (!hasCanonical) {
      throw new Error(`DOTNET_FINGERPRINT=nofingerprint but canonical Library.wasm not found in ${TARGET_LIBRARY_OUTPUT_DIR}.`);
    }
    if (fingerprinted.length > 0) {
      throw new Error(`DOTNET_FINGERPRINT=nofingerprint but found fingerprinted files in ${TARGET_LIBRARY_OUTPUT_DIR}.`);
    }
  }
}

function assertFixtureMatches(buildMode: BuildMode, fingerprint: Fingerprint): void {
  if (buildMode === 'none') {
    const wasms = listLibraryWasm();
    if (wasms.length > 0) {
      throw new Error(`DOTNET_BUILD_MODE=none but found ${wasms.length} Library wasm file(s) in ${TARGET_LIBRARY_OUTPUT_DIR}.`);
    }
    return;
  }
  assertFingerprint(fingerprint);
}

assertFixtureMatches(currentBuildMode, currentFingerprint);

function matches(c: Constraint): boolean {
  if (c.fingerprints && !c.fingerprints.includes(currentFingerprint)) return false;
  if (c.buildModes   && !c.buildModes.includes(currentBuildMode))     return false;
  if (c.bundlers     && !c.bundlers.includes(currentBundler))         return false;
  return true;
}

function skipReason(c: Constraint): string {
  const parts: string[] = [];
  if (c.fingerprints) parts.push(`fingerprint ∈ {${c.fingerprints.join(',')}}`);
  if (c.buildModes)   parts.push(`buildMode ∈ {${c.buildModes.join(',')}}`);
  if (c.bundlers)     parts.push(`bundler ∈ {${c.bundlers.join(',')}}`);
  return `requires ${parts.join(' & ')}; current platform=${currentPlatform}, fingerprint=${currentFingerprint}, buildMode=${currentBuildMode}, bundler=${currentBundler}`;
}

type DescribeFn = (name: string, fn: () => void) => void;
type ItFn       = (name: string, fn: () => void | Promise<void>, timeout?: number) => void;

export function describeWhen(c: Constraint): DescribeFn {
  if (matches(c)) {
    const prefix = `[${currentPlatform}][${currentBundler}][${currentFingerprint}][${currentBuildMode}]`;
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
