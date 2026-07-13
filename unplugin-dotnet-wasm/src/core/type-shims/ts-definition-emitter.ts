import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Logger } from '../logger';
import type typescript from 'typescript';
import { toPosixPath } from '../path-utils';

const DECL_EXT = '.d.ts';

export class TsDefinitionEmitter {
  private ts?: typeof typescript;
  private unavailable = false;

  constructor(private readonly root: string, private readonly logger: Logger) {}

  public reExport(definitionFile: string): string {
    const pathClean = definitionFile.slice(0, -DECL_EXT.length);
    return `export * from '${toPosixPath(pathClean)}';\n`;
  }

  /**
   * Accepts .ts files.
   * Returns null if the source has no type declarations or TypeScript is unavailable.
   */
  public compile(sourceFile: string): string | null {
    const ts = this.load();
    if (!ts) return null;

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

  private load(): typeof typescript | undefined {
    if (this.ts) return this.ts;
    if (this.unavailable) return undefined;

    const consumerRequire = createRequire(join(this.root, '__tsresolve__.js'));
    try {
      const mod = consumerRequire('typescript');
      this.ts = 'default' in mod ? mod.default : mod;
      return this.ts;
    } catch {
      this.unavailable = true;
      this.logger.warn(
        'Type generation disabled: This may cause editor/tsc errors for .NET WASM imports. Install "typescript" in your project to fix this.',
      );
      return undefined;
    }
  }
}
