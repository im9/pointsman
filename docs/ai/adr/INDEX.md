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

## Core

| #   | Title | Status | Notes |
|-----|-------|--------|-------|
| 001 | [Engine Interface — TM + Quantizer](archive/001-engine-interface.md) | Implemented | Pure-function APIs for `turing.ts` and `quantizer.ts`; types, semantics, shared test vectors. m4l reference impl 10/10 (2026-05-02). |

## M4L

The M4L ADRs (002–004) collectively define v1. v1 ships when ADRs 002,
003, and 004 all flip to *Implemented*.

| #   | Title | Status | Notes |
|-----|-------|--------|-------|
| 002 | [M4L Architecture — Stencil TM + Stencil QT](002-m4l-architecture.md) | Proposed | Two-device topology; per-device host/patcher/engine layering; live.* parameters; MIDI I/O & triggerMode; QT humanize layer; state ownership. |
| 003 | [M4L UI Design — Stencil TM / Stencil QT](003-m4l-ui-design.md) | Proposed | Double-height canvas; live.* params + 2 jsui widgets per device (TM clickable bit ring, QT pulse-animated scale keyboard); inboil visual identity (palette, monospace, panel pattern); logic-layer / renderer split per CLAUDE.md §GUI. |
| 004 | [M4L Bake & Distribution](004-m4l-bake-distribution.md) | Proposed | Bake script port (TM/QT argv); bare-sibling path conventions; abs-path / external-ref guard tests; dist/ tracking; bundle vs split listing; listing material requirements. |

## VST

VST is post-v1. The target is paused at scaffold state while m4l v1
ships; it will get its own architecture ADR(s) when picked up. Engine
spec and shared test vectors carry over via ADR 001; the m4l-specific
ADRs (002–004) do not necessarily apply (e.g. two-device topology may
become single-plugin in VST).

| #   | Title | Status | Notes |
|-----|-------|--------|-------|
