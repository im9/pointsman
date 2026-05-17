# ADR 002: Pointsman m4l v1 — release

## Status: Proposed

**Created**: 2026-05-07
**Revised**: 2026-05-08 — added §Phase 0 (distribution
scaffolding: esbuild bundle, top-level Makefile, freeze
workflow). Reason: Max Freeze does not follow ES module `import`
chains (oedipa ADR 007 §Phase 5, validated by dev-vs-frozen Max
console comparison); the hand-written `m4l/pointsman.mjs` would
not survive freeze without bundling. Phase 0 lifts oedipa's
working pattern into Pointsman as a prerequisite to manual
verification + per-channel distribution.

This ADR defines the release gate for Pointsman m4l v1:
distribution scaffolding (Phase 0), manual verification, and
per-channel distribution. The Pointsman m4l device ships when
every checkbox in §Phase 0, §Verification, and §Distribution
below is `[x]`.

## Context

Pointsman m4l v1's correctness can't be flipped by the unit-test
suite alone. Host loading behavior, live.* surface coverage, jsui
rendering at multiple UI scales / themes, audible smoke for the
quantize modes, and transport hygiene all require manual checks
against Ableton Live. Per-channel distribution work (screenshot,
audio demo, listing copy, upload) is similarly outside the test
suite and is gated on verification passing.

## Decision

Pointsman m4l v1 ships when every checkbox in §Phase 0,
§Verification, and §Distribution below is `[x]`. §Phase 0 is
the distribution-side scaffolding (bundle, Makefile, freeze)
that makes a self-contained `.amxd` shippable; §Verification is
the manual-Live correctness gate against the dev-side baked
device; §Distribution is the per-channel release work that
follows the first two.

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
  cross-path verification of the frozen `.amxd`.
- Manual Live checks: live.* surface, rendering, scale keyboard
  jsui, mode (scale / chord / harmony), controlChannel
- Bake artifact hygiene: load-cleanly, bake:check, transport
  hung-notes
- Per-channel distribution: channel selection, screenshot, audio
  demo, copy, upload

### Out of scope

- ADR 001 §8 verification (dev-side test / typecheck / build /
  bake) — not duplicated here. §Phase 0 below covers the
  *distribution-side* scaffolding (esbuild bundle, Makefile,
  freeze) that ADR 001 §8 did not address.
- vst target verification and distribution — separate ADR
  series; vst is post-v1.
- Multi-device DAW chain scenarios — Pointsman is independently
  functional; chain testing is a user-level DAW concern.

## Implementation checklist

§Phase 0 carries the code-side scaffolding (esbuild bundle,
top-level Makefile, freeze workflow). §Verification and
§Distribution are the manual gates that follow Phase 0. The ADR
flips to *Implemented* once every checkbox in §Phase 0,
§Verification, and §Distribution is `[x]`.

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

## Verification

Manual checks against Ableton Live. Items reference the
**dev-side** baked `m4l/Pointsman.amxd`; the frozen
distribution file is verified in §Phase 0 above.

- [x] Each `live.*` parameter visible in Live's Device parameter
      list
- [x] Each `live.*` parameter responds to MIDI map (Cmd-M) and
      automation
- [x] Saving a Live set, closing, reopening preserves every
      parameter value
- [x] Right-click → "Show in Browser" / preset save round-trips
      values
- [x] At Live 100% UI scale, the Pointsman device renders within
      the 1000×180 presentation strip without truncation or
      scrollbars
- [x] At Live 150% UI scale, no widget label or jsui content is
      clipped (or document that 150% is out of v1 scope if Max
      can't handle it)
- [x] In Live's Light theme, the inboil palette reads correctly
- [x] In Live's Dark theme, the inboil palette remains readable
      (or decision recorded that v1 ships Light-theme-tuned and
      Dark is v2)
- [x] Scale keyboard: in-scale dots correct, pulse animation
      visible and decays, multi-pulse stacks readable
- [x] mode = `scale`: input quantized to scale-snap, no chord
      context, no harmony voicing
- [x] mode = `chord`: held notes on `controlChannel` form chord
      context (visible on keyboard as a third highlight tier
      between in-scale and pulse), input notes snap to chord
      tones with scale fallback. Releasing all controlChannel
      notes clears context.
- [x] mode = `harmony`: each input note produces input + N
      voiced notes per `harmonyVoices[]`. Empty `harmonyVoices`
      reverts to scale-snap behaviour.
- [x] controlChannel: in `mode = chord`, controlChannel notes
      are consumed (do NOT appear in noteOut). In
      `mode = scale | harmony` with `triggerMode = root`,
      controlChannel single notes set root and are also
      consumed.
- [x] `Pointsman.amxd` loads in Live without console errors
- [x] `pnpm bake:check` passes on a fresh checkout
- [x] Smoke: mode = `scale` / `chord` / `harmony` each produce
      sound in Live (covers Pointsman host behavior in the real
      device)
- [x] Transport stop / start / scrub leaves no hung notes on the
      Pointsman device

## Distribution

Per-channel release work.

- [x] Choose distribution channel. **Initial v1 (2026-05-09):**
      per-product GitHub repo
      [im9/pointsman-m4l](https://github.com/im9/pointsman-m4l)
      Releases (binary + README only; source repo stays separate).
      **Revised 2026-05-17:** future m4l releases go on the source
      repo `im9/pointsman` with tags `m4l-vX.Y.Z`, mirroring
      oedipa's pattern (single repo hosts both m4l and vst tag
      lines, distinguished by prefix). The legacy
      `pointsman-m4l/v1.0.0` is retained on its repo as historical;
      the next release on `im9/pointsman` starts fresh at
      `m4l-v1.0.0`. See `.claude/skills/release/SKILL.md`.
- [ ] Prepare screenshot at channel-required dimensions
- [ ] Record audio demo (Pointsman solo) and export MP3
- [ ] Write description copy
- [x] Upload Pointsman v1; first public version live —
      [v1.0.0](https://github.com/im9/pointsman-m4l/releases/tag/v1.0.0)
      released 2026-05-09 on the legacy `pointsman-m4l` repo. Asset
      refreshed in-place 2026-05-10 (canary stage, downloads = 1)
      with audit-fix dist — `Pointsman.amxd` (sha256
      `2bc5e9356e6c817e1833f83ec407d5d2729ac39a608d4bc09368ed1824275c9d`).
      The audit-fix iteration covers chord-tier rendering,
      in-flight noteOff cancellation, MIDI range guards
      (channel 0..16 for track-internal Live MIDI), and the
      bake pipeline now chains `pnpm -r build`.
      `parameter_longname` was renamed `StencilQt*` →
      `Pointsman*`; canary download (1) is the author's own
      verification, no external user breakage.
