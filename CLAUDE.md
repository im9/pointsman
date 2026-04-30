# Stencil

Turing Machine + Quantizer probabilistic sequence generator MIDI effect.
Named after Herbert Stencil from Thomas Pynchon's *V.*

## Targets

Stencil is developed in parallel across multiple targets that share the same
musical concept (Turing Machine shift register + scale quantizer) but differ
in UI and platform. Each target lives in its own directory and has its own
build system. **Both targets are first-class production releases**, not
prototypes for one another.

- `m4l/` — **Max for Live** device (current primary target). Ableton Live MIDI
  effect, Ableton-optimized. Fastest iteration path and matches the author's
  primary DAW workflow; ships as a standalone product.
- `vst/` — **VST3/AU** plugin (C++17/JUCE). DAW-native, cross-platform. Ships
  as a standalone product alongside m4l, on a slower cadence.

Core logic, parameter design, and ADRs are shared across targets via `docs/ai/`.
Code is not shared — each target is a ground-up implementation in its native
stack.

## Origin

Generative engine extracted from [inboil](https://github.com/im9/inboil)
(browser-based groove box). inboil's Turing Machine and Quantizer generators
live in the scene graph as generative nodes — Stencil combines both into a
single standalone DAW-native MIDI effect.

Key references in inboil:
- `src/lib/sceneActions.ts` — `executeGenChain()`, Turing Machine + Quantizer logic
- `src/lib/types.ts` — `SceneNode.generative` field, TM/Quantizer parameters
- `docs/ai/adr/` — ADR 078 (generative nodes), related ADRs

The inboil implementation is JavaScript/Svelte. The `m4l/` target reuses the
TM+Quantizer logic style (TypeScript), while `vst/` is a C++17/JUCE
reimplementation — no code ported directly, but musical logic and parameter
design carry over.

## Layout

```
m4l/                 — Max for Live device
  engine/            — Turing Machine + Quantizer engine (TypeScript)
    *.ts             — pure logic, ES module
    *.test.ts        — node:test suite
    dist/            — compiled output (loaded by [node.script])
    tsconfig.json, package.json
  host/              — n4m host layer (TypeScript)
    *.ts             — Max protocol bridge, MIDI shaping
    *.test.ts        — node:test suite
    dist/            — compiled output
    index.js         — n4m entry, loaded by [node.script] in .amxd
    tsconfig.json, package.json
  Stencil.amxd       — Max for Live device
  Stencil.maxpat     — Max patcher source (track in git, .amxd is built artifact)
  package.json, pnpm-workspace.yaml
vst/                 — VST3/AU plugin (C++17/JUCE)
  Source/            — Plugin source
    PluginProcessor.*  — MIDI processing, TM + Quantizer engine
    PluginEditor.*     — GUI (shift register visualization)
  JUCE/              — JUCE framework (git submodule)
  tests/             — Catch2 unit tests
  CMakeLists.txt, Makefile
docs/ai/             — shared design docs, ADRs, test vectors
```

## Setup

```bash
git clone --recursive <repo-url>   # fetches the JUCE submodule under vst/
```

## Build

### m4l/

`m4l/` is a pnpm workspace. Packages: `@stencil/engine`, `@stencil/host`.

```bash
cd m4l
pnpm install         # first time, installs all workspace packages
pnpm -r test         # run tests across all packages
pnpm -r build        # compile dist/ for all packages
pnpm -r typecheck    # type-check without emit
```

Per-package (e.g. just engine):

```bash
cd m4l/engine
pnpm test            # run tests against TS source
pnpm build           # compile dist/ for jsui / [node.script]
```

Open `Stencil.amxd` in Max for Live to use the device. The device loads
`dist/` artifacts via `[node.script host/index.js]`, so run `pnpm -r build`
after engine or host changes.

**Do NOT add `max-api` to dependencies.** It's injected by Max at runtime;
the npm version conflicts with the injected one. (Same convention as Oedipa.)

### vst/

```bash
cd vst
make build     # configure + build (Release)
make debug     # configure + build (Debug)
make clean     # remove build directory
make test      # build + run tests
```

## Design

- MIDI effect: generates probabilistic note sequences, quantized to scale
- Turing Machine: shift register with probability-controlled bit flip
  (cf. Music Thing Turing Machine)
- Quantizer: constrains output to selected scale/mode
- Integrated as one device — generation and scale constraint in a single unit
- Parameters normalized in plugin/host layer
- Label: im9. Free distribution

## Mandatory Workflow

**Every implementation task follows these gates in order. Do not skip gates.
Do not reorder.**

### Gate 0 — Read before doing

Before writing any code:
1. Read `docs/ai/concept.md` (when created)
2. Read relevant ADR in `docs/ai/adr/` (when created)

### Gate 1 — Tests first (TDD)

**Write or update tests BEFORE editing any implementation file.** This applies
per target:

- `m4l/` — update `m4l/<package>/*.test.ts` before editing `m4l/<package>/*.ts`
- `vst/` — update `vst/tests/*` before editing `vst/Source/*`

Applicable cases:

- New feature → write tests that describe the expected behavior
- Bug fix → write a test that reproduces the bug
- Refactor → verify existing tests cover the behavior, add if not
- Constant/enum changes that propagate across files → write a consistency test
  that asserts the new count and accesses all indices

#### Shared test vectors

Cross-target engine semantics (Turing Machine bit flip behavior, Quantizer
scale mapping) should be captured in `docs/ai/turing-test-vectors.json` (when
created). Each target's test suite reads this JSON and iterates the cases.
When adding a new semantic case, add it to the JSON — do not duplicate the
data in per-target test code.

#### GUI / UI components

UI work cannot be unit-tested the way pure logic can — visual quality,
interaction feel, and host loading behavior require human eyes and a real DAW.
Split UI components into a **logic layer** (parameter mapping, state machines,
hit testing, drag-to-value math) and a **renderer** (the actual drawing).
Tests target the logic layer; the renderer reads model state and is not
unit-tested.

- **vst/ (JUCE)**: Instantiate the component in the test, simulate input via
  the public JUCE API (`mouseDown` / `mouseDrag` / `mouseUp` / `keyPressed`),
  and assert against parameter values and internal state. Expose minimal
  `getXxxForTest()` inspection methods only when state is otherwise private.
- **m4l/ (jsui)**: Keep logic functions as pure exported TypeScript runnable
  in Node. Compile to `dist/` for jsui consumption. The jsui-specific drawing
  and event callbacks live in a thin wrapper that calls into the pure logic.
- Do not snapshot-test pixel output. Font rendering and environment
  differences make image hashing brittle.

What stays manual (not covered by Gate 1 tests):

- Visual quality — does the shift register / scale UI look right
- Interaction feel — tap / drag in the real host
- Host compatibility — load in Ableton (m4l, vst), load in Logic (vst), edit,
  save, reopen, verify no crash

These manual checks are part of pre-release verification, not optional polish.

### Gate 2 — Implement

Now edit implementation files. Keep changes minimal and focused.

### Gate 3 — Build and test

Run the target's test command:

- `m4l/` — `cd m4l && pnpm -r test` (runs `node --test` across workspace)
- `vst/` — `cd vst && make test`

For m4l, also run `pnpm -r build` to refresh `dist/` artifacts before loading
the device in Live. `pnpm -r typecheck` checks types without emitting.

All tests must pass. Do not proceed with failing tests.

### Gate 4 — Commit (only with explicit approval)

**Never commit or push without explicit user approval.** Even after `/commit`,
confirm before creating a commit.

## Conventions

- All in English
- Commit messages: imperative mood, concise
