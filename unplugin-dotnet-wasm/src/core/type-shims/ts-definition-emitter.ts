import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Logger } from '../logger';
import { toPosixPath } from '../path-utils';
import { type TypeEntry, TS_ROUTE } from './type-entry';

export interface TsDefinitionEmitterDeps {
  root: string;
  logger: Logger;
}

/**
 * Manages lazy loading and usage of the TypeScript module for declaration
 * emission. Loads synchronously on first real use, logs failure once, then
 * returns null forever after. Clients can always call emit() without checking
 * for TypeScript availability first.
 */
export class TsDefinitionEmitter {
  private ts?: typeof import('typescript');
  private unavailable = false;

  constructor(private readonly deps: TsDefinitionEmitterDeps) {}

  /** Produce the `.d.ts` text for one entrypoint, or `null` to skip it. */
  public emit(entry: TypeEntry): string | null {
    if (entry.kind === 'dts') {
      // Re-export the existing `.d.ts` by absolute, extensionless specifier.
      const specifier = toPosixPath(entry.physicalPath.replace(TS_ROUTE, ''));
      return `export * from '${specifier}';\n`;
    }
    if (entry.kind === 'ts') {
      // Emit a `.d.ts` from the `.ts` source via TypeScript.
      return this.emitDeclaration(entry.physicalPath);
    }
    return null;
  }

  /**
   * Emit a single-file declaration (.d.ts) from a TypeScript source.
   * Returns the declaration text, or null if the source has no declaration output
   * or TypeScript is unavailable.
   */
  private emitDeclaration(path: string): string | null {
    const ts = this.load();
    if (!ts) return null;

    // Full type-directed declaration emit via a single-file Program. Unlike
    // `transpileDeclaration`, this does not require `--isolatedDeclarations`
    // conformance, so it handles ordinary SDK-generated TypeScript.
    const options: import('typescript').CompilerOptions = {
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
      if (fileName.endsWith('.d.ts')) dts = text;
    };
    const program = ts.createProgram([path], options, host);
    program.emit(undefined, undefined, undefined, /* emitOnlyDtsFiles */ true);

    if (dts === undefined) {
      this.deps.logger.warn(
        `type-shims: declaration emit produced no output for "${path}"; skipping`,
      );
      return null;
    }
    return dts;
  }

  /**
   * Synchronously load TypeScript from the consumer's node_modules. Returns
   * undefined if not available; caches the unavailable state so repeated calls
   * do not re-warn.
   */
  private load(): typeof import('typescript') | undefined {
    if (this.ts) return this.ts;
    if (this.unavailable) return undefined;

    const consumerRequire = createRequire(join(this.deps.root, '__tsresolve__.js'));
    try {
      const mod = consumerRequire('typescript');
      this.ts = 'default' in mod ? mod.default : mod;
      return this.ts;
    } catch {
      this.unavailable = true;
      this.deps.logger.warn(
        'type-shims: typescript not resolvable from the consumer root; skipping type generation',
      );
      return undefined;
    }
  }
}
