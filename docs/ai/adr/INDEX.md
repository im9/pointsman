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

| #   | Title | Status | Notes |
|-----|-------|--------|-------|
| 002 | [M4L Architecture — Stencil TM + Stencil QT](002-m4l-architecture.md) | Proposed | Two-device topology; per-device host/patcher/engine layering; live.* parameters; MIDI I/O & triggerMode; QT humanize layer; state ownership. |

## VST

| #   | Title | Status | Notes |
|-----|-------|--------|-------|
