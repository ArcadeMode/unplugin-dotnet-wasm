// Multi-bundler asset-emission spike runner.
//
// For each supported bundler, run the build via its Node API using the
// per-bundler config file, then verify that:
//   1. Exactly one `.wasm` file was emitted somewhere under `dist-<bundler>/`
//   2. Its bytes match the source `Library.wasm` byte-for-byte
//   3. The entry chunk references the emitted `.wasm` (or the hashed basename)
//
// Failures do not abort the run — every bundler is attempted and a summary
// is printed at the end. Exit code is non-zero if any bundler failed.
// Pass bundler names as args to run a subset, e.g. `node run.mjs vite esbuild`.

import { rm, readFile, stat, readdir } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REAL_WASM } from './plugin.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));

// ── helpers ──────────────────────────────────────────────────────────────

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function inspect(distDir) {
  if (!existsSync(distDir)) throw new Error(`no dist directory at ${distDir}`);

  const files = [];
  for await (const f of walk(distDir)) files.push(f);
  const wasmFiles = files.filter(f => f.endsWith('.wasm'));

  if (wasmFiles.length === 0) {
    throw new Error(`no .wasm emitted (files: ${files.map(f => relative(distDir, f)).join(', ')})`);
  }
  if (wasmFiles.length > 1) {
    throw new Error(`expected 1 wasm, got ${wasmFiles.length}: ${wasmFiles.map(f => relative(distDir, f)).join(', ')}`);
  }

  const [wasmPath] = wasmFiles;
  const emittedBytes = await readFile(wasmPath);
  const sourceBytes = await readFile(REAL_WASM);
  if (emittedBytes.length !== sourceBytes.length) {
    throw new Error(`wasm size ${emittedBytes.length} != source ${sourceBytes.length}`);
  }
  if (!emittedBytes.equals(sourceBytes)) {
    throw new Error(`wasm bytes differ from source (same length ${sourceBytes.length})`);
  }

  const jsFiles = files.filter(f => /\.(m?js|cjs)$/.test(f));
  const wasmName = wasmPath.slice(distDir.length + 1).replace(/\\/g, '/');
  const wasmBase = wasmName.split('/').pop();
  const jsContainingWasm = [];
  for (const jsFile of jsFiles) {
    const src = await readFile(jsFile, 'utf8');
    if (src.includes(wasmBase) || src.includes(wasmName)) jsContainingWasm.push(jsFile);
  }
  if (jsContainingWasm.length === 0) {
    throw new Error(`no JS chunk references "${wasmBase}" (js files: ${jsFiles.map(f => relative(distDir, f)).join(', ')})`);
  }

  const size = (await stat(wasmPath)).size;
  return { wasmName, size };
}

async function loadConfig(name) {
  const url = pathToFileURL(resolve(HERE, `${name}.config.mjs`)).href;
  const mod = await import(url);
  return mod.default;
}

// ── per-bundler build drivers ────────────────────────────────────────────

async function buildRollup() {
  const { rollup } = await import('rollup');
  const config = await loadConfig('rollup');
  const bundle = await rollup({ input: config.input, plugins: config.plugins });
  await bundle.write(config.output);
  await bundle.close();
}

async function buildVite() {
  const { build } = await import('vite');
  const config = await loadConfig('vite');
  await build(config);
}

async function buildWebpack() {
  const { default: webpack } = await import('webpack');
  const config = await loadConfig('webpack');
  await new Promise((res, rej) => {
    webpack(config, (err, stats) => {
      if (err) return rej(err);
      if (stats?.hasErrors()) return rej(new Error(stats.toString({ preset: 'errors-only' })));
      res();
    });
  });
}

async function buildEsbuild() {
  const esbuild = await import('esbuild');
  const config = await loadConfig('esbuild');
  await esbuild.build(config);
}

async function buildRspack() {
  const { rspack } = await import('@rspack/core');
  const config = await loadConfig('rspack');
  await new Promise((res, rej) => {
    rspack(config, (err, stats) => {
      if (err) return rej(err);
      if (stats?.hasErrors()) return rej(new Error(stats.toString({ preset: 'errors-only' })));
      res();
    });
  });
}

async function buildRsbuild() {
  const { createRsbuild } = await import('@rsbuild/core');
  const rsbuildConfig = await loadConfig('rsbuild');
  const rsbuild = await createRsbuild({ rsbuildConfig });
  await rsbuild.build();
}

async function buildRsbuildMixed() {
  const { createRsbuild } = await import('@rsbuild/core');
  const rsbuildConfig = await loadConfig('rsbuild-mixed');
  const rsbuild = await createRsbuild({ rsbuildConfig });
  await rsbuild.build();
}

// Mixed-entry inspector: verify Library.wasm was emitted byte-identical AND
// rsbuild's default wasm-ESM path handled `other.wasm` as an ES module.
// If our scoped rule had wrongly claimed `other.wasm`, rsbuild would have
// emitted it as asset/resource and the entry's `import { f }` would have
// failed linking during build — so a successful build with both wasms in the
// output dir already proves non-interference.
async function inspectRsbuildMixed(distDir) {
  if (!existsSync(distDir)) throw new Error(`no dist directory at ${distDir}`);
  const files = [];
  for await (const f of walk(distDir)) files.push(f);
  const wasmFiles = files.filter(f => f.endsWith('.wasm'));
  if (wasmFiles.length < 2) {
    throw new Error(
      `expected 2 .wasm outputs (Library + user other), got ${wasmFiles.length}: ` +
        wasmFiles.map(f => relative(distDir, f)).join(', '),
    );
  }
  const sourceBytes = await readFile(REAL_WASM);
  let libraryMatch = null;
  let userWasm = null;
  for (const w of wasmFiles) {
    const bytes = await readFile(w);
    if (bytes.equals(sourceBytes)) libraryMatch = w;
    else if (bytes.length === 31 && bytes[0] === 0x00 && bytes[1] === 0x61) userWasm = w;
  }
  if (!libraryMatch) throw new Error('no emitted wasm matched Library.wasm bytes');
  if (!userWasm) throw new Error('no emitted wasm matched user other.wasm (31B)');
  const libName = libraryMatch.slice(distDir.length + 1).replace(/\\/g, '/');
  const userName = userWasm.slice(distDir.length + 1).replace(/\\/g, '/');
  return { wasmName: `${libName} + ${userName}`, size: sourceBytes.length };
}

async function buildRolldown() {
  const { rolldown } = await import('rolldown');
  const config = await loadConfig('rolldown');
  const bundle = await rolldown({ input: config.input, plugins: config.plugins });
  await bundle.write(config.output);
  await bundle.close();
}

async function buildFarm() {
  const { build } = await import('@farmfe/core');
  const config = await loadConfig('farm');
  await build(config);
}

async function buildBun() {
  const { spawnSync } = await import('node:child_process');
  const candidates = ['bun'];
  if (process.env.USERPROFILE) {
    candidates.push(resolve(process.env.USERPROFILE, '.bun', 'bin', 'bun.exe'));
  }
  let bunBin = null;
  for (const c of candidates) {
    const probe = spawnSync(c, ['--version'], { shell: true });
    if (probe.status === 0) { bunBin = c; break; }
  }
  if (!bunBin) throw new Error('bun binary not found on PATH or in ~/.bun/bin');
  const script = resolve(HERE, 'bun.mjs');
  const res = spawnSync(bunBin, [script], { cwd: HERE, stdio: 'inherit', shell: true });
  if (res.status !== 0) throw new Error(`bun build exited ${res.status}`);
}

// ── driver ───────────────────────────────────────────────────────────────

const BUNDLERS = [
  { name: 'rollup', dist: 'dist-rollup', build: buildRollup },
  { name: 'vite', dist: 'dist-vite', build: buildVite },
  { name: 'webpack', dist: 'dist-webpack', build: buildWebpack },
  { name: 'esbuild', dist: 'dist-esbuild', build: buildEsbuild },
  { name: 'rspack', dist: 'dist-rspack', build: buildRspack },
  { name: 'rsbuild', dist: 'dist-rsbuild', build: buildRsbuild },
  { name: 'rsbuild-mixed', dist: 'dist-rsbuild-mixed', build: buildRsbuildMixed, inspect: inspectRsbuildMixed },
  { name: 'rolldown', dist: 'dist-rolldown', build: buildRolldown },
  { name: 'farm', dist: 'dist-farm', build: buildFarm },
  { name: 'bun', dist: 'dist-bun', build: buildBun },
];

async function main() {
  const only = process.argv.slice(2);
  const selected = only.length > 0 ? BUNDLERS.filter(b => only.includes(b.name)) : BUNDLERS;
  if (selected.length === 0) {
    console.error(`No bundlers selected. Valid: ${BUNDLERS.map(b => b.name).join(', ')}`);
    process.exit(1);
  }

  console.log(`Cleaning previous outputs for: ${selected.map(b => b.name).join(', ')}`);
  for (const b of selected) {
    await rm(resolve(HERE, b.dist), { recursive: true, force: true });
  }

  const results = [];
  for (const b of selected) {
    const distAbs = resolve(HERE, b.dist);
    process.stdout.write(`\n─── ${b.name.padEnd(9)} `);
    const started = Date.now();
    let status = 'PASS';
    let detail = '';
    try {
      await b.build();
      const inspector = b.inspect ?? inspect;
      const { wasmName, size } = await inspector(distAbs);
      detail = `${size}B ${wasmName}`;
    } catch (err) {
      status = 'FAIL';
      detail = err instanceof Error ? err.message : String(err);
    }
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`${status} (${elapsed}s) — ${detail.split('\n')[0]}`);
    results.push({ name: b.name, status, detail, elapsed });
  }

  const sourceSize = (await stat(REAL_WASM)).size;
  console.log(`\n═══════════════════════════════════════`);
  console.log(`source wasm: ${sourceSize} bytes`);
  console.log(`─── summary ──────`);
  for (const r of results) {
    console.log(`  ${r.status === 'PASS' ? '✓' : '✗'} ${r.name.padEnd(9)} ${r.status}  (${r.elapsed}s)`);
  }
  const failed = results.filter(r => r.status === 'FAIL');
  if (failed.length > 0) {
    console.log(`\n─── failures ─────`);
    for (const r of failed) {
      console.log(`  ${r.name}: ${r.detail}`);
    }
    process.exit(1);
  }
  console.log(`\nAll ${results.length} bundlers passed.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

