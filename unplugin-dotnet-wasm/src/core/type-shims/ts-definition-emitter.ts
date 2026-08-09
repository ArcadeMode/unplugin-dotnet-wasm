import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path, { basename, dirname, join } from 'node:path';
import type { Logger } from '../logger';
import { toPosixPath } from '../path-utils';

const DECL_EXT = '.d.ts';
const TS_EXT = '.ts';
const JS_EXT = '.js';

type EmitStrategy = { kind: 'cli'; tscPath: string; ignoreConfig: boolean };

export type TsStrategySelection =
  { kind: 'cli'; tscPath: string; ignoreConfig: boolean } | { kind: 'unsupported'; reason: string };

export function selectTsStrategy(
  pkg: { version?: string; bin?: string | Record<string, string> },
  packageDir: string,
): TsStrategySelection {
  const major = Number.parseInt(pkg.version ?? '', 10);
  if (Number.isNaN(major) || major < 5) {
    return {
      kind: 'unsupported',
      reason: `the installed TypeScript "${pkg.version ?? 'unknown'}" is unsupported; TypeScript >= 5 is required.`,
    };
  }
  const relativeBin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.tsc;
  if (!relativeBin) {
    return {
      kind: 'unsupported',
      reason: `could not locate the "tsc" CLI in TypeScript "${pkg.version}".`,
    };
  }
  return { kind: 'cli', tscPath: join(packageDir, relativeBin), ignoreConfig: major >= 7 };
}

export class TsDefinitionEmitter {
  private strategy?: EmitStrategy;
  private unavailable = false;

  constructor(
    private readonly root: string,
    private readonly logger: Logger,
  ) {}

  public forwardDTS(definitionFile: string): string {
    if (!definitionFile.endsWith(DECL_EXT)) {
      throw new Error(`Expected a .d.ts file path, got "${definitionFile}"`);
    }
    if (!path.isAbsolute(definitionFile)) {
      // non-absolute paths won't resolve correctly from the consumer's node_modules
      throw new Error(`Expected an absolute path, got "${definitionFile}"`);
    }
    const pathClean = definitionFile.slice(0, -DECL_EXT.length);
    return `export * from '${toPosixPath(pathClean)}';\n`;
  }

  public compileToDTS(sourceFile: string): string | null {
    const ext = sourceFile.endsWith(JS_EXT) ? JS_EXT : sourceFile.endsWith(TS_EXT) ? TS_EXT : null;
    if (ext === null) {
      throw new Error(`Expected a .ts or .js file path, got "${sourceFile}"`);
    }

    const strategy = this.resolveStrategy();
    if (!strategy) return null;

    return this.compileViaCli(strategy, sourceFile, ext);
  }

  private compileViaCli(strategy: EmitStrategy, sourceFile: string, ext: string): string | null {
    const outDir = mkdtempSync(join(tmpdir(), 'unplugin-dotnet-wasm-'));
    try {
      const result = spawnSync(
        process.execPath,
        [
          strategy.tscPath,
          ...(strategy.ignoreConfig ? ['--ignoreConfig'] : []),
          ...(ext === JS_EXT ? ['--allowJs'] : []),
          '--declaration',
          '--emitDeclarationOnly',
          '--skipLibCheck',
          '--target',
          'ESNext',
          '--module',
          'ESNext',
          '--moduleResolution',
          'Bundler',
          '--rootDir',
          dirname(sourceFile),
          '--outDir',
          outDir,
          sourceFile,
        ],
        { cwd: this.root, encoding: 'utf8' },
      );

      const outFile = join(outDir, basename(sourceFile).slice(0, -ext.length) + DECL_EXT);
      if (!existsSync(outFile)) {
        this.logger.warn(`No definition file was generated for "${sourceFile}"; skipping`);
        this.logger.debug(result.error?.message ?? result.stderr ?? result.stdout ?? '');
        return null;
      }
      return readFileSync(outFile, 'utf8');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }

  private resolveStrategy(): EmitStrategy | undefined {
    if (this.strategy) return this.strategy;
    if (this.unavailable) return undefined;

    const consumerRequire = createRequire(join(this.root, '__tsresolve__.js'));

    let packageJsonPath: string;
    try {
      packageJsonPath = consumerRequire.resolve('typescript/package.json');
    } catch {
      return this.disable('TypeScript is not installed \u2014 add "typescript" to your project.');
    }

    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      version?: string;
      bin?: string | Record<string, string>;
    };
    const selection = selectTsStrategy(pkg, dirname(packageJsonPath));

    if (selection.kind === 'unsupported') {
      return this.disable(selection.reason);
    }
    this.strategy = {
      kind: 'cli',
      tscPath: selection.tscPath,
      ignoreConfig: selection.ignoreConfig,
    };
    return this.strategy;
  }

  private disable(detail: string): undefined {
    this.unavailable = true;
    this.logger.warn(
      `Type generation disabled: ${detail} This may cause editor/tsc errors for .NET WASM imports.`,
    );
    return undefined;
  }
}
