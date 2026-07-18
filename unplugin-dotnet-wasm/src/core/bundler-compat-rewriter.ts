import { DOTNET_NODE_BUILTINS } from './constants';

export type BundlerFramework =
  'vite' | 'rollup' | 'rolldown' | 'webpack' | 'rspack' | 'rsbuild' | 'esbuild' | 'bun' | 'farm';

/**
 * Rewrites dotnet framework JS source to be compatible with a specific bundler
 * through the insertion of bundler pragmas and other transformations.
 */
export class BundlerCompatRewriter {
  private readonly pragma: string;
  private readonly rewritesNewUrl: boolean;
  private readonly rewritesBunBuiltins: boolean;

  constructor(framework: BundlerFramework) {
    this.pragma = this.getIgnorePragma(framework);
    // Webpack family suppresses new URL() resolution via a parser module rule; the pragma is not necessary there.
    this.rewritesNewUrl = this.pragma !== '' && !this.isWebpackFamily(framework);
    this.rewritesBunBuiltins = framework === 'bun';
  }

  /** Returns the rewritten source, or null if no changes were needed. */
  rewrite(code: string): string | null {
    let result = code;

    if (this.pragma) {
      result = result.replace(/\bimport\(\s*(?:\/\*[\s\S]*?\*\/\s*)*/g, `import(${this.pragma} `);
      if (this.rewritesNewUrl) {
        result = result.replace(
          /\bnew URL\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)*/g,
          `new URL(${this.pragma} `,
        );
      }
    }

    if (this.rewritesBunBuiltins) {
      const builtins = DOTNET_NODE_BUILTINS.join('|');
      result = result.replace(
        new RegExp(`(\\bimport\\(\\s*(?:\\/\\*[\\s\\S]*?\\*\\/\\s*)*)(['"])(${builtins})\\2`, 'g'),
        '$1(0,$2$3$2)',
      );
    }

    return result !== code ? result : null;
  }

  // Returns the single magic comment for the given framework, or '' when none applies.
  private getIgnorePragma(framework: BundlerFramework): string {
    if (framework === 'vite') return '/* @vite-ignore */';
    if (this.isWebpackFamily(framework)) return '/* webpackIgnore: true */';
    if (framework === 'farm') return '/* $farm-ignore */';
    return '';
  }

  private isWebpackFamily(framework: BundlerFramework): boolean {
    return framework === 'webpack' || framework === 'rspack' || framework === 'rsbuild';
  }
}
