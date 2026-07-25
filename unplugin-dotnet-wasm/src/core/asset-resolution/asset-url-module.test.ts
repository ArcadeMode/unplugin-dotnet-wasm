import { describe, expect, it } from 'vitest';
import {
  buildFileUrlModule,
  buildOriginPathModule,
  buildImportProxyModule,
} from './asset-url-module';
import { pathToFileURL } from 'node:url';

describe('buildFileUrlModule', () => {
  it('returns a file:// URL export for an absolute path', () => {
    const physicalPath = 'C:\\bin\\x.wasm';
    const result = buildFileUrlModule(physicalPath);
    const expectedHref = pathToFileURL(physicalPath).href;
    expect(result).toBe(`export default ${JSON.stringify(expectedHref)};`);
  });

  it('exports default with correct format', () => {
    const physicalPath = '/usr/local/bin/dotnet.wasm';
    const result = buildFileUrlModule(physicalPath);
    expect(result).toMatch(/^export default "file:\/\//);
    expect(result).toMatch(/";$/);
  });
});

describe('buildOriginPathModule', () => {
  it('returns a /_framework/ path export', () => {
    const name = 'dotnet.native.wasm';
    const result = buildOriginPathModule(name);
    expect(result).toBe(`export default "/_framework/dotnet.native.wasm";`);
  });

  it('exports default with framework prefix', () => {
    const name = 'some.file.dat';
    const result = buildOriginPathModule(name);
    expect(result).toBe(`export default "/_framework/some.file.dat";`);
  });
});

describe('buildImportMetaUrlModule', () => {
  it('returns an import.meta.url resolution module', () => {
    const innerSpecifier = '/x/y.wasm';
    const result = buildImportProxyModule(innerSpecifier);
    expect(result).toBe(
      `import u from "/x/y.wasm";\nexport default new URL(u, import.meta.url).href;`,
    );
  });

  it('correctly encodes the inner specifier', () => {
    const innerSpecifier = './assets/file.wasm';
    const result = buildImportProxyModule(innerSpecifier);
    expect(result).toContain(`import u from "./assets/file.wasm";`);
    expect(result).toContain(`export default new URL(u, import.meta.url).href;`);
  });
});
