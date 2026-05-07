# ADR 001: Pointsman m4l — base (initial migration from cloned source)

## Status: Proposed

**Created**: 2026-05-07

This ADR is the migration spec that takes the Pointsman repository
from its cloned-source bootstrap state to proper Pointsman shape:
single-product m4l workspace, single-product bake, no TM assets,
GitHub upstream live.

## Context

This repository was bootstrapped on 2026-05-07 by cloning
`~/src/vst/stencil` at commit `dc00191`. The clone preserved git
history, the JUCE submodule reference, and all working state.
That state was a dual-product layout (TM + QT in one tree) — the
correct shape for the source repo, but not for Pointsman.
Pointsman is a single-product repository: scale quantizer for
MIDI, m4l + vst targets.

The clone is a one-time bootstrap event; from this commit
forward, Pointsman has no ongoing dependency on the source repo.
Pointsman's design decisions, ADR set, code, and release cadence
are independent.

The work to bring the cloned tree to Pointsman shape is
non-trivial and worth tracking under one explicit checklist —
multiple coordinated rename / extract / delete passes that need
to land before tests, builds, and bake scripts pass. This ADR is
that checklist.

## Decision

Execute the migration as a single coherent sequence in this
repository. Verification (`pnpm install` + tests + typecheck +
build + bake + bake:check) is the closing step before the final
GitHub push. Fail-closed: do not push the migration commits until
verification passes.

The repo's `vst/Source/` is left untouched as the cloned scaffold
state; it is rewritten when Pointsman vst work begins under a
per-product vst-architecture ADR.

## Scope

### In scope

- Filesystem rename / extract / delete operations to bring the
  cloned tree to single-product Pointsman shape
- RNG primitive extraction from `turing.ts` into a shared `rng.ts`
- Bake script simplification (single-product, no argv)
- Doc rewrite (`CLAUDE.md`, `concept.md` narrowed; Pointsman ADR
  series replacing the inherited ADR set)
- GitHub remote setup + initial seed push
- Verification (test / typecheck / build / bake) + final
  post-migration push

### Out of scope

- **`vst/Source/`** — left as the cloned scaffold; rewritten
  when Pointsman vst work begins under a per-product
  vst-architecture ADR.
- **Pointsman base architecture as a dedicated ADR** — deferred
  to a follow-up Pointsman ADR or absorbed into the narrowed
  `docs/ai/concept.md`. This ADR is the migration spec only.
- **Pointsman m4l v1 release verification + distribution** —
  ADR 002.

## Implementation checklist

Items prefixed `[x]` are complete. Items prefixed `[ ]` remain.

### 1. Repo bootstrap

- [x] `git clone ~/src/vst/stencil ~/src/vst/pointsman`
- [x] `git submodule update --init --recursive` (materialize the
      JUCE submodule)
- [x] Provision GitHub private repo `im9/pointsman`
- [x] Replace `pointsman/.git/config` `[remote "origin"]` URL
      (currently points at `/Users/tn/src/vst/stencil` from the
      local clone) with the GitHub URL for `im9/pointsman`
- [x] `git push -u origin main` — initial seed push of the
      cloned + this-session state to GitHub

### 2. Rename surface (m4l/)

- [x] Rename `m4l/Stencil-QT.maxpat` → `m4l/Pointsman.maxpat`
- [x] Rename `m4l/stencil-qt.mjs` → `m4l/pointsman.mjs`; update
      its internal `host-qt/dist/` references to `host/dist/`
- [x] Update the patcher's `[node.script]` `filename` attribute
      to `pointsman.mjs`
- [x] Rename `m4l/host-qt/` → `m4l/host/`
- [x] Update `m4l/host/package.json` `name`: `@stencil/host-qt`
      → `@pointsman/host`
- [x] Update `m4l/host/tsconfig.json` paths to reflect the
      rename (no path-string changes needed: `rootDir: "../"`
      and bare `host.ts` includes already resolve correctly
      after the directory rename)
- [x] Update relative imports inside `m4l/host/` (sibling
      package references, etc.) — none required; comments
      referencing `host-qt`/`stencil-qt.mjs` were updated for
      consistency
- [x] Update workspace-root `m4l/package.json` `name`:
      `@stencil/m4l` → `@pointsman/m4l`
- [x] Edit `m4l/pnpm-workspace.yaml`: drop the `host-tm` entry
      and rename `host-qt` → `host`
- [x] Rename `m4l/engine/package.json` `name`: `@stencil/engine`
      → `@pointsman/engine` (added: per CLAUDE.md target
      package layout)
- [x] Rename `m4l/scripts/package.json` `name`:
      `@stencil/scripts` → `@pointsman/scripts` (added: same
      reason)

### 3. RNG extract (m4l/engine/)

- [x] Extract RNG primitives (`seedRng`, `nextU32`, types
      `RngState`) from `m4l/engine/turing.ts` into
      `m4l/engine/rng.ts` (copied, not moved — `turing.ts`
      is deleted wholesale in §4, so the in-place refactor
      would be throwaway work)
- [x] Re-point `m4l/engine/quantizer.ts` and
      `m4l/host/humanize.ts` imports to `./rng` (only
      `humanize.ts` needed updating; `quantizer.ts` has no
      RNG-import — the ADR over-specified). Also updated
      `m4l/host/tsconfig.json` include: `../engine/turing.ts`
      → `../engine/rng.ts`
- [x] Generate `docs/ai/rng-test-vectors.json` from the seed/step
      prefix of `docs/ai/turing-test-vectors.json` (forked via
      `jq`; keeps `splitmix64_init` + `prng` arrays + matching
      `meta.{prng,seeding}` entries)
- [x] Add `m4l/engine/rng.test.ts` running against the new
      vectors (mirrors the two RNG tests from
      `m4l/engine/turing.test.ts`)

### 4. TM-only asset delete

The cloned tree carries TM-side assets that are not Pointsman's
concern. Delete:

- [ ] `m4l/Stencil-TM.maxpat`
- [ ] `m4l/Stencil-TM.amxd`
- [ ] `m4l/Stencil-TM Project/` (Live's auto-generated project
      folder for the TM device)
- [ ] `m4l/stencil-tm.mjs`
- [ ] `m4l/host-tm/`
- [ ] `m4l/engine/turing.ts`
- [ ] `m4l/engine/turing.test.ts`
- [ ] `m4l/registerRing.jsui.js`
- [ ] `m4l/registerRing.subpatcher.maxpat`
- [ ] `docs/ai/turing-test-vectors.json`

### 5. Doc rewrite

- [x] Replace `CLAUDE.md` with Pointsman content
- [ ] Narrow `docs/ai/concept.md` to Pointsman (drop TM
      sections; retain MIDI semantics and humanize content)

### 6. ADR set replace

- [x] Author `docs/ai/adr/001-pointsman-base.md` (this file)
- [x] Author `docs/ai/adr/002-pointsman-release.md` (Pointsman
      m4l v1 release verification + distribution)
- [x] Author `docs/ai/adr/INDEX.md` (Pointsman-scoped ADR index)
- [x] `git rm` the ADRs inherited from the bootstrap clone (not
      part of Pointsman's decision history):
  - `docs/ai/adr/archive/001-engine-interface.md`
  - `docs/ai/adr/archive/002-m4l-architecture.md`
  - `docs/ai/adr/archive/003-m4l-ui-design.md`
  - `docs/ai/adr/archive/004-m4l-bake-distribution.md`
  - `docs/ai/adr/005-product-split.md`
  - `docs/ai/adr/006-m4l-release-verification.md`
  - the inherited `docs/ai/adr/INDEX.md`

### 7. Bake script simplification

- [ ] Simplify `m4l/scripts/maxpat-to-amxd.mjs` to single-product
      shape (no argv; fixed I/O `Pointsman.maxpat` →
      `Pointsman.amxd`)
- [ ] Update guard tests to drop per-device branching
- [ ] Collapse `bake:tm` / `bake:qt` / `bake:check:tm` /
      `bake:check:qt` scripts in `m4l/package.json` to a single
      `bake` / `bake:check`

### 8. Verification

- [ ] From `m4l/`: `pnpm install` (the clone does not bring
      `node_modules`)
- [ ] `pnpm -r test` — all green
- [ ] `pnpm -r typecheck` — all green
- [ ] `pnpm -r build` — all green; refreshes `dist/`
- [ ] `pnpm bake` — produces `m4l/Pointsman.amxd`
- [ ] `pnpm bake:check` — passes (abs-path scrub, sibling-file
      resolve)

### 9. Final push

- [ ] `git push origin main` once §1–§8 are all `[x]` (lands the
      Pointsman repo at its single-product state on GitHub)

## Verification

This ADR is itself a migration spec; the §Implementation
checklist above (specifically §8) is the verification gate.
There is no separate verification step.

The ADR flips to *Implemented* and archives once every checkbox
in §1–§9 is `[x]`. After that point, this repository is in the
post-migration single-product state and ready for ongoing
Pointsman work.
