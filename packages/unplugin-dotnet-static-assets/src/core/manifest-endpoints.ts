import { z } from 'zod';

// Zod schemas that mirror the shape of {Project}.staticwebassets.endpoints.json

const SelectorSchema = z.object({
  Name: z.string(),
  Value: z.string(),
  Quality: z.string().optional(),
});

/**
 * An HTTP response header the server should send for this route.
 * Observed Name values: Cache-Control, Content-Length, Content-Type,
 * ETag, Last-Modified.
 */
const ResponseHeaderSchema = z.object({
  Name: z.string(),
  Value: z.string(),
});

/**
 * Non-header metadata attached to an endpoint.
 *
 * Observed Name values:
 *   - fingerprint        — the hash segment embedded in a fingerprinted route
 *   - integrity          — SRI hash (sha256-…)
 *   - label              — canonical alias for a fingerprinted-route entry
 *   - PreloadAs          — value for <link rel="preload" as="…">
 *   - PreloadCrossorigin — crossorigin attribute value
 *   - PreloadGroup       — logical group (e.g. "webassembly")
 *   - PreloadOrder       — integer sort key within the group
 *   - PreloadPriority    — fetchpriority hint (e.g. "high")
 *   - PreloadRel         — rel value (e.g. "preload")
 *
 * Unknown names are accepted and passed through unchanged.
 */
const EndpointPropertySchema = z.object({
  Name: z.string(),
  Value: z.string(),
});

const EndpointSchema = z.object({
  Route: z.string(),
  AssetFile: z.string(),
  Selectors: z.array(SelectorSchema),
  ResponseHeaders: z.array(ResponseHeaderSchema),
  EndpointProperties: z.array(EndpointPropertySchema),
});

const EndpointsManifestSchema = z.object({
  Version: z.number().int().positive(),
  ManifestType: z.string(),
  Endpoints: z.array(EndpointSchema),
});

export type Selector = z.infer<typeof SelectorSchema>;
export type ResponseHeader = z.infer<typeof ResponseHeaderSchema>;
export type EndpointProperty = z.infer<typeof EndpointPropertySchema>;
export type Endpoint = z.infer<typeof EndpointSchema>;
export type EndpointsManifest = z.infer<typeof EndpointsManifestSchema>;

export function parseEndpointsManifest(input: string | Buffer): EndpointsManifest {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : input;

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new EndpointsManifestParseError(
      `staticwebassets.endpoints.json is not valid JSON: ${(err as Error).message}`,
      [],
    );
  }

  const result = EndpointsManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `  • ${i.path.join('.')} — ${i.message}`,
    );
    throw new EndpointsManifestParseError(
      `staticwebassets.endpoints.json failed schema validation:\n${issues.join('\n')}`,
      result.error.issues,
    );
  }

  return result.data;
}

export class EndpointsManifestParseError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(message: string, issues: z.ZodIssue[]) {
    super(message);
    this.name = 'EndpointsManifestParseError';
    this.issues = issues;
  }
}
