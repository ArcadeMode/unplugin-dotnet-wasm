# Lockfile CI policy — parked

## Context

`.github/workflows/validate.yml` currently uses bare `pnpm install` in every job.
The new `format` job added alongside `unit` also uses bare `pnpm install` to match.

Bare `pnpm install` will opportunistically update `pnpm-lock.yaml` if it's out of sync
with any `package.json`, meaning CI can silently drift from the committed lockfile.

## Options to revisit

1. **`pnpm install --frozen-lockfile`** in every CI job. Fails fast on drift; forces
   contributors to keep `pnpm-lock.yaml` in sync with `package.json`. Standard best
   practice for CI.
2. **`pnpm install --frozen-lockfile --ignore-scripts`** in the `format` job only, for
   a faster, minimal install (no postinstall hooks like esbuild/playwright download).
3. **Add a `lockfile-check` job** that runs `pnpm install --frozen-lockfile` early
   with no further work, purely as a drift detector.

## Decision

Deferred. Address as a follow-up alongside any dependency-hygiene work.
