# ADR Index

Quick reference for all Architecture Decision Records. Read individual ADRs
only when relevant to the current task.

## Status Legend

- **Proposed**: Not yet fully implemented. Contains an implementation checklist; flip to Implemented once all boxes are checked.
- **Implemented**: Done. Code is the source of truth. Read only for historical rationale.
- **Superseded**: Replaced by a newer ADR. Generally skip.

## File Organization

- **Top-level** (`docs/ai/adr/`): Proposed and Accepted ADRs — active design decisions.
- **Archive** (`docs/ai/adr/archive/`): Implemented and Superseded ADRs — historical record.

## Conventions

- File name: `NNN-kebab-case-title.md` (3-digit zero-padded)
- Header: `# ADR NNN: Title`
- Status line: `## Status: Proposed | Accepted | Implemented | Superseded`
- Created date: `**Created**: YYYY-MM-DD`
- Sections: Context → Decision → (optional) Scope / Implementation notes

## ADRs

| #   | Title | Status | Notes |
|-----|-------|--------|-------|
| 001 | [Pointsman m4l — base (initial migration from cloned source)](archive/001-pointsman-base.md) | Implemented | Migration from the cloned-source bootstrap state to single-product Pointsman shape: rename surface, RNG extract, TM asset delete, bake script simplification, doc rewrite, ADR set replace, GitHub remote setup, verification. |
| 002 | [Pointsman m4l — release procedure](archive/002-pointsman-release.md) | Implemented | Phase 0 distribution scaffolding (esbuild bundle of host entry, top-level Makefile, freeze workflow, cross-path check). Per-release manual-Live verification gate (v2 surface): live.* surface coverage, rendering at multiple UI scales / themes, scale keyboard jsui interaction, mode (scale / chord) smoke, harmonyVoices editing, inputChannel MPE pass-through, feel / drift humanize, seed persistence, transport hygiene, bake artifact hygiene, v1 → v2 state load behaviour. Per-channel distribution: channel decision settled (source repo `im9/pointsman`, `m4l-vX.Y.Z` tags); v0.1.0 shipped 2026-05-23 (GitHub Release `m4l-v0.1.0` + maxforlive.com listing id=15367). v1.0.0 release (2026-05-09, legacy `pointsman-m4l` repo) preserved as historical at the foot of §Distribution. |

## VST

VST is post-v1. The engine spec carries over from existing Pointsman
m4l code; the per-product vst-architecture ADR is below.

| #   | Title | Status | Notes |
|-----|-------|--------|-------|
| 003 | [Pointsman vst — architecture and release](archive/003-pointsman-vst-architecture.md) | Implemented | Three-layer source split (`Source/Engine/` pure C++17, `Source/Plugin/` APVTS+Processor, `Source/Editor/` JUCE UI). VST3+AU+CLAP MIDI Effect, COPY_PLUGIN_AFTER_BUILD. Engine ports m4l Quantizer/Rng/Humanize against shared JSON test vectors. UI is inboil-derived (keyboard + right rail with Scale/Mode/Harmony/Humanize/Routing — Target/Track/Preset dropped as scene-graph-only). Phased: scaffold removal → engine → plugin → editor → humanize gate/timing fix → Phase 5 param-surface redesign (chord/harmony merge, humanize → feel+drift, kStateVersion 2 hard break). **2026-05-18 amendment**: appended §Release procedure (pkg installer port from oedipa + root `release-vst` Makefile target + paid-via-Polar distribution, no tag / no GH release for vst + first `v0.1.0` ship); dmg path already shipping via existing `vst/scripts/`. v0.1.0 shipped 2026-05-23 (dmg + pkg stapler-validate-clean, uploaded to Polar). |
| 004 | [Pointsman v0.2 — chord shape primitive and arpeggiator](004-pointsman-arpeggiator.md) | Proposed | v0.2 dual-feature ADR: (1) replace `harmonyVoices` with `chordShape` (intervallic, 20 jazz-named presets: `maj` default / `m` / `7` / `maj7` / `m7b5` / `dim7` / `aug` / `sus2` / `sus4` / `power` / `add9` / `maj9` / `m9` / `9` / `13` / `6` / `m6` / `dim` / `octave`); (2) add `arp` as third value of `mode` (exclusive `scale \| chord \| arp`), seven new arp params (`arpPattern` with `strike` simultaneous-pool pattern / `arpRate` / `arpOctaves` / `arpStepRepeats` 1..8 ratchet / `arpGate` / `arpVariation` single-knob rest/octave/flam cascade / `arpLatch`). **Scale-snap applies to input only** when chord is engaged; chord voices are intervallic and may go out-of-scale (chromatic colours / borrowed chords are deliberate). Arp pool = chord-expanded voices via `chordShape`, so 1-key + arp produces musical arpeggio. Persistence: hard v2 → v3 break — `harmonyVoices` removed, `chordShape` + arp pids added, `kStateVersion` bumps to 3 (no migrator, defaults take over per v1 → v2 precedent). UI: **mode-contextual visibility** — CHORD SHAPE dropdown visible in chord+arp, ARP params visible in arp only. m4l keyboard stays at full 176 px (no shortening); vst rail content height stays at 570 px. concept.md major revision required. Out of scope (deferred with musical reasoning): user-defined chord shapes, user-defined arp step patterns, per-pattern swing, microtonal chord shapes, cross-octave pattern flavours. |
