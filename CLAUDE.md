# Stencil

Turing Machine + Quantizer probabilistic sequence generator MIDI effect plugin (VST3/AU).
Named after Herbert Stencil from Thomas Pynchon's *V.*

## Origin

Generative engine extracted from [inboil](https://github.com/im9/inboil) (browser-based groove box).
inboil's Turing Machine and Quantizer generators live in the scene graph as generative nodes —
Stencil combines both into a single standalone DAW-native MIDI effect.

Key references in inboil:
- `src/lib/sceneActions.ts` — `executeGenChain()`, Turing Machine + Quantizer logic
- `src/lib/types.ts` — `SceneNode.generative` field, TM/Quantizer parameters
- `docs/ai/adr/` — ADR 078 (generative nodes), related ADRs

The inboil implementation is JavaScript/Svelte. Stencil is a ground-up C++17/JUCE rewrite —
no code is ported directly, but the musical logic and parameter design carry over.

## Setup

```bash
git clone --recursive <repo-url>
make build
```

## Build

```bash
make build     # configure + build (Release)
make debug     # configure + build (Debug)
make clean     # remove build directory
make test      # build + run tests
```

## Architecture

```
Source/              — JUCE plugin source
  PluginProcessor.*  — MIDI processing, Turing Machine + Quantizer engine
  PluginEditor.*     — GUI (shift register visualization)
JUCE/                — JUCE framework (git submodule)
tests/               — Catch2 unit tests
docs/ai/             — design docs
```

## Design

- MIDI effect: generates probabilistic note sequences, quantized to scale
- Turing Machine: shift register with probability-controlled bit flip (cf. Music Thing Turing Machine)
- Quantizer: constrains output to selected scale/mode
- Integrated as one plugin — generation and scale constraint in a single unit
- Parameters normalized in plugin layer
- C++17
- Label: im9. Free distribution

## Mandatory Workflow

**Every implementation task follows these gates in order. Do not skip gates. Do not reorder.**

### Gate 0 — Read before doing

Before writing any code:
1. Read `docs/ai/concept.md` (when created)
2. Read relevant ADR in `docs/ai/adr/` (when created)

### Gate 1 — Tests first (TDD)

**Write or update tests BEFORE editing any file in `Source/`.**

- New feature → write tests that describe the expected behavior
- Bug fix → write a test that reproduces the bug
- Refactor → verify existing tests cover the behavior, add if not

### Gate 2 — Implement

Now edit `Source/` files. Keep changes minimal and focused.

### Gate 3 — Build and test

```bash
make test
```

All tests must pass. Do not proceed with failing tests.

### Gate 4 — Commit (only with explicit approval)

**Never commit or push without explicit user approval.**

## Conventions

- All in English
- Commit messages: imperative mood, concise
