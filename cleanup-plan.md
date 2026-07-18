# Cleanup plan

A prioritized list of suggested fixes from a code-quality pass over the plugin
(`unplugin-dotnet-wasm/src`). Nothing here is a blocking defect for the intended
`.NET` SDK inputs — this is a tidy-up backlog, ordered by payoff. Paths are
relative to the repo root; line numbers reflect the state at time of writing and
may drift.

> The correctness pass (§1: casing/normalisation unification, `304` `Content-Length`,
> regex regression test) and the test-integrity pass (§2) have been completed and
> removed. What remains is structure and cosmetics.

## Legend

- **[structure]** — over-decomposition / dead code / inconsistency.
- **[cosmetic]** — comments, naming, formatting.

---

## 3. Structure & dead code

### 3.1 [structure] Dead `logger` injection in `FileDiscoverer`
- **Where:** `src/core/type-shims/file-discoverer.ts:20-24`. `this.logger` is never used
  (every caller and test still constructs and passes one).
- **Fix:** Remove the parameter and update callers (`unplugin/context.ts`, tests), or
  actually log the skipped/ambiguous routes the JSDoc implies.

### 3.2 [structure] Inconsistent CJS-interop export across the 9 entrypoints
- **Where:** `vite.ts`, `rollup.ts`, `rolldown.ts`, `webpack.ts`, `rspack.ts` carry
  `export { DotnetAssets as 'module.exports' }`; `esbuild.ts`, `rsbuild.ts`, `farm.ts`,
  `bun.ts` are bare `export default` with no such alias and no explanation.
- **Impact:** Either a latent `require()`-interop gap for four bundlers, or intentional and
  undocumented.
- **Fix:** Make it uniform, or add a one-line comment on the four bare files explaining why
  they differ (e.g. config-callable vs object-consumed).

### 3.3 [structure] `type-shims/` is fragmented into many micro-classes
- **Where:** `src/core/type-shims/` — 8 classes + 8 test files; several are ~18-28 lines
  (`SourceFileChangeTracker`, `IdempotentFileWriter`, `NodeModulesLocator`,
  `PackageCollisionChecker`, `ShimPackage`).
- **Note:** Cohesive and testable, so this is judgment-call territory, not a defect.
- **Fix (optional):** Consider merging the thinnest wrappers (e.g. fold `NodeModulesLocator`'s
  memoised lookup into its single consumer) to reduce surface. Low priority.

### 3.4 [structure] Defensive throws for states the only caller can't produce
- **Where:** `src/core/type-shims/ts-definition-emitter.ts:19-24, 33-35` (asserts `.d.ts`
  suffix + absolute path, both already guaranteed by `FileDiscoverer`).
- **Fix:** Either drop them, or keep them and add a short comment framing them as
  public-API guards (they're currently unreachable and untested).

### 3.5 [structure] Duplicated inline type literal
- **Where:** `src/core/type-shims/shim-package-generator.ts:65-66` — the entry-array type
  `{ subpath: string; relFile: string; absFile: string; dts?: string }[]` is written twice.
- **Fix:** Extract a named type.

### 3.6 [structure] Redundant `existsSync` call
- **Where:** `src/core/asset-resolution/vfs.ts:225-226` — `existsSync(wwwroot)` is called
  twice for one branch decision.
- **Fix:** Compute once into a local.

### 3.7 [structure] `endpoint-lookup` cast-mutation idiom
- **Where:** `src/core/asset-resolution/endpoint-lookup.ts:70-73` — builds an object then
  mutates a `readonly`-typed value through a cast to satisfy `exactOptionalPropertyTypes`.
- **Fix:** Use conditional spreads to build the object in one expression.

---

## 4. Cosmetic

### 4.1 [cosmetic] Prettier is configured but not enforced
- **Where:** `.prettierrc` exists, but `prettier` is not in `devDependencies` and there is
  no `format` script. This is why `src/core/bundler-compat-rewriter.ts:66-68`
  (`isWebpackFamily`) has an un-indented body.
- **Fix:** Add `prettier` + a `format` / `format:check` script (and ideally a lint-staged or
  CI check), then run it once across `src`.

---

## Suggested order of work

1. **Dead code / consistency:** 3.1 and 3.2.
2. **Tooling:** wire up Prettier (4.1) and run it once across `src` so future formatting
   diffs are mechanical.

Each item is independent; none require structural rework.
