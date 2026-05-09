# Pointsman

Scale quantizer for MIDI: snaps incoming notes to a user-selected
scale, with optional chord-mode and harmony-mode (diatonic voice
stack), and a per-event humanize layer. MIDI effect, DAW-native.
Named after Edward Pointsman from Thomas Pynchon's *Gravity's
Rainbow* — the railway-pointsman metaphor (routing an incoming
train to a discrete track) is exact for what a quantizer does
(routing input pitch to a discrete scale degree).

## Targets

Pointsman is developed in parallel across multiple targets that
share the same musical concept (scale quantizer with mode = scale
/ chord / harmony) but differ in UI and platform. Each target
lives in its own directory and has its own build system. **Both
targets are first-class production releases**, not prototypes for
one another.

- `m4l/` — **Max for Live** device (current primary target).
  Ableton Live MIDI effect, Ableton-optimized. Fastest iteration
  path and matches the author's primary DAW workflow; ships as a
  standalone product.
- `vst/` — **VST3 + AU MIDI Effect** plugin (C++17/JUCE).
  DAW-native, cross-platform. Ships as a standalone product
  alongside m4l, on a slower cadence. Single-purpose MIDI Effect
  format (VST3 + AU).

Core logic, parameter design, and ADRs are shared across this
repo's targets via `docs/ai/`. Code is not shared between
targets — each target is a ground-up implementation in its native
stack.

## Origin

Generative engine extracted from
[inboil](https://github.com/im9/inboil) (browser-based groove
box). inboil's Quantizer generator lives in the scene graph as a
generative node; Pointsman ships it as a single standalone
DAW-native MIDI effect.

Key references in inboil:
- `src/lib/sceneActions.ts` — `executeGenChain()`, Quantizer logic
- `src/lib/types.ts` — `SceneNode.generative` field, Quantizer
  parameters
- `docs/ai/adr/` — ADR 078 (generative nodes), related ADRs

The inboil implementation is JavaScript/Svelte. The `m4l/` target
reuses the Quantizer logic style (TypeScript), while `vst/` is a
C++17/JUCE reimplementation — no code ported directly, but
musical logic and parameter design carry over.

## Layout

```
m4l/                 — Max for Live device
  engine/            — Quantizer + RNG (TypeScript)
    rng.ts             shared RNG primitives (xoshiro128++ + SplitMix64)
    rng.test.ts        vectors against docs/ai/rng-test-vectors.json
    quantizer.ts       scale snap + chord-tone + diatonic harmony
    quantizer.test.ts  vectors against docs/ai/quantizer-test-vectors.json
    dist/              compiled output (loaded by host)
    package.json, tsconfig.json
  host/              — n4m host layer (TypeScript)
    bridge.ts, host.ts, humanize.ts, *.test.ts
    ui/                jsui logic + tests
    dist/              compiled output
    package.json, tsconfig.json
  pointsman.mjs      — n4m entry, loaded by [node.script] (flat path)
  scaleKeyboard.jsui.js — keyboard renderer (flat path; loaded by [jsui])
  Pointsman.maxpat   — Max patcher source (tracked in git)
  Pointsman.amxd     — Max for Live device (built artifact, tracked)
  scripts/
    maxpat-to-amxd.mjs   bake script (single product, no argv)
  package.json, pnpm-workspace.yaml
vst/                 — VST3 + AU MIDI Effect plugin (C++17/JUCE)
  Source/            — Plugin source (post per-product
                       vst-architecture ADR)
  JUCE/              — JUCE framework (git submodule)
  tests/             — Catch2 unit tests
  CMakeLists.txt, Makefile
docs/ai/             — design docs, ADRs, test vectors
  concept.md
  rng-test-vectors.json
  quantizer-test-vectors.json
  adr/
```

## Setup

```bash
git clone --recursive <repo-url>   # fetches the JUCE submodule under vst/
```

## Build

### m4l/

`m4l/` is a pnpm workspace. Packages: `@pointsman/engine`, `@pointsman/host`, `@pointsman/scripts`.

```bash
cd m4l
pnpm install         # first time, installs all workspace packages
pnpm -r test         # run tests across all packages
pnpm -r build        # compile dist/ for all packages
pnpm -r typecheck    # type-check without emit
pnpm bake            # rebuild Pointsman.amxd from Pointsman.maxpat
pnpm bake:check      # guard tests on .maxpat (abs-path scrub, sibling-file resolve)
```

Per-package (e.g. just engine):

```bash
cd m4l/engine
pnpm test            # run tests against TS source
pnpm build           # compile dist/
```

Open `Pointsman.amxd` in Max for Live to use the device. The
device loads `dist/` artifacts via `[node.script pointsman.mjs]`
— `pointsman.mjs` is the esbuild-bundled output of
`pointsman.entry.mjs` (run `pnpm bake` to refresh both the
bundle and `Pointsman.amxd`). Run `pnpm -r build` after engine
or host changes, and `pnpm bake` after engine / host / `.maxpat`
edits.

**Do NOT add `max-api` to dependencies.** It's injected by Max at
runtime; the npm version conflicts with the injected one.

**Distribution (release builds).** `make release` (from repo
root) runs build + bake and prepares `dist/`. The baked dev
`.amxd` references sibling JS on disk, so it only loads on the
build machine. To ship: open `m4l/Pointsman.amxd` in Max → click
the **snowflake (Freeze)** button in the patcher toolbar
(inlines every referenced JS) → *File → Save As*
`dist/Pointsman.amxd`. The frozen file is self-contained and
works on any Live install. See ADR 002 §Phase 0.

### vst/

```bash
cd vst
make build     # configure + build (Release)
make debug     # configure + build (Debug)
make clean     # remove build directory
make test      # build + run tests
```

## Design

- MIDI effect: snaps incoming notes to scale, with optional
  chord/harmony modes and humanize
- Quantizer: snap-to-nearest scale degree (15 scale presets
  matching inboil)
- Modes: `scale` (default) / `chord` (snap to chord-tone with
  scale fallback) / `harmony` (input + diatonic voice stack)
- Chord context source: real-time MIDI on a control channel
  (held notes form the current chord), collapsing inboil's
  manual `chords[]` and `chordSource` paths into one input
  contract
- Per-event humanize: velocity / gate / timing / drift, all
  seeded for reproducibility
- Pairs naturally upstream with any MIDI sequence source for
  the canonical `<source> → Pointsman → Synth` chain
- Parameters normalized in plugin/host layer
- Label: im9. Free distribution.

## Mandatory Workflow

**Every implementation task follows these gates in order. Do not
skip gates. Do not reorder.**

### Gate 0 — Read before doing

Before writing any code:
1. Read `docs/ai/concept.md`
2. Read relevant ADR in `docs/ai/adr/`

### Gate 1 — Tests first (TDD)

**Write or update tests BEFORE editing any implementation file.**
This applies per target:

- `m4l/` — update `m4l/<package>/*.test.ts` before editing
  `m4l/<package>/*.ts`
- `vst/` — update `vst/tests/*` before editing `vst/Source/*`

Applicable cases:

- New feature → write tests that describe the expected behavior
- Bug fix → write a test that reproduces the bug
- Refactor → verify existing tests cover the behavior, add if not
- Constant/enum changes that propagate across files → write a
  consistency test that asserts the new count and accesses all
  indices

#### Shared test vectors

Cross-target engine semantics (Quantizer scale mapping, RNG
primitives) are captured in
`docs/ai/quantizer-test-vectors.json` and
`docs/ai/rng-test-vectors.json`. Each target's test suite reads
the appropriate JSON and iterates the cases.

When adding a new semantic case, add it to the JSON — do not
duplicate the data in per-target test code.

#### GUI / UI components

UI work cannot be unit-tested the way pure logic can — visual
quality, interaction feel, and host loading behavior require
human eyes and a real DAW. Split UI components into a **logic
layer** (parameter mapping, state machines, hit testing,
drag-to-value math) and a **renderer** (the actual drawing).
Tests target the logic layer; the renderer reads model state and
is not unit-tested.

- **vst/ (JUCE)**: Instantiate the component in the test,
  simulate input via the public JUCE API (`mouseDown` /
  `mouseDrag` / `mouseUp` / `keyPressed`), and assert against
  parameter values and internal state. Expose minimal
  `getXxxForTest()` inspection methods only when state is
  otherwise private.
- **m4l/ (jsui)**: Keep logic functions as pure exported
  TypeScript runnable in Node. Compile to `dist/` for jsui
  consumption. The jsui-specific drawing and event callbacks
  live in a thin wrapper that calls into the pure logic.
- Do not snapshot-test pixel output. Font rendering and
  environment differences make image hashing brittle.

What stays manual (not covered by Gate 1 tests):

- Visual quality — does the scale keyboard UI look right
- Interaction feel — tap / drag in the real host
- Host compatibility — load in Ableton (m4l, vst), load in
  Logic (vst), edit, save, reopen, verify no crash

These manual checks are part of pre-release verification, not
optional polish.

### Gate 2 — Implement

Now edit implementation files. Keep changes minimal and focused.

### Gate 3 — Build and test

Run the target's test command:

- `m4l/` — `cd m4l && pnpm -r test` (runs `node --test` across
  workspace)
- `vst/` — `cd vst && make test`

For m4l, also run `pnpm -r build` to refresh `dist/` artifacts
and `pnpm bake` to refresh `Pointsman.amxd` before loading the
device in Live. `pnpm -r typecheck` checks types without
emitting.

All tests must pass. Do not proceed with failing tests.

### Gate 4 — Commit (only with explicit approval)

**Never commit or push without explicit user approval.** Even
after `/commit`, confirm before creating a commit.

## Conventions

- All in English
- Commit messages: imperative mood, concise
