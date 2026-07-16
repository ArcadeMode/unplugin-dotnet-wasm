import type { DotnetAssetsOptions } from '../types';
import { createConsoleLogger, type Logger } from '../core/logger';
import { BundlerCompatRewriter, type BundlerFramework } from '../core/bundler-compat-rewriter';
import { ManifestLoader } from '../core/manifest-parsing/loader';
import { buildEndpointLookup } from '../core/asset-resolution/endpoint-lookup';
import { buildVfs, buildEmptyVfs } from '../core/asset-resolution/vfs';
import { AssetResolver } from '../core/asset-resolution/asset-resolver';
import { ShimPackageGenerator } from '../core/type-shims/shim-package-generator';
import { SourceFileChangeTracker } from '../core/type-shims/source-file-change-tracker';
import { TsDefinitionEmitter } from '../core/type-shims/ts-definition-emitter';
import { NodeModulesLocator } from '../core/type-shims/node-modules-locator';
import { FileDiscoverer } from '../core/type-shims/file-discoverer';
import { createAssetMiddleware, type ConnectMiddleware } from '../core/dev-server/asset-middleware';
import { isYarnPnp } from '../core/is-yarn-pnp';

export class PluginContext {
  readonly #options: DotnetAssetsOptions;
  readonly #logger: Logger;
  readonly #rewriter: BundlerCompatRewriter;
  // persists source-file mtimes across builds; internal input to the type-shim generator
  readonly #changeTracker = new SourceFileChangeTracker();

  #consumerRoot = process.cwd();
  #assetResolver: AssetResolver | null = null;
  #assetMiddleware: ConnectMiddleware | null = null;
  #initPromise: Promise<void> | null = null;

  constructor(options: DotnetAssetsOptions, framework: BundlerFramework) {
    this.#options = options;
    this.#logger = createConsoleLogger(options.logLevel ?? 'warn');
    this.#rewriter = new BundlerCompatRewriter(framework);
  }

  get options(): DotnetAssetsOptions { return this.#options; }
  get logger(): Logger { return this.#logger; }
  get rewriter(): BundlerCompatRewriter { return this.#rewriter; }

  get consumerRoot(): string { return this.#consumerRoot; }
  setConsumerRoot(root: string): void { this.#consumerRoot = root; }

  get assetResolver(): AssetResolver {
    if (!this.#assetResolver) throw new Error('assetResolver accessed before initialize()');
    return this.#assetResolver;
  }

  // Memoized: loads the asset resolver and generates type shims exactly once per process,
  // no matter how many hooks invoke it (buildStart, and webpack/rspack pre-compile hooks
  // that fire before unplugin's buildStart is awaited).
  initialize(): Promise<void> {
    return (this.#initPromise ??= this.#doInitialize());
  }

  async #doInitialize(): Promise<void> {
    const { endpointsManifest, runtimeManifest, endpointsManifestPath } =
      await new ManifestLoader().load(this.#options);
    const endpointLookup = buildEndpointLookup(endpointsManifest);
    const vfs = runtimeManifest
      ? buildVfs(runtimeManifest, { logger: this.#logger })
      : buildEmptyVfs(endpointsManifestPath, { logger: this.#logger });
    this.#assetResolver = new AssetResolver(vfs, endpointLookup);

    if (isYarnPnp()) {
      this.#logger.warn(`Yarn Plug'n'Play detected: skipping editor/tsc type-shim generation. Asset resolution and bundling are unaffected but type info from '${this.#options.projectName}' will most likely not be available.`);
      return;
    }
    const locator = new NodeModulesLocator(this.#consumerRoot);
    const discoverer = new FileDiscoverer(this.#assetResolver, this.#logger);
    const emitter = new TsDefinitionEmitter(this.#consumerRoot, this.#logger);
    const generator = new ShimPackageGenerator(locator, discoverer, this.#changeTracker, emitter, this.#logger);
    await generator.generate();
  }

  get assetMiddleware(): ConnectMiddleware {
    if (!this.#assetMiddleware) throw new Error('assetMiddleware accessed before enableAssetMiddleware()');
    return this.#assetMiddleware;
  }

  enableAssetMiddleware(): void {
    if (this.#assetMiddleware) return;
    this.#assetMiddleware = createAssetMiddleware(this.assetResolver, this.#logger);
  }
}
