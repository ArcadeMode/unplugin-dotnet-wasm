import { it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describeWhen, getFixtureDir } from '../test-matrix';

// Verify the plugin has generated its "magic" type packages on-disk 
// + runs the fixture's tsc to prove the bare virtual imports actually resolve.
const FIXTURE_DIR = getFixtureDir();
const NODE_MODULES = join(FIXTURE_DIR, 'node_modules');

function runTypecheck(cwd: string): string {
  const require = createRequire(import.meta.url);
  const tsc = require.resolve('typescript/bin/tsc', { paths: [cwd] });
  try {
    return execFileSync(process.execPath, [tsc, '--noEmit'], { cwd, encoding: 'utf8' });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
}

describeWhen({ buildModes: ['debug'] })('type-shims: generated packages in the fixture node_modules', () => {
  it('fixture node_modules directory exists', () => {
    expect(existsSync(NODE_MODULES)).toBe(true);
  });

  it('typeshim package is generated (package.json + index.d.ts)', () => {
    expect(existsSync(join(NODE_MODULES, 'typeshim', 'package.json'))).toBe(true);
    expect(existsSync(join(NODE_MODULES, 'typeshim', 'index.d.ts'))).toBe(true);
  });

  it('_framework/dotnet package is generated (package.json + dotnet/index.d.ts)', () => {
    expect(existsSync(join(NODE_MODULES, '_framework', 'package.json'))).toBe(true);
    expect(existsSync(join(NODE_MODULES, '_framework', 'dotnet', 'index.d.ts'))).toBe(true);
  });

  it('tsc resolves the bare virtual imports (no module-not-found)', () => {
    const output = runTypecheck(FIXTURE_DIR);
    expect(output).not.toMatch(/Cannot find module 'typeshim'/);
    expect(output).not.toMatch(/Cannot find module '_framework\/dotnet'/);
  });
});
