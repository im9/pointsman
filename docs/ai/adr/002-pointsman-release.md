# ADR 002: Pointsman m4l v1 — release

## Status: Proposed

**Created**: 2026-05-07

This ADR defines the release gate for Pointsman m4l v1: manual
verification AND per-channel distribution. The Pointsman m4l
device ships when every checkbox in §Verification AND
§Distribution below is `[x]`.

## Context

Pointsman m4l v1's correctness can't be flipped by the unit-test
suite alone. Host loading behavior, live.* surface coverage, jsui
rendering at multiple UI scales / themes, audible smoke for the
quantize modes, and transport hygiene all require manual checks
against Ableton Live. Per-channel distribution work (screenshot,
audio demo, listing copy, upload) is similarly outside the test
suite and is gated on verification passing.

## Decision

Pointsman m4l v1 ships when every checkbox in §Verification AND
§Distribution below is `[x]`. §Verification is the manual-Live
correctness gate. §Distribution is the per-channel release work
that follows verification.

§Bake artifact hygiene depends on ADR 001 §7 having landed
(single-product bake produces `Pointsman.amxd` from
`Pointsman.maxpat`); ADR 001 §8 itself verifies that `pnpm bake`
produces the artifact, so this ADR carries only the
load-cleanly + bake:check items, not a duplicate "bake produces
.amxd" item.

## Scope

### In scope

- Manual Live checks: live.* surface, rendering, scale keyboard
  jsui, mode (scale / chord / harmony), controlChannel
- Bake artifact hygiene: load-cleanly, bake:check, transport
  hung-notes
- Per-channel distribution: channel selection, screenshot, audio
  demo, copy, upload

### Out of scope

- ADR 001 §8 verification (test / typecheck / build / bake) —
  not duplicated here.
- vst target verification and distribution — separate ADR
  series; vst is post-v1.
- Multi-device DAW chain scenarios — Pointsman is independently
  functional; chain testing is a user-level DAW concern.

## Implementation checklist

This ADR has no code-side implementation. The substantive work
is the checklists in §Verification and §Distribution below; the
ADR flips to *Implemented* once every checkbox in those two
sections is `[x]`.

## Verification

Manual checks against Ableton Live.

- [ ] Each `live.*` parameter visible in Live's Device parameter
      list
- [ ] Each `live.*` parameter responds to MIDI map (Cmd-M) and
      automation
- [ ] Saving a Live set, closing, reopening preserves every
      parameter value
- [ ] Right-click → "Show in Browser" / preset save round-trips
      values
- [ ] At Live 100% UI scale, the Pointsman device renders within
      the 1000×180 presentation strip without truncation or
      scrollbars
- [ ] At Live 150% UI scale, no widget label or jsui content is
      clipped (or document that 150% is out of v1 scope if Max
      can't handle it)
- [ ] In Live's Light theme, the inboil palette reads correctly
- [ ] In Live's Dark theme, the inboil palette remains readable
      (or decision recorded that v1 ships Light-theme-tuned and
      Dark is v2)
- [ ] Scale keyboard: in-scale dots correct, pulse animation
      visible and decays, multi-pulse stacks readable
- [ ] mode = `scale`: input quantized to scale-snap, no chord
      context, no harmony voicing
- [ ] mode = `chord`: held notes on `controlChannel` form chord
      context (visible on keyboard as a third highlight tier
      between in-scale and pulse), input notes snap to chord
      tones with scale fallback. Releasing all controlChannel
      notes clears context.
- [ ] mode = `harmony`: each input note produces input + N
      voiced notes per `harmonyVoices[]`. Empty `harmonyVoices`
      reverts to scale-snap behaviour.
- [ ] controlChannel: in `mode = chord`, controlChannel notes
      are consumed (do NOT appear in noteOut). In
      `mode = scale | harmony` with `triggerMode = root`,
      controlChannel single notes set root and are also
      consumed.
- [ ] `Pointsman.amxd` loads in Live without console errors
- [ ] `pnpm bake:check` passes on a fresh checkout
- [ ] Smoke: mode = `scale` / `chord` / `harmony` each produce
      sound in Live (covers Pointsman host behavior in the real
      device)
- [ ] Transport stop / start / scrub leaves no hung notes on the
      Pointsman device

## Distribution

Per-channel release work.

- [ ] Choose distribution channel
- [ ] Prepare screenshot at channel-required dimensions
- [ ] Record audio demo (Pointsman solo) and export MP3
- [ ] Write description copy
- [ ] Upload Pointsman v1; first public version live
