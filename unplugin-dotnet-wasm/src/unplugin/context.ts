import type { DotnetWasmOptions } from '../types';
import { createConsoleLogger, type Logger } from '../core/logger';
import { BundlerCompatRewriter, type BundlerFramework } from '../core/bundler-compat-rewriter';
import { ManifestLoader } from '../core/manifest-parsing/loader';
import { EndpointLookup } from '../core/asset-resolution/endpoint-lookup';
import { buildVfs, buildEmptyVfs } from '../core/asset-resolution/vfs';
import { AssetResolver } from '../core/asset-resolution/asset-resolver';
import { ShimPackageGenerator } from '../core/type-shims/shim-package-generator';
import { SourceFileChangeTracker } from '../core/type-shims/source-file-change-tracker';
import { TsDefinitionEmitter } from '../core/type-shims/ts-definition-emitter';
import { NodeModulesLocator } from '../core/type-shims/node-modules-locator';
import { FileDiscoverer } from '../core/type-shims/file-discoverer';
import { createAssetMiddleware, type ConnectMiddleware } from '../core/dev-server/asset-middleware';
import { isYarnPnp } from '../core/is-yarn-pnp';

type InitializeCallback = () => void | Promise<void>;

export class PluginContext {
  public readonly logger: Logger;
  public readonly rewriter: BundlerCompatRewriter;

  private readonly initCbs: InitializeCallback[] = [];
  // persists source-file mtimes across builds; internal input to the type-shim generator
  private readonly changeTracker = new SourceFileChangeTracker();
  private readonly reloadTriggers: Array<() => void | Promise<void>> = [];

  #consumerRoot = process.cwd();
  #assetResolver: AssetResolver | null = null;
  #assetMiddleware: ConnectMiddleware | null = null;
  #initPromise: Promise<void> | null = null;

  constructor(
    public readonly options: DotnetWasmOptions,
    framework: BundlerFramework,
  ) {
    this.logger = createConsoleLogger(options.logLevel ?? 'warn');
    this.rewriter = new BundlerCompatRewriter(framework);
  }

  get consumerRoot(): string {
    return this.#consumerRoot;
  }
  setConsumerRoot(root: string): void {
    this.#consumerRoot = root;
  }

  get assetResolver(): AssetResolver {
    if (!this.#assetResolver) throw new Error('assetResolver accessed before initialize()');
    return this.#assetResolver;
  }

  get assetMiddleware(): ConnectMiddleware {
    if (!this.#assetMiddleware) throw new Error('assetMiddleware accessed before initialize()');
    return this.#assetMiddleware;
  }

  async initialize(): Promise<void> {
    if (this.#initPromise) return this.#initPromise;
    await (this.#initPromise = this.doInitialize());
    while (this.initCbs.length > 0) {
      const cb = this.initCbs.shift()!;
      cb();
    }
  }

  onInitialized(callback: InitializeCallback): void {
    if (this.#initPromise) this.#initPromise.then(callback);
    this.initCbs.push(callback);
  }

  async reinitialize(): Promise<void> {
    try {
      await this.initAssetResolution();
      this.logger.info('dotnet staticwebassets manifests changed');

      for (const fn of this.reloadTriggers) await fn();
    } catch (err) {
      this.logger.error(`manifest reinitialize failed: ${(err as Error).message}`);
    }
  }

  onReinitialized(fn: () => void | Promise<void>): void {
    this.reloadTriggers.push(fn);
  }

  private async doInitialize(): Promise<void> {
    await this.initAssetResolution();

    if (isYarnPnp()) {
      this.logger.warn(
        `Yarn Plug'n'Play detected: skipping editor/tsc type-shim generation. Asset resolution and bundling are unaffected but type info from '${this.options.projectName}' will most likely not be available.`,
      );
      return;
    }
    const locator = new NodeModulesLocator(this.#consumerRoot);
    const discoverer = new FileDiscoverer(this.#assetResolver!);
    const emitter = new TsDefinitionEmitter(this.#consumerRoot, this.logger);
    const generator = new ShimPackageGenerator(
      locator,
      discoverer,
      this.changeTracker,
      emitter,
      this.logger,
    );
    await generator.generate();
  }

  private async initAssetResolution(): Promise<void> {
    const { endpointsManifest, runtimeManifest, endpointsManifestPath } =
      await new ManifestLoader().load(this.options);
    const endpointLookup = new EndpointLookup(endpointsManifest);
    const vfs = runtimeManifest
      ? buildVfs(runtimeManifest, { logger: this.logger })
      : buildEmptyVfs(endpointsManifestPath, { logger: this.logger });
    const resolver = new AssetResolver(vfs, endpointLookup);
    const middleware = createAssetMiddleware(resolver, this.logger);
    this.#assetResolver = resolver;
    this.#assetMiddleware = middleware;
  }
}
