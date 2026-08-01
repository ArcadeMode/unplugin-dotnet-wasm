import { it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildFixture, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture-node';

// Verify the plugin has generated its "magic" package shims on-disk in the
// fixture's isolated `node_modules` + runs the fixture's own `tsc` to prove the
// bare virtual imports actually resolve.
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

permuteFixture({ serveMode: 'dist' }, (params) => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await buildFixture({ ...params, buildMode: 'debug' });
    await fixture.buildLibrary();
    await fixture.build();
  }, 120_000);

  afterAll(async () => {
    await fixture?.dispose();
  });

  it('fixture node_modules directory exists', () => {
    expect(existsSync(join(fixture.dir, 'node_modules'))).toBe(true);
  });

  it('typeshim package shim is generated (package.json + index.d.ts)', () => {
    const nodeModules = join(fixture.dir, 'node_modules');
    expect(existsSync(join(nodeModules, 'typeshim', 'package.json'))).toBe(true);
    expect(existsSync(join(nodeModules, 'typeshim', 'index.d.ts'))).toBe(true);
  });

  it('_framework/dotnet package shim is generated (package.json + dotnet/index.d.ts)', () => {
    const nodeModules = join(fixture.dir, 'node_modules');
    expect(existsSync(join(nodeModules, '_framework', 'package.json'))).toBe(true);
    expect(existsSync(join(nodeModules, '_framework', 'dotnet', 'index.d.ts'))).toBe(true);
  });

  it('tsc resolves the bare virtual imports (no module-not-found)', () => {
    const output = runTypecheck(fixture.dir);
    expect(output).not.toMatch(/Cannot find module 'typeshim'/);
    expect(output).not.toMatch(/Cannot find module '_framework\/dotnet'/);
  });
});
