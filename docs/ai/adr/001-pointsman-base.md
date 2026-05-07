# ADR 001: Pointsman m4l — base (clone-from-Stencil migration)

## Status: Proposed

**Created**: 2026-05-07

This ADR is the migration spec that takes the Pointsman repository
from its cloned-Stencil starting state to proper Pointsman shape:
QT-only m4l workspace, single-product bake, no TM assets, GitHub
upstream live. It strict-carries [Stencil ADR 005][stencil-adr-005]
Phase 2 (post-fix at Stencil commit `5d07dc2`) as the migration
contract.

[stencil-adr-005]: https://github.com/im9/stencil/blob/main/docs/ai/adr/005-product-split.md

## Context

Pointsman was cloned from `~/src/vst/stencil` at Stencil commit
`dc00191` per Stencil ADR 005 §Repository split. The clone
preserves git history, the JUCE submodule reference, and all
working state — including TM-side assets (`host-tm/`,
`Stencil-TM.{maxpat,amxd}`, etc.) that must be deleted before
Pointsman is QT-only.

This ADR is owned by Pointsman; it does not amend Stencil ADR 005.
The Stencil-side §Distribution posture applies (Pointsman is
private during development, public at distribution time) and the
GitHub private repo `im9/pointsman` was provisioned at split time
per the post-fix Stencil ADR 005 §Distribution posture.

The §Implementation checklist below is the strict carry: items
match Stencil ADR 005 Phase 2 (post-`5d07dc2`) one-for-one. The
slight regrouping into numbered sub-sections is for execution
clarity; no items are added or removed beyond the source list.

## Decision

Execute the migration as a single coherent sequence in this
repository. Verification (`pnpm install` + tests + typecheck +
build + bake + bake:check) is the closing step before the final
GitHub push. Fail-closed: do not push the migration commits until
verification passes.

When a §2–§7 step fails on execution, the failure routes back to
this ADR (for instruction errors) or to [Stencil ADR 005][stencil-adr-005]
Phase 2 (the source spec). The repo's `vst/Source/` is left
untouched as the cloned Stencil-TM scaffold per Stencil ADR 005
Phase 2 prologue (the scaffold is rewritten only when Pointsman
vst work begins under a per-product vst-architecture ADR).

## Scope

### In scope

- Filesystem rename / extract / delete operations to bring the
  cloned tree to QT-only Pointsman shape
- RNG primitive extraction from `turing.ts` into a shared `rng.ts`
- Bake script simplification (single-product, no argv)
- Doc rewrite (`CLAUDE.md`, `concept.md` narrowed; Pointsman ADR
  series replacing the cloned Stencil ADR set)
- GitHub remote setup + initial seed push
- Verification (test / typecheck / build / bake) + final
  post-migration push

### Out of scope

- **`vst/Source/`** — left as the cloned Stencil-TM scaffold;
  rewritten when Pointsman vst work begins under a per-product
  vst-architecture ADR.
- **Pointsman QT base architecture as a dedicated ADR** — deferred
  to a follow-up Pointsman ADR or absorbed into the narrowed
  `docs/ai/concept.md`. (Stencil ADR 005 Phase 2 bullet 6's
  original framing of `001-pointsman-base.md` as carrying QT
  base architecture from Stencil archived 002 / 003 was reframed
  during authoring; this ADR is the migration spec only.)
- **Pointsman release verification + distribution** — `pointsman-002`
  (authored as part of §6 below; its content carries from
  Stencil's archived ADR 006 + ADR 004 §Distribution / §Bake outputs
  QT-side residuals).
- **Cross-product items** — Stencil → Pointsman chain
  verification lives in Stencil ADR 005 §Verification; Stencil +
  Pointsman bundle listing lives in Stencil ADR 005 / a future
  cross-product distribution ADR.

## Implementation checklist

Items prefixed `[x]` were completed during the Stencil-side
session in which this ADR was authored. Items prefixed `[ ]`
remain for the Pointsman-side session.

### 1. Repo bootstrap

- [x] `git clone ~/src/vst/stencil ~/src/vst/pointsman`
- [x] `git submodule update --init --recursive` (materialize the
      JUCE submodule)
- [x] Provision GitHub private repo `im9/pointsman`
- [ ] Replace `pointsman/.git/config` `[remote "origin"]` URL
      (currently points at `/Users/tn/src/vst/stencil` from the
      local clone) with the GitHub URL for `im9/pointsman`
- [ ] `git push -u origin main` — initial seed push of the
      cloned + this-session state to GitHub

### 2. Rename surface (m4l/)

- [ ] Rename `m4l/Stencil-QT.maxpat` → `m4l/Pointsman.maxpat`
- [ ] Rename `m4l/stencil-qt.mjs` → `m4l/pointsman.mjs`; update
      its internal `host-qt/dist/` references to `host/dist/`
- [ ] Update the patcher's `[node.script]` `filename` attribute
      to `pointsman.mjs`
- [ ] Rename `m4l/host-qt/` → `m4l/host/`
- [ ] Update `m4l/host/package.json` `name`: `@stencil/host-qt`
      → `@pointsman/host`
- [ ] Update `m4l/host/tsconfig.json` paths to reflect the
      rename
- [ ] Update relative imports inside `m4l/host/` (sibling
      package references, etc.)
- [ ] Update workspace-root `m4l/package.json` `name`:
      `@stencil/m4l` → `@pointsman/m4l`
- [ ] Edit `m4l/pnpm-workspace.yaml`: drop the `host-tm` entry
      and rename `host-qt` → `host`

### 3. RNG extract (m4l/engine/)

- [ ] Extract RNG primitives (`seedRng`, `nextU32`, types
      `RngState`) from `m4l/engine/turing.ts` into
      `m4l/engine/rng.ts`
- [ ] Re-point `m4l/engine/quantizer.ts` and
      `m4l/host/humanize.ts` imports to `./rng`
- [ ] Generate `docs/ai/rng-test-vectors.json` from the seed/step
      prefix of `docs/ai/turing-test-vectors.json`
- [ ] Add `m4l/engine/rng.test.ts` running against the new
      vectors

### 4. TM-only asset delete

Delete from the cloned working tree:

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

- [x] Replace `CLAUDE.md` with QT-scoped content (authored in
      the Stencil-side session)
- [ ] Narrow `docs/ai/concept.md` to QT (drop TM sections;
      retain shared MIDI semantics and humanize content)

### 6. ADR set replace

- [x] Author `docs/ai/adr/001-pointsman-base.md` (this file)
- [ ] `git rm` the cloned-from-Stencil ADRs:
  - `docs/ai/adr/archive/001-engine-interface.md`
  - `docs/ai/adr/archive/002-m4l-architecture.md`
  - `docs/ai/adr/archive/003-m4l-ui-design.md`
  - `docs/ai/adr/archive/004-m4l-bake-distribution.md`
  - `docs/ai/adr/005-product-split.md`
  - `docs/ai/adr/006-m4l-release-verification.md`
  - `docs/ai/adr/INDEX.md`
- [ ] Author `docs/ai/adr/002-pointsman-release.md` as the
      symmetric ADR to Stencil's archived ADR 006, carrying
      QT-side items from Stencil's archived ADR 003 §Verification
      (QT scale keyboard, QT keyboard click [x], QT mode =
      scale / chord / harmony, QT controlChannel) and from
      Stencil's archived ADR 004 (§Bake outputs: bake produces
      `Pointsman.amxd`, `Pointsman.amxd` loads in Live, QT smoke,
      transport hung-notes; §Distribution: channel, screenshot,
      audio demo Pointsman solo, description copy, upload)
- [ ] Author `docs/ai/adr/INDEX.md` (Pointsman-scoped ADR index)

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
- [ ] `pnpm -r test` — all green (Pointsman-only suite)
- [ ] `pnpm -r typecheck` — all green
- [ ] `pnpm -r build` — all green; refreshes `dist/`
- [ ] `pnpm bake` — produces `m4l/Pointsman.amxd`
- [ ] `pnpm bake:check` — passes (abs-path scrub, sibling-file
      resolve)

### 9. Final push

- [ ] `git push origin main` once §1–§8 are all `[x]` (lands the
      Pointsman repo at its QT-only state on GitHub)

## Verification

This ADR is itself a migration spec; the §Implementation
checklist above (specifically §8) is the verification gate.
There is no separate verification step.

The ADR flips to *Implemented* and archives (per the Pointsman
`adr-done` conventions, to be set up alongside the new INDEX.md
in §6) once every checkbox in §1–§9 is `[x]`. After that point,
this repository is in the post-migration QT-only state and ready
for ongoing Pointsman work.
