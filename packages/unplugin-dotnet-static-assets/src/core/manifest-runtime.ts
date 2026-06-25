import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schemas — mirror the exact shape of
// {Project}.staticwebassets.runtime.json emitted by Microsoft.NET.Sdk.WebAssembly
// ---------------------------------------------------------------------------

const ManifestAssetSchema = z.object({
  /** Index into the top-level ContentRoots array. */
  ContentRootIndex: z.number().int().nonnegative(),
  /** Path relative to the content root (POSIX or Windows separators). */
  SubPath: z.string().min(1),
});

const ManifestPatternSchema = z.object({
  ContentRootIndex: z.number().int().nonnegative(),
  /** Glob pattern relative to the content root. */
  Pattern: z.string(),
  /** Nesting depth hint produced by the SDK. */
  Depth: z.number().int().nonnegative(),
});

// ManifestNodeSchema is self-referential; z.lazy() breaks the cycle.
type ManifestNode = {
  Children: Record<string, ManifestNode> | null;
  Asset: z.infer<typeof ManifestAssetSchema> | null;
  Patterns: z.infer<typeof ManifestPatternSchema>[] | null;
};

const ManifestNodeSchema: z.ZodType<ManifestNode> = z.lazy(() =>
  z.object({
    Children: z.record(z.string(), ManifestNodeSchema).nullable(),
    Asset: ManifestAssetSchema.nullable(),
    Patterns: z.array(ManifestPatternSchema).nullable(),
  }),
);

const RuntimeManifestSchema = z.object({
  /**
   * Ordered list of absolute directory paths.
   * Each Asset references one of these by index.
   */
  ContentRoots: z.array(z.string().min(1)),
  Root: ManifestNodeSchema,
});

// ---------------------------------------------------------------------------
// Exported types (inferred — no hand-written duplicates)
// ---------------------------------------------------------------------------

export type ManifestAsset = z.infer<typeof ManifestAssetSchema>;
export type ManifestPattern = z.infer<typeof ManifestPatternSchema>;
export type { ManifestNode };
export type RuntimeManifest = z.infer<typeof RuntimeManifestSchema>;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse the contents of a `{Project}.staticwebassets.runtime.json` file.
 *
 * Throws a descriptive {@link ManifestParseError} when the input is invalid
 * JSON or does not conform to the expected schema.
 */
export function parseRuntimeManifest(input: string | Buffer): RuntimeManifest {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : input;

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ManifestParseError(
      `staticwebassets.runtime.json is not valid JSON: ${(err as Error).message}`,
      [],
    );
  }

  const result = RuntimeManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `  • ${i.path.join('.')} — ${i.message}`,
    );
    throw new ManifestParseError(
      `staticwebassets.runtime.json failed schema validation:\n${issues.join('\n')}`,
      result.error.issues,
    );
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ManifestParseError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(message: string, issues: z.ZodIssue[]) {
    super(message);
    this.name = 'ManifestParseError';
    this.issues = issues;
  }
}
