import { readFile } from 'node:fs/promises';
import { basename, parse, join } from 'node:path';
import type { PluginContext } from '../context';

interface FarmConfig {
  root?: string;
  compilation?: {
    output?: { targetEnv?: string };
    presetEnv?: unknown;
  };
}

export interface FarmFamilyHooks {
  resolveId(source: string): string | null;
  loadInclude(id: string): boolean;
  load(id: string): Promise<string | null>;
  farm: { config(userConfig: FarmConfig): Record<string, never> };
}

export function createFarmFamily(ctx: PluginContext): FarmFamilyHooks {
  const FARM_CONTENT_DIR = '__dotnet_content__';
  const farmContentAliases = new Map<string, string>();

  return {
    resolveId(source: string): string | null {
      if (!ctx.assetResolver) return null;
      const resolved = ctx.assetResolver.resolve(source);
      if (resolved === null) return null;
      if (parse(resolved).root.toLowerCase() !== parse(ctx.consumerRoot).root.toLowerCase()) {
        // files are being served from another root (e.g. C:\ while project is on D:\)
        // farm no likey, return alias which we will resolve in `load`
        farmContentAliases.set(basename(resolved), resolved);
        return join(ctx.consumerRoot, FARM_CONTENT_DIR, basename(resolved));
      }
      return resolved;
    },
    // only fire `load` for our content aliases
    loadInclude(id: string): boolean {
      return id.includes(FARM_CONTENT_DIR);
    },
    async load(id: string): Promise<string | null> {
      const real = farmContentAliases.get(basename(id));
      return real === undefined ? null : readFile(real, 'utf-8');
    },
    farm: {
      config(userConfig: FarmConfig): Record<string, never> {
        if (userConfig.root) ctx.consumerRoot = userConfig.root;
        const targetEnv = userConfig.compilation?.output?.targetEnv;
        const presetEnv = userConfig.compilation?.presetEnv;
        const polyfillFree = targetEnv === 'browser-esnext' || targetEnv === 'node-next' || presetEnv === false;
        if (!polyfillFree) {
          ctx.logger.warn(
            `The configured compilation.output.targetEnv (${targetEnv ?? 'browser-es2017'}) enables preset-env polyfill injection, ` +
            `which requires 'core-js' to be installed. Alternatively set compilation.output.targetEnv: 'browser-esnext' | 'node-next' ` +
            `to skip polyfills.`,
          );
        }
        return {};
      },
    },
  };
}
