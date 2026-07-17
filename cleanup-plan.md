# Cleanup plan

A prioritized list of suggested fixes from a code-quality pass over the plugin
(`unplugin-dotnet-wasm/src`). Nothing here is a blocking defect for the intended
`.NET` SDK inputs — this is a tidy-up backlog, ordered by payoff. Paths are
relative to the repo root; line numbers reflect the state at time of writing and
may drift.

## Legend

- **[correctness]** — latent behavioral gap; masked today by fixtures/platform, could bite later.
- **[tests]** — the test asserts less than it claims, or is redundant.
- **[structure]** — over-decomposition / dead code / inconsistency.
- **[cosmetic]** — comments, naming, formatting.

---

## 1. Correctness risks

These are not crashes and no current test exercises them; the fixtures are all
lowercase and pre-normalised, which is exactly why they slip through.

### 1.1 [correctness] VFS is case-insensitive but the endpoint lookup is case-sensitive
- **Where:** `src/core/asset-resolution/vfs.ts` lowercases keys (~L79, L163, L169);
  `src/core/asset-resolution/endpoint-lookup.ts:34` keys without `toLowerCase`.
- **Symptom:** In `AssetResolver.resolve`, the same `probe` string is fed to both
  maps. A specifier whose case differs from the manifest route hits the VFS but
  misses the endpoint (fingerprint) alias. On Windows the on-disk stat masks it;
  on Linux CI it can diverge.
- **Fix:** Decide on one policy. Either lowercase endpoint-lookup keys and lookups
  to match the VFS, or make the VFS case-sensitive. Add a test with a mixed-case
  specifier against a lowercase manifest route to lock the decision in.

### 1.2 [correctness] `resolve()` and `headersFor()` normalise differently
- **Where:** `src/core/asset-resolution/asset-resolver.ts:25` (`resolve` uses full
  `normalizeVirtualPath`, collapsing `.`/`..`) vs `:46` (`headersFor` uses only
  `stripLeadingSlashOrDot(toPosixPath(...))`).
- **Symptom:** A dev-server request like `/_framework/./dotnet.js` can resolve to an
  asset but return **no headers**, because the header lookup key won't match.
- **Fix:** Route both through the same normalisation helper. Add a test with a
  non-canonical (`./`, double-slash) path asserting resolve + headers agree.

### 1.3 [correctness] `304 Not Modified` keeps the full-body `Content-Length`
- **Where:** `src/core/dev-server/asset-middleware.ts:41-50`. `Content-Length` is set
  to the real file size, then the ETag branch sends `304`/`end()` without clearing it.
- **Symptom:** Off-spec `304` (non-empty `Content-Length`, empty body); can confuse
  strict clients. Dev-server only, low severity.
- **Fix:** Remove the `Content-Length` header (or set it after the 304 short-circuit).
  Extend the existing 304 test (`asset-middleware.test.ts:136`) to assert the header is absent.

### 1.4 [correctness] Regex JS rewriting is fragile to whitespace/formatting
- **Where:** `src/core/bundler-compat-rewriter.ts:35-53`. `\bnew URL\s*\(` in practice
  matches a single literal space in the pragma-insertion path; `new  URL(` or
  `new\nURL(` would be missed, and an `import(` inside a string literal would be
  rewritten.
- **Note:** Inherent to string-level JS munging and scoped narrowly to trusted .NET
  SDK output, so this is a *contained* risk, not a live bug.
- **Fix (optional):** Add a regression test pinning the SDK output shapes we rely on,
  so a future SDK formatting change fails loudly rather than silently no-op'ing.

---

## 2. Test quality

### 2.1 [tests] `transform (FRAMEWORK_JS_REGEX scoping)` tests don't test scoping
- **Where:** `src/unplugin/index.test.ts:184-211`.
- **Problem:** The block is named for scoping, but `transform.handler` (`index.ts:30`)
  only takes `code` — the path argument is dead, and the `filter` that does the actual
  scoping is never invoked. The assertions pass only because the rollup rewriter has no
  pragma and returns `null` for any input. They would pass for any `id`.
- **Fix:** Either drive the `transform.filter` against framework vs non-framework paths
  to prove scoping, or rename the block to what it actually verifies (rewriter no-op on
  rollup) and drop the misleading path argument.

### 2.2 [tests] Vacuously-passing fingerprint-alias test
- **Where:** `src/core/asset-resolution/endpoint-lookup.test.ts:84-85` (author flagged it
  with a `TODO` and an early `return`).
- **Problem:** The one test covering the core fingerprint→canonical `label` aliasing can
  pass without asserting anything, depending on how the fixture was built.
- **Fix:** Parameterise on fingerprint mode (or add a fingerprinted fixture) so the test
  either runs the assertion or is explicitly skipped — never silently green.

### 2.3 [tests] Redundant / trivial tests to prune
- `src/core/manifest-parsing/discover.test.ts:14-28` — two cases call `discoverManifests`
  with identical options and assert the same result.
- `src/core/type-shims/source-file-change-tracker.test.ts:50-58` — behaviourally identical
  to `:18-27` (same call sequence, same assertion).
- `src/core/type-shims/shim-package.test.ts:14-20` — asserts `pkg.dir === join(...)`, i.e.
  tests `path.join`.
- `src/core/asset-resolution/extension-probes.test.ts:33-36` — verifies iterator-protocol
  freshness rather than domain behaviour.
- **Fix:** Delete the duplicates; keep the one that carries the intent.

### 2.4 [tests] Fixture sentinel drift
- **Where:** `src/core/type-shims/shim-package-generator.test.ts:101` writes
  `'# Generated by unplugin-dotnet-wasm - ...'` while the real sentinel
  (`shim-package-generator.ts:13`) is `'Generated by unplugin-dotnet-wasm. Provides ...'`.
- **Impact:** Harmless (the checker only tests existence), but the fixture was hand-edited
  away from the source of truth.
- **Fix:** Import/reference the real sentinel constant in the test instead of retyping it.

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

### 4.2 [cosmetic] Log prefix doesn't match the package name
- **Where:** `src/core/logger.ts:20` uses `[dotnet-static-assets]`; the plugin is
  `unplugin-dotnet-wasm` (leftover from the rename commit).
- **Fix:** Align the prefix (and any user-facing message strings) to the current name.

### 4.3 [cosmetic] Stale planning comment
- **Where:** `src/index.ts` — *"Implementation begins in M1.2 (manifest parser)."*
- **Fix:** Remove the milestone scaffolding comment.

### 4.4 [cosmetic] Comment/impl drift
- `src/core/asset-resolution/vfs.ts:57-63` — comment says `isFile` returns true "iff ...
  a regular file", but `!isDirectory()` is also true for symlinks/FIFOs/sockets. Reword or
  tighten the check. (Also fix the "negiligible" typo.)
- `src/core/type-shims/idempotent-file-writer.ts:5-7` — `/** Doesnt write the content of the
  file wouldnt change. */` is grammatically broken. Reword to "Skips the write if the content
  wouldn't change."

---

## Suggested order of work

1. **Correctness first:** 1.1 and 1.2 (add proving tests as you go), then 1.3.
2. **Test integrity:** 2.1 and 2.2 (these currently give false confidence), then prune 2.3/2.4.
3. **Dead code / consistency:** 3.1 and 3.2.
4. **Everything else** as a single formatting/cosmetic sweep (4.x + the minor 3.x nits),
   ideally after wiring up Prettier (4.1) so the diff is mechanical.

Each item is independent; none require structural rework.
