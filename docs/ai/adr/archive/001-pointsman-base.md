# ADR 001: Pointsman m4l — base (initial migration from cloned source)

## Status: Implemented

**Created**: 2026-05-07
**Implemented**: 2026-05-08 (cloned tree reshaped to single-product Pointsman; bake / tests / typecheck / build all green; Pointsman.amxd baked; pushed to origin/main)

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
      `m4l/host/humanize.ts` imports to `./rng`. Actual
      coverage (corrected in §4 commit): `host/humanize.ts`,
      `host/host.ts`, `host/host.test.ts`,
      `host/humanize.test.ts`. `quantizer.ts` has no
      RNG-import — the ADR over-specified there. Also updated
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

- [x] `m4l/Stencil-TM.maxpat`
- [x] `m4l/Stencil-TM.amxd`
- [x] `m4l/Stencil-TM Project/` (Live's auto-generated project
      folder for the TM device) — never existed in the cloned
      tree (Live had not opened the device), implicitly
      satisfied
- [x] `m4l/stencil-tm.mjs`
- [x] `m4l/host-tm/`
- [x] `m4l/engine/turing.ts`
- [x] `m4l/engine/turing.test.ts`
- [x] `m4l/registerRing.jsui.js`
- [x] `m4l/registerRing.subpatcher.maxpat`
- [x] `docs/ai/turing-test-vectors.json`

Side effects of §4 (folded into the same commit):
- Completed §3 import re-point: `host/host.ts`,
  `host/host.test.ts`, `host/humanize.test.ts` switched from
  `../engine/turing.ts` → `../engine/rng.ts`.
- Removed `host-tm` cross-references in `host/*` comments
  (`bridge.ts` ready-handshake comment, `bridge.test.ts`
  pattern blurb, `host.test.ts` ×2, `ui/scaleKeyboard.logic.test.ts`
  ×2). The substance of each comment is preserved; only the
  dangling pointers to deleted code are removed.

Follow-up (resolved in §7):
- Top-level `scripts/gen-test-vectors.mjs` is orphaned (its
  `OUT_TM` target is gone). Repurposed in §7: stripped to RNG
  + QT generators only, outputs `rng-test-vectors.json` +
  `quantizer-test-vectors.json`. Vector data sections are
  bit-identical to the prior on-disk forms; only meta/note
  strings updated to reflect the new generator.
- `m4l/Stencil-QT.amxd` orphan from §2 rename — deleted in §7;
  superseded by §7 bake's `Pointsman.amxd`.

### 5. Doc rewrite

- [x] Replace `CLAUDE.md` with Pointsman content
- [x] Narrow `docs/ai/concept.md` to Pointsman (drop TM
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

- [x] Simplify `m4l/scripts/maxpat-to-amxd.mjs` to single-product
      shape (no argv; fixed I/O `Pointsman.maxpat` →
      `Pointsman.amxd`)
- [x] Update guard tests (`bake.test.mjs`, `patcher.test.mjs`)
      to drop per-device branching. Patcher test still asserts
      `StencilQt*` `parameter_longname` strings — renaming the
      patcher widget longnames to `Pointsman*` is a separate
      patcher-side surgery, deferred to a follow-up ADR.
- [x] Collapse `bake:tm` / `bake:qt` / `bake:check:tm` /
      `bake:check:qt` scripts in `m4l/package.json` to a single
      `bake` / `bake:check`

### 8. Verification

- [x] From `m4l/`: `pnpm install` (the clone does not bring
      `node_modules`)
- [x] `pnpm -r test` — all green (engine 8/8, host 185/185,
      scripts 71/71)
- [x] `pnpm -r typecheck` — all green
- [x] `pnpm -r build` — all green; refreshes `dist/`
- [x] `pnpm bake` — produces `m4l/Pointsman.amxd` (55026 bytes)
- [x] `pnpm bake:check` — passes (abs-path scrub, sibling-file
      resolve)

### 9. Final push

- [x] `git push origin main` once §1–§8 are all `[x]` (lands the
      Pointsman repo at its single-product state on GitHub)

## Verification

This ADR is itself a migration spec; the §Implementation
checklist above (specifically §8) is the verification gate.
There is no separate verification step.

The ADR flips to *Implemented* and archives once every checkbox
in §1–§9 is `[x]`. After that point, this repository is in the
post-migration single-product state and ready for ongoing
Pointsman work.
