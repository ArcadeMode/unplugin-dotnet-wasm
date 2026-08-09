import type { AssetResolver } from '../asset-resolution/asset-resolver';

const SOURCE_EXT = '.ts';
const DECL_EXT = '.d.ts';
const JS_EXT = '.js';

export interface DiscoveryEntry {
  /** Owns the physical shim file. Bare (extension-less) wins when present. */
  canonical: string;
  aliases: string[];
  sourceFile?: string;
  definitionFile?: string;
}

export interface DiscoveryGroup {
  packageName: string;
  entries: DiscoveryEntry[];
}

interface BaseFiles {
  js?: string;
  ts?: string;
  dts?: string;
}

interface ExportUnit {
  specifier: string;
  sourceFile?: string;
  definitionFile?: string;
}

interface EntryDraft {
  subpaths: string[];
  sourceFile?: string;
  definitionFile?: string;
}

export class FileDiscoverer {
  constructor(private readonly resolver: AssetResolver) {}

  discover(): DiscoveryGroup[] {
    const exports = this.buildExports();
    const groupMap = new Map<string, Map<string, EntryDraft>>();
    const order: string[] = [];

    for (const unit of exports) {
      const { packageName, subpath } = splitSpecifier(unit.specifier);
      const source = unit.definitionFile ?? unit.sourceFile!;

      let bySource = groupMap.get(packageName);
      if (!bySource) {
        bySource = new Map();
        groupMap.set(packageName, bySource);
        order.push(packageName);
      }
      let draft = bySource.get(source);
      if (!draft) {
        draft = { subpaths: [] };
        if (unit.definitionFile !== undefined) draft.definitionFile = unit.definitionFile;
        else if (unit.sourceFile !== undefined) draft.sourceFile = unit.sourceFile;
        bySource.set(source, draft);
      }
      draft.subpaths.push(subpath);
    }

    return order.map((packageName) => ({
      packageName,
      entries: [...groupMap.get(packageName)!.values()].map(finalizeEntry),
    }));
  }

  private buildExports(): ExportUnit[] {
    const bases = this.collectBases();
    const exports: ExportUnit[] = [];

    for (const [base, files] of bases) {
      if (files.js) {
        exports.push({ specifier: base + JS_EXT, ...contentFor(files, files.js) });
      }
      if (files.ts) {
        exports.push({ specifier: base + SOURCE_EXT, ...contentFor(files, files.ts) });
      }
      const bareRuntime = files.ts ?? files.js;
      if (bareRuntime) {
        exports.push({ specifier: base, ...contentFor(files, bareRuntime) });
      } else if (files.dts) {
        exports.push({ specifier: base, definitionFile: files.dts });
      }
    }

    return exports;
  }

  private collectBases(): Map<string, BaseFiles> {
    const bases = new Map<string, BaseFiles>();

    const record = (base: string, kind: keyof BaseFiles, physicalPath: string): void => {
      if (base === '') return;
      let files = bases.get(base);
      if (!files) {
        files = {};
        bases.set(base, files);
      }
      files[kind] = physicalPath;
    };

    for (const route of this.resolver.routes()) {
      const physicalPath = this.resolver.resolve(route);
      if (physicalPath === null) continue;

      if (route.endsWith(DECL_EXT)) {
        record(route.slice(0, -DECL_EXT.length), 'dts', physicalPath);
      } else if (route.endsWith(SOURCE_EXT)) {
        record(route.slice(0, -SOURCE_EXT.length), 'ts', physicalPath);
      } else if (route.endsWith(JS_EXT)) {
        record(route.slice(0, -JS_EXT.length), 'js', physicalPath);
      }
    }

    return bases;
  }
}

function contentFor(
  files: BaseFiles,
  runtimeFile: string,
): { definitionFile: string } | { sourceFile: string } {
  return files.dts ? { definitionFile: files.dts } : { sourceFile: runtimeFile };
}

function splitSpecifier(specifier: string): { packageName: string; subpath: string } {
  const slashIdx = specifier.indexOf('/');
  return slashIdx === -1
    ? { packageName: specifier, subpath: '' }
    : { packageName: specifier.slice(0, slashIdx), subpath: specifier.slice(slashIdx + 1) };
}

function isBare(subpath: string): boolean {
  return !subpath.endsWith(JS_EXT) && !subpath.endsWith(SOURCE_EXT);
}

function finalizeEntry(draft: EntryDraft): DiscoveryEntry {
  const candidates = [...draft.subpaths].sort((a, b) => a.localeCompare(b));
  const canonical = candidates.find(isBare) ?? candidates[0]!;
  const aliases = candidates.filter((s) => s !== canonical);
  const entry: DiscoveryEntry = { canonical, aliases };
  if (draft.definitionFile !== undefined) entry.definitionFile = draft.definitionFile;
  if (draft.sourceFile !== undefined) entry.sourceFile = draft.sourceFile;
  return entry;
}
