import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path, { basename, dirname, join } from 'node:path';
import type { Logger } from '../logger';
import type typescript from 'typescript';
import { toPosixPath } from '../path-utils';

const DECL_EXT = '.d.ts';
const TS_EXT = '.ts';

type EmitStrategy =
  { kind: 'in-process'; ts: typeof typescript } | { kind: 'cli'; tscPath: string };

export type TsStrategySelection =
  | { kind: 'cli'; tscPath: string }
  | { kind: 'in-process' }
  | { kind: 'unsupported'; reason: string };

/**
 * Chooses how to emit `.d.ts`, based solely on the installed `typescript` package.json.
 * - TS >= 7: shell out to the `tsc` CLI
 * - TS 5–6: use the in-process compiler API.
 */
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
  if (major >= 7) {
    const relativeBin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.tsc;
    if (!relativeBin) {
      return {
        kind: 'unsupported',
        reason: `could not locate the "tsc" CLI in TypeScript "${pkg.version}".`,
      };
    }
    return { kind: 'cli', tscPath: join(packageDir, relativeBin) };
  }
  return { kind: 'in-process' };
}

export class TsDefinitionEmitter {
  private strategy?: EmitStrategy;
  private unavailable = false;

  constructor(
    private readonly root: string,
    private readonly logger: Logger,
  ) {}

  /**
   * Generates .d.ts content that re-exports definitionFile.
   * @throws {Error} if the file does not have a .d.ts extension or is not an absolute path.
   */
  public forwardDTS(definitionFile: string): string {
    if (!definitionFile.endsWith(DECL_EXT)) {
      throw new Error(`Expected a .d.ts file path, got "${definitionFile}"`);
    }
    if (!path.isAbsolute(definitionFile)) {
      // non-absolute paths wont resolve correctly in the consumer's node_modules
      throw new Error(`Expected an absolute path, got "${definitionFile}"`);
    }
    const pathClean = definitionFile.slice(0, -DECL_EXT.length);
    return `export * from '${toPosixPath(pathClean)}';\n`;
  }

  /**
   * Compiles .ts to .d.ts, returns null if compilation failed.
   * @throws {Error} if the file does not have a .ts extension.
   */
  public compileToDTS(sourceFile: string): string | null {
    if (!sourceFile.endsWith(TS_EXT)) {
      throw new Error(`Expected a .ts file path, got "${sourceFile}"`);
    }

    const strategy = this.resolveStrategy();
    if (!strategy) return null;

    return strategy.kind === 'in-process'
      ? this.compileInProcess(strategy.ts, sourceFile)
      : this.compileViaCli(strategy.tscPath, sourceFile);
  }

  private compileInProcess(ts: typeof typescript, sourceFile: string): string | null {
    const options: typescript.CompilerOptions = {
      declaration: true,
      emitDeclarationOnly: true,
      skipLibCheck: true,
      strict: false,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    };
    const host = ts.createCompilerHost(options, /* setParentNodes */ true);
    let dts: string | undefined;
    host.writeFile = (fileName, text) => {
      if (fileName.endsWith(DECL_EXT)) {
        dts = text;
      }
    };
    const program = ts.createProgram([sourceFile], options, host);
    program.emit(undefined, undefined, undefined, /* emitOnlyDtsFiles */ true);

    if (dts === undefined) {
      this.logger.warn(`No definition file could be generated for "${sourceFile}"; skipping`);
      return null;
    }
    return dts;
  }

  private compileViaCli(tscPath: string, sourceFile: string): string | null {
    const outDir = mkdtempSync(join(tmpdir(), 'dotnet-wasm-dts-'));
    try {
      const result = spawnSync(
        process.execPath,
        [
          tscPath,
          '--ignoreConfig',
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

      const outFile = join(outDir, basename(sourceFile).slice(0, -TS_EXT.length) + DECL_EXT);
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
    if (selection.kind === 'cli') {
      this.strategy = { kind: 'cli', tscPath: selection.tscPath };
      return this.strategy;
    }

    const mod = consumerRequire('typescript');
    const ts = (
      mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod
    ) as typeof typescript;
    this.strategy = { kind: 'in-process', ts };
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
