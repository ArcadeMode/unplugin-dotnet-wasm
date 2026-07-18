import type {
  Endpoint,
  EndpointsManifest,
  ResponseHeader,
} from '../manifest-parsing/manifest-endpoints';
import { normalizePath } from '../path-utils';
import { PathLookup, DuplicatePathError } from './path-lookup';

export { DuplicatePathError };

export interface EndpointMatch {
  /** Physical file path relative to the .NET application root */
  readonly assetFile: string;
  /** Hash token */
  readonly fingerprint?: string;
  /**
   * If present, this is a fingerprinted endpoint and the label points back to the canonical route.
   */
  readonly label?: string;
  readonly responseHeaders: readonly ResponseHeader[];
}

export class EndpointLookup extends PathLookup<EndpointMatch> {
  constructor(manifest?: EndpointsManifest) {
    super();
    if (manifest) this.#build(manifest);
  }

  #build(manifest: EndpointsManifest): void {
    for (const endpoint of manifest.Endpoints) {
      if (isCompressed(endpoint)) continue;
      const route = normalizePath(endpoint.Route);
      const assetFile = normalizePath(endpoint.AssetFile).path;
      this.set(route, extractMatch(assetFile, endpoint));
    }
  }
}

function isCompressed(endpoint: Endpoint): boolean {
  return endpoint.Selectors.some((s) => s.Name === 'Content-Encoding');
}

function extractMatch(assetFile: string, endpoint: Endpoint): EndpointMatch {
  let fingerprint: string | undefined;
  let label: string | undefined;

  for (const prop of endpoint.EndpointProperties) {
    switch (prop.Name) {
      case 'fingerprint':
        fingerprint = prop.Value;
        break;
      case 'label':
        label = prop.Value;
        break;
    }
  }

  let result: EndpointMatch = { assetFile, responseHeaders: endpoint.ResponseHeaders };
  if (fingerprint !== undefined) result = { ...result, fingerprint };
  if (label !== undefined) result = { ...result, label };
  return result;
}
