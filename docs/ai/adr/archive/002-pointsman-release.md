# ADR 002: Pointsman m4l — release procedure

## Status: Implemented

**Created**: 2026-05-07
**Revised**: 2026-05-08 — added §Phase 0 (distribution
scaffolding: esbuild bundle, top-level Makefile, freeze
workflow). Reason: Max Freeze does not follow ES module `import`
chains (oedipa ADR 007 §Phase 5, validated by dev-vs-frozen Max
console comparison); the hand-written `m4l/pointsman.mjs` would
not survive freeze without bundling. Phase 0 lifts oedipa's
working pattern into Pointsman as a prerequisite to manual
verification + per-channel distribution.
**Revised**: 2026-05-18 — generalised from "m4l v1 release" to
"m4l release procedure across versions". v1.0.0 shipped on the
legacy `im9/pointsman-m4l` repo (2026-05-09); since then the
codebase has landed the v2 parameter surface (chord/harmony
merge, `feel` + `drift` humanize, removed `controlChannel` /
`triggerMode` / `outputLevel` / per-axis humanize parameters),
and the source repo's first tag `m4l-v0.1.0` (2026-05-18) is the
v2 surface. §Phase 0 scaffolding remains Implemented and applies
unchanged; §Verification is rewritten to gate the v2 public
distribution; §Distribution carries the channel decision forward
and resets the asset-prep / upload items per release.
**Revised**: 2026-05-23 — m4l v0.1.0 public distribution shipped
end-to-end. GitHub Release `m4l-v0.1.0` published 2026-05-17 with
asset `Pointsman.amxd` and release notes body. maxforlive.com
listing id=15367 published 2026-05-23 with description,
screenshot, and YouTube demo
(https://youtu.be/4B8k--NRuTA). Status flips Proposed →
Implemented; future m4l releases re-flip to Proposed when bumping
§Verification + §Distribution against the new version.
**Implemented**: 2026-05-23 (m4l v0.1.0 distribution shipped end-to-end: GitHub Release `m4l-v0.1.0` with `Pointsman.amxd` asset + release notes, maxforlive.com listing id=15367 with description + screenshot + YouTube demo; §Verification complete with MPE check `[~]`-skipped per recorded rationale, §Distribution all `[x]`)

This ADR defines the release gate for Pointsman m4l: distribution
scaffolding (§Phase 0, one-time), manual verification (per
release), and per-channel distribution (per release). A Pointsman
m4l public release ships when every checkbox in §Verification and
§Distribution is `[x]` against the current code.

## Context

Pointsman m4l's correctness can't be flipped by the unit-test
suite alone. Host loading behavior, live.* surface coverage, jsui
rendering at multiple UI scales / themes, audible smoke for the
quantize modes, and transport hygiene all require manual checks
against Ableton Live. Per-channel distribution work (screenshot,
audio demo, listing copy, upload) is similarly outside the test
suite and is gated on verification passing.

The v2 release additionally needs to confirm:

- removed v1 parameters (`controlChannel`, `triggerMode`,
  `outputLevel`, `humanizeVelocity` / `humanizeGate` /
  `humanizeTiming` / `humanizeDrift`) are absent from the Live
  param list
- removed `harmony` mode value is absent from the mode menu (the
  former harmony semantics are now `chord` mode's semantics, with
  `harmonyVoices` defaulting to a 1-3-5 triad)
- new params (`feel`, `drift`, `harmonyVoices`) are present and
  behave per concept.md §"Parameter surface"
- a Live set saved with v1.0.x m4l opens without console errors
  on the v2 device

## Decision

A Pointsman m4l public release ships when every checkbox in
§Verification and §Distribution is `[x]` (verified) or `[~]`
(explicitly skipped at ship with rationale recorded inline)
against the current code. §Phase 0 is one-time scaffolding
(already Implemented) that makes a self-contained `.amxd`
shippable; subsequent releases inherit it.

§Bake artifact hygiene depends on ADR 001 §7 having landed
(single-product bake produces `Pointsman.amxd` from
`Pointsman.maxpat`); ADR 001 §8 itself verifies that `pnpm bake`
produces the artifact, so this ADR carries only the
load-cleanly + bake:check items, not a duplicate "bake produces
.amxd" item.

## Scope

### In scope

- Distribution scaffolding: esbuild bundle of the host entry,
  top-level Makefile (`make release`), freeze workflow,
  cross-path verification of the frozen `.amxd`. **One-time;
  Implemented as part of v1.0.0, applies unchanged to v2.**
- Manual Live checks per release: live.* surface, rendering,
  scale keyboard jsui, mode (scale / chord), `harmonyVoices`
  editing, `inputChannel` pass-through for MPE, `feel` / `drift`
  humanize, seed persistence
- Bake artifact hygiene: load-cleanly, bake:check, transport
  hung-notes
- v2-specific: v1 → v2 surface-change verification (loading a
  v1.0.x-saved Live set on the v2 device opens without console
  errors; removed pids are absent from the device)
- Per-channel distribution: channel selection (settled — source
  repo `im9/pointsman`, `m4l-vX.Y.Z` tag namespace), screenshot,
  audio demo, copy, upload (per release)

### Out of scope

- ADR 001 §8 verification (dev-side test / typecheck / build /
  bake) — not duplicated here. §Phase 0 below covers the
  *distribution-side* scaffolding (esbuild bundle, Makefile,
  freeze) that ADR 001 §8 did not address.
- vst target verification and distribution — covered in
  [ADR 003 §Release procedure](003-pointsman-vst-architecture.md#release-procedure).
- Multi-device DAW chain scenarios — Pointsman is independently
  functional; chain testing is a user-level DAW concern.

## Implementation checklist

§Phase 0 carries the one-time code-side scaffolding (esbuild
bundle, top-level Makefile, freeze workflow); it shipped with
v1.0.0 and applies unchanged to v2 and onward. §Verification and
§Distribution are the per-release gates that follow Phase 0. The
ADR flips to *Implemented* once every checkbox in §Verification
and §Distribution is `[x]` for the current release; the v1.0.0
history is preserved at the foot of §Distribution.

## Phase 0 — Distribution scaffolding

`m4l/pointsman.mjs` is currently hand-written and tracked, with
`import { QtBridge } from "./host/dist/host/bridge.js"` resolved
at runtime against sibling JS on the build machine. `pnpm bake`
propagates that pattern into `Pointsman.amxd`, so the dev `.amxd`
only loads on the build machine. **Max Freeze does not follow ES
module `import` chains** (oedipa ADR 007 §Phase 5, validated by
Max console comparison between dev and frozen `.amxd`); a frozen
Pointsman `.amxd` would inline the entry script but lose its
imports, leaving `[node.script]` permanently in "Node script not
ready" state.

Phase 0 lifts oedipa's working pattern — esbuild pre-bundling so
the freeze sandbox sees a single self-contained file with only
`max-api` as external — into Pointsman, plus a top-level
`make release` driver that mirrors oedipa's. Bundle output
filename stays `pointsman.mjs` so the `.maxpat` reference and
existing path-guard tests continue to apply unchanged.

**Already satisfied** (no work needed): `Pointsman.maxpat`
abs-path scrub and `[node.script pointsman.mjs]` /
`[jsui scaleKeyboard.jsui.js]` flat-path conventions are
enforced by `m4l/scripts/patcher.test.mjs` (oedipa ADR 007
§Phase 1 equivalent).

### Bundling

- [x] Rename source: `m4l/pointsman.mjs` →
      `m4l/pointsman.entry.mjs` (tracked). Internal import paths
      unchanged.
- [x] Add `esbuild` as devDependency at the `m4l/` workspace
      root.
- [x] Add `bundle:host` script to `m4l/package.json`:
      `esbuild pointsman.entry.mjs --bundle --platform=node
      --format=esm --external:max-api --outfile=pointsman.mjs`.
- [x] Update `m4l/package.json` `bake` script to run
      `bundle:host` first:
      `bake = bundle:host && node scripts/maxpat-to-amxd.mjs`.
- [x] `.gitignore` the bundled `m4l/pointsman.mjs` (build
      artefact) and top-level `dist/` (frozen ship target).
- [x] Guard test `m4l/host/pointsman-bundle.test.ts`: bundled
      `m4l/pointsman.mjs` has only `max-api` as a remaining
      external import. Skipped on fresh checkouts where the
      bundle hasn't been built yet (mirrors oedipa's
      `oedipa-host-bundle.test.ts`).

### Release driver

- [x] Top-level `Makefile` with `release: release-m4l`.
      `release-m4l` runs `cd m4l && pnpm -r build && pnpm bake`,
      ensures `dist/` exists at the repo root, prints
      next-step instructions: open `m4l/Pointsman.amxd` in Max
      → snowflake (Freeze) → File → Save As
      `dist/Pointsman.amxd`. (`release-vst` is deferred to vst
      implementation — see §Out of scope.)
- [x] Document the freeze step in `README.md` (m4l Build
      section) and project `CLAUDE.md` (m4l section):
      `make release` → Freeze → ship `dist/Pointsman.amxd`.

### Cross-path verification

- [x] Run the full flow: `make release` → open
      `m4l/Pointsman.amxd` in Max → click snowflake → Save As
      `dist/Pointsman.amxd`. Copy the frozen file to a path
      outside the repo (e.g. `~/Downloads/Pointsman.amxd`) and
      drag into a fresh Live track. Max console shows
      `pointsman: pointsman.mjs loaded` and the `ready 1` outlet
      fires; live.* dump arrives, MIDI plays under transport.
      This is the canonical distribution-success criterion.

## Verification (v2 release)

Manual checks against Ableton Live. Items reference the
**dev-side** baked `m4l/Pointsman.amxd`; the frozen distribution
file is verified in §Phase 0 above.

History: every item in this section was `[x]` at v1.0.0 ship
(2026-05-09) against the v1 surface (modes `scale` / `chord` /
`harmony`, `controlChannel` chord context, 4-axis humanize,
`triggerMode`, `outputLevel`). Those items have been rewritten
for the v2 surface below; git log retains the v1 phrasing
verbatim.

### Live host integration

- [x] Each `live.*` parameter visible in Live's Device parameter
      list — including new `feel`, `drift`; not including removed
      `humanizeVelocity` / `humanizeGate` / `humanizeTiming` /
      `humanizeDrift` / `outputLevel` / `triggerMode` /
      `controlChannel`
- [x] Each `live.*` parameter responds to MIDI map (Cmd-M) and
      automation
- [x] Saving a Live set, closing, reopening preserves every
      parameter value — including the harmony voice slot state
      (count, interval, direction per slot)
- [x] Right-click → "Show in Browser" / preset save round-trips
      values
- [x] Loading a Live set saved with v1.0.x m4l (legacy repo
      build) opens on the v2 device without console errors;
      removed params disappear from the device; remaining params
      (scale, root, seed, mode where the value carries over)
      retain their saved values

### Rendering / theming

- [x] At Live 100% UI scale, the Pointsman device renders within
      the presentation strip without truncation or scrollbars
- [x] At Live 150% UI scale, no widget label or jsui content is
      clipped (or document that 150% is out of v2 scope if Max
      can't handle it)
- [x] In Live's Light theme, the inboil palette reads correctly
- [x] In Live's Dark theme, the inboil palette remains readable
- [x] Scale keyboard: in-scale dots correct, pulse animation
      visible and decays, multi-pulse stacks readable

### Quantize modes

- [x] mode = `scale`: input quantized to scale-snap, 1-in-1-out
      (no chord expansion, no harmony stack)
- [x] mode = `chord` with default `harmonyVoices` (`[{3 above},
      {5 above}]`): input note produces a 1-3-5 diatonic triad
      (C in C major → C, E, G; D in C major → D, F, A)
- [x] mode = `chord` with `harmonyVoices = []`: chord mode
      collapses to 1-in-1-out (audibly identical to scale mode)
- [x] mode = `chord`, configurable voices: editing voice
      interval (3rd / 4th / 5th / 6th) and direction (above /
      below) reshapes output on the next input note
- [x] mode = `chord`, out-of-scale input: input snaps to nearest
      scale degree first, then chord builds on the snapped root
- [x] HARMONY editor: voice slots dimmed / disabled when
      `mode == scale`; adding / removing voices respects the
      0..3 cap

### Channels / MPE

- [~] `inputChannel = 1` with MPE-style input on channels 2..15:
      per-note channels pass through to the downstream MPE
      instrument (pitch bend / pressure / timbre intact).
      **Skipped at v2 ship — no MPE controller hardware
      available for manual verification. Engine pass-through is
      covered by the `non-matching inputChannel` cases in
      `m4l/host/host.test.ts`. Re-run this check when MPE
      hardware is on hand.**
- [x] `inputChannel = 0` (omni): all incoming notes quantize
- [x] Stencil → Pointsman on the same Live track (ch=0
      track-internal normalisation) routes correctly under
      `inputChannel = 0` (omni) — documented gotcha in
      CLAUDE.md "Live runtime gotchas"

### Humanize

- [x] `feel = 0` → output is bit-identical to the snapped /
      expanded input (no jitter audible)
- [x] `feel` slider audibly affects velocity / gate / timing
      together (per-event jitter); the three axes draw
      independently
- [x] `drift` at high values (0.95–0.99) produces slow,
      breath-like motion rather than per-event jitter; `drift =
      1.0` freezes the layer (documented edge case)
- [x] Two fresh Pointsman instances on parallel tracks produce
      different humanize (random seed per instance, not
      phase-coherent)
- [x] Preset save → reload reproduces the seeded humanize
      bit-for-bit on identical input

### Hygiene

- [x] `Pointsman.amxd` loads in Live without console errors
- [x] `pnpm bake:check` passes on a fresh checkout
- [x] Transport stop / start / scrub leaves no hung notes on the
      Pointsman device

## Distribution

Per-channel release work. The channel decision is settled; asset
preparation and upload are per release.

- [x] **Channel decision (Done, 2026-05-17).** Future m4l
      releases go on the source repo `im9/pointsman` with tags
      `m4l-vX.Y.Z`, mirroring oedipa's pattern (single repo hosts
      both m4l and vst tag lines, distinguished by prefix). The
      legacy `pointsman-m4l/v1.0.0` is retained on its repo as
      historical; the source repo's first tag `m4l-v0.1.0`
      (2026-05-18) is the v2 surface. See
      `.claude/skills/release/SKILL.md`.
- [x] Prepare screenshot at channel-required dimensions —
      maxforlive.com listing id=15367 carries the screenshot.
- [x] Record demo — YouTube video at
      https://youtu.be/4B8k--NRuTA, embedded in the maxforlive.com
      listing in place of the originally-planned MP3 export
      (same role, richer medium).
- [x] Write description copy — published in the GitHub Release
      body (`m4l-v0.1.0`) and the maxforlive.com listing
      (id=15367) on 2026-05-23.
- [x] Upload Pointsman v0.1.0 — GitHub Release `m4l-v0.1.0`
      published 2026-05-17 with asset `Pointsman.amxd` and
      release notes; maxforlive.com listing id=15367 published
      2026-05-23.

### Prior release: v1.0.0 (2026-05-09, legacy repo)

Pointsman m4l v1.0.0 shipped to
[`im9/pointsman-m4l/v1.0.0`][legacy-release] on 2026-05-09
(canary stage, 1 download = author's own verification). Asset
refreshed in-place 2026-05-10 with audit-fix dist —
`Pointsman.amxd` (sha256
`2bc5e9356e6c817e1833f83ec407d5d2729ac39a608d4bc09368ed1824275c9d`).
The audit-fix iteration covered chord-tier rendering, in-flight
noteOff cancellation, MIDI range guards (channel 0..16 for
track-internal Live MIDI), and the bake pipeline now chains
`pnpm -r build`. `parameter_longname` was renamed `StencilQt*` →
`Pointsman*`; canary download (1) is the author's own
verification, no external user breakage.

v1.0.0 verification was performed against the v1 surface (modes
`scale` / `chord` / `harmony`, `controlChannel` chord context,
4-axis humanize, `triggerMode`, `outputLevel`); every gate item
was `[x]` at ship. The current §Verification checklist supersedes
those gate items for the v2 surface — git log retains the v1
phrasing verbatim.

[legacy-release]: https://github.com/im9/pointsman-m4l/releases/tag/v1.0.0
