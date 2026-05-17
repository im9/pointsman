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
| 002 | [Pointsman m4l v1 — release](002-pointsman-release.md) | Proposed | Phase 0 distribution scaffolding (esbuild bundle of host entry, top-level Makefile, freeze workflow, cross-path check). Manual-Live verification gate: live.* surface coverage, rendering at multiple UI scales / themes, scale keyboard jsui interaction, mode (scale / chord / harmony) smoke, controlChannel chord context, transport hygiene, bake artifact hygiene. Per-channel distribution work (channel, screenshot, audio demo, copy, upload). |

## VST

VST is post-v1. The engine spec carries over from existing Pointsman
m4l code; the per-product vst-architecture ADR is below.

| #   | Title | Status | Notes |
|-----|-------|--------|-------|
| 003 | [Pointsman vst — architecture](archive/003-pointsman-vst-architecture.md) | Implemented | Three-layer source split (`Source/Engine/` pure C++17, `Source/Plugin/` APVTS+Processor, `Source/Editor/` JUCE UI). VST3+AU+CLAP MIDI Effect, COPY_PLUGIN_AFTER_BUILD. Engine ports m4l Quantizer/Rng/Humanize against shared JSON test vectors. UI is inboil-derived (keyboard + right rail with Scale/Mode/Harmony/Humanize/Routing — Target/Track/Preset dropped as scene-graph-only). Phased: scaffold removal → engine → plugin → editor → humanize gate/timing fix → Phase 5 param-surface redesign (chord/harmony merge, humanize → feel+drift, kStateVersion 2 hard break). |
