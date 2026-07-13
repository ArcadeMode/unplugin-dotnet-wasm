# Type-shim cleanup plan

Follow-ups from the type-resolution review. Scoped to real, low-risk fixes in the
`type-shims` module and its docs. Issue #1 (sentinel migration lockout) is deliberately
**out of scope** — there are no existing users, so no pre-sentinel output to migrate.

Each item below is independent and can land in its own commit.

---

## 2. `typescript` dependency declaration

**Problem.** The emitter resolves `typescript` exclusively from the *consumer's*
`node_modules` (`TsDefinitionEmitter.load()` via `createRequire`), warning and skipping if
it is absent. But `package.json` lists `typescript` only under `devDependencies`, so a
consumer gets no signal that installing it unlocks editor/tsc type support.

**Fix.**
- Add `typescript` as an **optional `peerDependency`**:
  ```jsonc
  "peerDependencies":     { "typescript": ">=5.0.0", /* …existing… */ },
  "peerDependenciesMeta": { "typescript": { "optional": true }, /* …existing… */ }
  ```
  Keep it in `devDependencies` too (needed to build/test the plugin itself).
- Do **not** add it to runtime `dependencies` — we never load our own copy, and vendoring
  invites version skew with the consumer's language version.

**Acceptance.** `package.json` declares the optional peer; install in a consumer without
`typescript` still builds (types silently skipped, one warning); with `typescript` present,
shims generate. No change to `TsDefinitionEmitter`.

---

## 3. `.d.ts > .ts` precedence when a base has both

**Problem.** `ShimPackageGenerator.discover()` pushes every matching route as its own
`TypeEntry`. If a base yields both `foo.ts` and `foo.d.ts`, both entries share the same
`subpath`; `writePackage` then processes them in route-iteration order and both resolve to
the same `index.d.ts` — so it is **last-write-wins**, not the `.d.ts`-preferred rule the
original plan promised.

**Fix.** Deduplicate by `(pkgName, subpath)` inside `discover()`, preferring `kind === 'dts'`
over `'ts'`:
- Key the group members by subpath; when a collision occurs, keep the `dts` entry and drop
  the `ts` one (a `.d.ts` is authoritative and needs no emit).
- Order-independent: a later `.ts` must not displace an already-selected `.d.ts`.

**Acceptance.** New `shim-package-generator.test.ts` case: resolver yields both `foo.ts` and
`foo.d.ts` for the same base (in both orders) → exactly one entry survives, `kind === 'dts'`,
and the emitter is invoked with the `dts` entry only.

---

## 4. `.d.mts` / `.d.cts` are mangled

**Problem.** `TS_ROUTE = /\.(d\.ts|ts|mts|cts)$/` matches only the trailing `.mts` on
`foo.d.mts`, so `route.replace(TS_ROUTE, '')` leaves `foo.d` — a specifier/subpath with a
stray `.d`. `.d.cts` has the same defect. These are declaration files but get classified as
`kind: 'ts'` and fed to the Program emitter.

**Fix.**
- Extend the extension regex to strip declaration variants fully, longest-match first:
  `/\.(d\.m?ts|d\.c?ts|d\.ts|mts|cts|ts)$/` (or an equivalent that consumes `.d.mts` /
  `.d.cts` before falling back to `.mts` / `.cts`).
- Update `determineTSFileKind()` so `.d.mts` / `.d.cts` classify as `'dts'` (re-export path),
  matching `.d.ts`.
- Verify `TypeEntry`'s `pkgName`/`subpath` split is clean for these (no residual `.d`).

**Acceptance.** New `type-entry.test.ts` cases for `foo.d.mts` and `bar/baz.d.cts`: correct
`pkgName`, `subpath` with no `.d` residue, and `kind === 'dts'`. A generator case confirms a
`.d.mts` route takes the re-export path, not Program emit.

---

## 5. Empty-package litter when all emits fail

**Problem.** `writePackage` calls `ensureCollisionFree()` first, which writes the sentinel
and creates the package dir *before* any entry is emitted. If every entry then returns `null`
(TS unavailable, or emit produced no output), `pkg.emit()` returns `null` and we bail —
leaving `node_modules/<pkg>/.dotnet-wasm-typeshim` as an orphan dir with no `package.json`.

**Fix.** Defer the dir-claiming write until we know at least one entry will be written. Two
viable shapes:
- **Preferred:** compute all `dts` strings first; if none are non-null, return before touching
  the filesystem. Only then run the collision check + writes.
- **Alternative:** keep the collision check up front (still cheap/read-only) but move the
  *sentinel write* to just before the first real file write, guarded by a "have we claimed
  yet" flag.

Whichever shape, the collision **read** (foreign-dir detection) must still happen before any
write, so ownership semantics are unchanged.

**Acceptance.** Extend the existing emit-null test: after `generate()`, assert
`node_modules/<pkg>` does **not** exist (no dir, no sentinel, no `package.json`). Existing
collision + happy-path tests stay green.

---

## 6. Doc drift: parked default-export path

**Problem.** The re-export emitter intentionally emits `export * from '<abs>'` only (default
exports parked, per README Planned item). But the now-deleted plan still described the target
as `export *` **plus** `export { default }`, and that wording may have leaked elsewhere.

**Fix.**
- Confirm the README's "Editor & type support" + Planned #8 (default-export support) wording
  is accurate and self-consistent — it currently is; keep it the single source of truth.
- Grep the repo for any remaining `export { default }` / "default export" claims about the
  re-export path (now that the plan files are gone) and reconcile.
- Optional: a one-line comment at the `dts` branch in `TsDefinitionEmitter.emit()` noting the
  default export is deliberately dropped, linking to README Planned #8, so the omission reads
  as intentional.

**Acceptance.** No doc or code comment claims the generated `_framework/dotnet` re-export
carries a default export; the limitation is documented in exactly one place (README).

---

## Suggested order

4 → 3 (both touch `discover`/`TypeEntry` and share test scaffolding) → 5 (generator write
path) → 2 (packaging) → 6 (docs sweep, last so it captures any comment added in 5). Run
`vitest run` + `tsc --noEmit` after each.
