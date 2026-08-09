import type { AssetResolver } from '../asset-resolution/asset-resolver';

const SOURCE_EXT = '.ts';
const DECL_EXT = '.d.ts';
const JS_EXT = '.js';

export interface DiscoveryEntry {
  subpath: string;
  sourceFile?: string;
  definitionFile?: string;
}

export interface DiscoveryGroup {
  packageName: string;
  entries: DiscoveryEntry[];
}

type EntryData = { entry: DiscoveryEntry; packageName: string };

export class FileDiscoverer {
  constructor(private readonly resolver: AssetResolver) {}

  /**
   * Discover all ts exports grouped by root path segment (or file name if no segment).
   */
  discover(): DiscoveryGroup[] {
    const entryMap = this.buildDiscoveryEntries();
    const groupMap = new Map<string, DiscoveryGroup>();
    for (const entryData of entryMap.values()) {
      const { packageName, entry } = entryData;
      let group = groupMap.get(packageName);
      if (!group) {
        group = { packageName, entries: [] };
        groupMap.set(packageName, group);
      }
      group.entries.push(entry);
    }

    return [...groupMap.values()];
  }

  private buildDiscoveryEntries(): Map<string, EntryData> {
    const resolver = this.resolver;
    const entryMap = new Map<string, EntryData>();
    const typedSpecifiers = new Set<string>();
    const jsRoutes: { route: string; physicalPath: string; bareSpecifier: string }[] = [];

    for (const route of resolver.routes()) {
      const physicalPath = resolver.resolve(route);
      if (physicalPath === null) continue;

      if (route.endsWith(DECL_EXT)) {
        const specifier = route.slice(0, -DECL_EXT.length);
        typedSpecifiers.add(specifier);
        getOrCreateEntry(specifier).entry.definitionFile = physicalPath;
      } else if (route.endsWith(SOURCE_EXT)) {
        const specifier = route.slice(0, -SOURCE_EXT.length);
        typedSpecifiers.add(specifier);
        getOrCreateEntry(specifier).entry.sourceFile = physicalPath;
      } else if (route.endsWith(JS_EXT)) {
        jsRoutes.push({ route, physicalPath, bareSpecifier: route.slice(0, -JS_EXT.length) });
      }
    }

    for (const { route, physicalPath, bareSpecifier } of jsRoutes) {
      if (typedSpecifiers.has(bareSpecifier)) continue;
      getOrCreateEntry(route).entry.sourceFile = physicalPath;
    }

    return entryMap;

    // helpers
    function getOrCreateEntry(specifier: string): EntryData {
      const slashIdx = specifier.indexOf('/');
      const packageName = slashIdx === -1 ? specifier : specifier.slice(0, slashIdx);
      const subpath = slashIdx === -1 ? '' : specifier.slice(slashIdx + 1);
      const entryKey = `${packageName}:${subpath}`;
      let entryData = entryMap.get(entryKey);
      if (!entryData) {
        entryData = { entry: { subpath }, packageName };
        entryMap.set(entryKey, entryData);
      }
      return entryData;
    }
  }
}
