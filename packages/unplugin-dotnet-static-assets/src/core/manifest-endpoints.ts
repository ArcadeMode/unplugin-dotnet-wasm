import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schemas — mirror the exact shape of
// {Project}.staticwebassets.endpoints.json emitted by Microsoft.NET.Sdk.WebAssembly
// ---------------------------------------------------------------------------

/**
 * A single content-negotiation selector (e.g. Accept-Encoding: br).
 * Present when CompressionEnabled=true; empty array in the common case.
 */
const SelectorSchema = z.object({
  Name: z.string(),
  Value: z.string(),
  Quality: z.string().optional(),
});

/**
 * An HTTP response header the server should send for this route.
 * Observed Name values: Cache-Control, Content-Length, Content-Type,
 * ETag, Last-Modified.  Unknown names are accepted verbatim.
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

/**
 * A single entry in the endpoints manifest — describes one public-facing URL
 * and how its bytes should be served.
 */
const EndpointSchema = z.object({
  /**
   * Public-facing URL path relative to the app root (no leading slash).
   * The same AssetFile can have multiple routes:
   *   - canonical row  (`_framework/Library.wasm`)        → Cache-Control: no-cache
   *   - fingerprinted row (`_framework/Library.<fp>.wasm`) → Cache-Control: immutable
   */
  Route: z.string(),
  /**
   * Physical file path relative to the active content root (Mode A) or
   * publishDir (Mode B).  May differ from Route when fingerprinting is on.
   */
  AssetFile: z.string(),
  /** Content-negotiation selectors. Empty in no-compression builds. */
  Selectors: z.array(SelectorSchema),
  /** HTTP headers to be sent verbatim (Content-Length and Last-Modified
   *  may be stale in the dev server; recompute from the file system there). */
  ResponseHeaders: z.array(ResponseHeaderSchema),
  /** Non-header metadata: integrity, fingerprint, label, preload hints, etc. */
  EndpointProperties: z.array(EndpointPropertySchema),
});

const EndpointsManifestSchema = z.object({
  /** Currently 1. */
  Version: z.number().int().positive(),
  /** "Build" or "Publish". Informational; both shapes are accepted. */
  ManifestType: z.string(),
  Endpoints: z.array(EndpointSchema),
});

// ---------------------------------------------------------------------------
// Exported types (inferred — no hand-written duplicates)
// ---------------------------------------------------------------------------

export type Selector = z.infer<typeof SelectorSchema>;
export type ResponseHeader = z.infer<typeof ResponseHeaderSchema>;
export type EndpointProperty = z.infer<typeof EndpointPropertySchema>;
export type Endpoint = z.infer<typeof EndpointSchema>;
export type EndpointsManifest = z.infer<typeof EndpointsManifestSchema>;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse the contents of a `{Project}.staticwebassets.endpoints.json` file.
 *
 * Throws a descriptive {@link EndpointsManifestParseError} when the input is
 * invalid JSON or does not conform to the expected schema.
 */
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

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class EndpointsManifestParseError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(message: string, issues: z.ZodIssue[]) {
    super(message);
    this.name = 'EndpointsManifestParseError';
    this.issues = issues;
  }
}
