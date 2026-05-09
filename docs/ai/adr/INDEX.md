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

VST is post-v1. The target is paused at the cloned scaffold state
while m4l v1 ships; it gets its own per-product vst-architecture
ADR when picked up. The engine spec carries over from existing
Pointsman m4l code.

| #   | Title | Status | Notes |
|-----|-------|--------|-------|
