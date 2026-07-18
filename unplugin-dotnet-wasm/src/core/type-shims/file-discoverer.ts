import type { AssetResolver } from '../asset-resolution/asset-resolver';

const SOURCE_EXT = '.ts';
const DECL_EXT = '.d.ts';

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
  constructor(
    private readonly resolver: AssetResolver,
  ) {}

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
    const entryMap = new Map<string, EntryData>();
    for (const route of this.resolver.routes()) {
      let role: 'definition' | 'source' | null = null;
      let stripLen = 0;

      // Test for definition first
      if (route.endsWith(DECL_EXT)) {
        role = 'definition';
        stripLen = DECL_EXT.length;
      } else if (route.endsWith(SOURCE_EXT)) {
        role = 'source';
        stripLen = SOURCE_EXT.length;
      } else {
        continue;
      }

      const physicalPath = this.resolver.resolve(route);
      if (physicalPath === null) continue;

      const specifier = route.slice(0, -stripLen);
      const slashIdx = specifier.indexOf('/');
      const packageName = slashIdx === -1 ? specifier : specifier.slice(0, slashIdx);
      const subpath = slashIdx === -1 ? '' : specifier.slice(slashIdx + 1);

      const entryData = getOrCreateEntry(packageName, subpath);

      if (role === 'definition') {
        entryData.entry.definitionFile = physicalPath;
      } else {
        entryData.entry.sourceFile = physicalPath;
      }
    }

    return entryMap;

    // helpers
    function getOrCreateEntry(packageName: string, subpath: string): EntryData {
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
