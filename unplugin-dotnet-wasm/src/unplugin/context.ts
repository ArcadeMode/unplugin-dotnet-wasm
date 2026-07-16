import type { DotnetAssetsOptions } from '../types';
import type { AssetResolver } from '../core/asset-resolution/asset-resolver';
import type { BundlerCompatRewriter } from '../core/bundler-compat-rewriter';
import type { ConnectMiddleware } from '../core/dev-server/asset-middleware';
import type { Logger } from '../core/logger';

export interface PluginContext {
  readonly options: DotnetAssetsOptions;
  readonly logger: Logger;
  readonly rewriter: BundlerCompatRewriter;
  assetResolver: AssetResolver | null;
  consumerRoot: string;
  isServe: boolean;
  assetMiddleware: ConnectMiddleware | null;
}
