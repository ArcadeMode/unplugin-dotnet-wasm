import { z } from 'zod';

// Zod schemas with the shape of {Project}.staticwebassets.runtime.json

const ManifestAssetSchema = z.object({
  ContentRootIndex: z.number().int().nonnegative(),
  SubPath: z.string().min(1),
});

const ManifestPatternSchema = z.object({
  ContentRootIndex: z.number().int().nonnegative(),
  Pattern: z.string(),
  Depth: z.number().int().nonnegative(),
});

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
  ContentRoots: z.array(z.string().min(1)),
  Root: ManifestNodeSchema,
});

export type ManifestAsset = z.infer<typeof ManifestAssetSchema>;
export type ManifestPattern = z.infer<typeof ManifestPatternSchema>;
export type { ManifestNode };
export type RuntimeManifest = z.infer<typeof RuntimeManifestSchema>;

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
      (i) => `  • ${i.path.join('.')} - ${i.message}`,
    );
    throw new ManifestParseError(
      `staticwebassets.runtime.json failed schema validation:\n${issues.join('\n')}`,
      result.error.issues,
    );
  }

  return result.data;
}

export class ManifestParseError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(message: string, issues: z.ZodIssue[]) {
    super(message);
    this.name = 'ManifestParseError';
    this.issues = issues;
  }
}
