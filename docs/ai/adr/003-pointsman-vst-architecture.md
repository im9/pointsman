# ADR 003: Pointsman vst — architecture

## Status: Proposed

**Created**: 2026-05-10

This ADR sets the architecture for the Pointsman vst target: source
layout, plugin format, engine-vs-plugin-vs-editor boundary, parameter
persistence shape, UI direction, build / test infrastructure, and a
phased plan that takes the current cloned-Stencil scaffold under
[vst/](../../../vst/) to a Pointsman MIDI Effect that loads in Live
and Logic with the canonical parameter surface and the inboil-derived
UI wired up.

## Context

Pointsman is one product across two targets. The m4l side has shipped
([ADR 002](002-pointsman-release.md) v1.0.0 / v1.0.1 release flow);
the vst side is **the same scale quantizer for users on hosts where
Max for Live is not the right packaging** — Logic, Cubase, Bitwig,
or Live users who prefer a host-native MIDI effect over a Max device.
The musical motivation is identical — snap incoming MIDI to scale
with optional chord / harmony modes and a per-event humanize layer
— but the host surface is different (APVTS, JUCE Component, native
parameter automation), and the UI must read clearly inside a
host-drawn plugin window rather than a fixed-size Live device strip.

Current state under [vst/](../../../vst/) is the cloned Stencil
scaffold from the bootstrap event ([ADR 001](archive/001-pointsman-base.md)
§"Out of scope": *"vst/Source/ — left as the cloned scaffold;
rewritten when Pointsman vst work begins under a per-product
vst-architecture ADR"*). Concretely:

- [vst/CMakeLists.txt](../../../vst/CMakeLists.txt) names the project,
  bundle, plugin code, and product as `Stencil`.
- [vst/Source/](../../../vst/Source/) contains four files
  (`PluginProcessor.{h,cpp}`, `PluginEditor.{h,cpp}`) with `class
  StencilProcessor` / `class StencilEditor`, an empty `processBlock`,
  and a TODO for "Turing Machine + Quantizer MIDI processing".
- [vst/tests/test_TuringMachine.cpp](../../../vst/tests/test_TuringMachine.cpp)
  is the only test file, and it tests Stencil's TM generator —
  Pointsman has no TM (the equivalent would belong to `stencil`,
  not here).
- [vst/Makefile](../../../vst/Makefile) targets `stencil_tests` and
  opens `Stencil_artefacts/.../Stencil.app`.

The shared `docs/ai/concept.md` already pins the canonical parameter
surface (`scale` / `root` / `mode` / `harmonyVoices` / humanize /
`triggerMode` / `inputChannel` / `controlChannel` / `seed`), MIDI
semantics (panic on transport stop / bypass, polyphony preserved,
`mode = chord` controlChannel notes consumed), and the engine
algorithm (snap-to-nearest, `chord` snap with scale fallback,
diatonic harmony voice stack). The vst implementation is a port of
**that musical model** into C++17 / JUCE — no code is moved across
from `m4l/`, but the engine semantics and parameter shape are pinned
by the shared test vectors at
[docs/ai/quantizer-test-vectors.json](../../../docs/ai/quantizer-test-vectors.json)
and [docs/ai/rng-test-vectors.json](../../../docs/ai/rng-test-vectors.json).

The reference implementation for source layout / CMake split / test
plumbing is `~/src/vst/oedipa` — same author, same JUCE conventions,
same test-vector approach, with a working three-layer split
(`Source/Engine/`, `Source/Plugin/`, `Source/Editor/`) that keeps the
engine reusable and lets tests link against the processor without
pulling in the AU / VST3 wrappers. The reference for UI is
`~/src/front/inboil/src/lib/components/QuantizerSheet.svelte` — the
same musical surface (multi-octave keyboard with in-scale dot,
chord-tier highlight, mode pills, harmony voice badges) on the
original web product Pointsman is extracted from.

## Decision

Replace the cloned Stencil scaffold with a Pointsman implementation
under three source subdirectories whose boundary is **what they may
link against**:

```
vst/
  CMakeLists.txt                  — targets: pointsman_engine,
                                              pointsman_plugin_core,
                                              Pointsman, pointsman_tests
  Makefile                        — make build / debug / test / clean / open
  Source/
    Engine/                       — pure C++17, NO juce_* link
      Rng.h                       — xoshiro128++ + SplitMix64; parity with
                                    docs/ai/rng-test-vectors.json
      Quantizer.{h,cpp}           — SCALE_INTERVALS, buildScalePitches,
                                    snapToScale, snapToChordTones,
                                    diatonicShift; parity with
                                    docs/ai/quantizer-test-vectors.json
      Humanize.{h,cpp}            — per-event draws + EMA drift smoothing
      State.h                     — POD: HarmonyVoice, ChordContext,
                                    ScaleName enum
    Plugin/                       — APVTS + AudioProcessor; links juce_*
      Parameters.{h,cpp}          — pid:: namespace + Choice strings +
                                    defaults:: + makeParameterLayout()
      PluginProcessor.{h,cpp}     — wraps Engine; processBlock;
                                    panic / chord-context / state I/O
    Editor/                       — JUCE UI; links juce_gui_*
      PluginEditor.{h,cpp}        — top-level container
      ScaleKeyboardView.{h,cpp}   — inboil-derived keyboard (logic + render)
      ControlsView.{h,cpp}        — inboil-derived right rail
      Theme.{h,cpp}               — inboil palette (cream / olive / dark)
  tests/
    main.cpp                      — JUCE init/shutdown around Catch2 session
    test_Rng.cpp                  — JSON vectors
    test_Quantizer.cpp            — JSON vectors
    test_Humanize.cpp             — seeded fixtures
    test_Plugin.cpp               — APVTS round-trip, panic, MIDI semantics
    test_Editor.cpp               — view logic via JUCE event API
```

### Plugin format

VST3 + AU only — no Standalone, no CLAP. Pointsman is a MIDI Effect
with no audio output; Standalone for a MIDI-only effect routes to
virtual MIDI ports rather than producing sound, which is a hardware
integration use case orthogonal to the in-DAW musical role Pointsman
is designed for. CLAP is unrequested by `concept.md` and adds no
musical capability the two named hosts (Live, Logic) do not already
get from VST3 / AU. Both can be added later without touching engine
or editor code.

The CMake target's identity:

| Field | Value |
|---|---|
| project | `Pointsman` |
| `COMPANY_NAME` | `im9` |
| `BUNDLE_ID` | `com.im9.pointsman` |
| `PLUGIN_MANUFACTURER_CODE` | `Im9x` |
| `PLUGIN_CODE` | `Pntm` |
| `PRODUCT_NAME` | `Pointsman` |
| `FORMATS` | `VST3 AU` |
| `IS_MIDI_EFFECT` | `TRUE` |
| `NEEDS_MIDI_INPUT` | `TRUE` |
| `NEEDS_MIDI_OUTPUT` | `TRUE` |
| `COPY_PLUGIN_AFTER_BUILD` | `TRUE` |

`COPY_PLUGIN_AFTER_BUILD TRUE` skips manual symlink / copy of the
built bundle into `~/Library/Audio/Plug-Ins/{VST3,Components}` for
the Logic / Live dev loop.

### Engine boundary (`pointsman_engine`)

Pure C++17 STATIC library. **No `juce_*` link or include.** Both the
plugin and the test binary depend on it. This is the strict
portability boundary — the same boundary `oedipa_engine` carries —
and is the precondition for any later non-JUCE consumer (iOS, CLI
batch processor) reusing the quantizer without dragging the host
framework along. The boundary is enforced by a CMake-time guarantee
(no juce_* in `target_link_libraries`), not by review.

The TS → C++ port targets behavioral parity, not syntactic transcription:

- `SCALE_INTERVALS` becomes a `constexpr std::array<...>` per scale
  name with a `chromatic-half` identity branch in `buildScalePitches`.
- `snapToScale` uses `std::lower_bound` (binary search,
  tie-to-lower contract preserved).
- `snapToChordTones` mirrors inboil tolerance = 2 semitones default;
  empty `chordPcs` falls through to `snapToScale`.
- `diatonicShift` mirrors interval = N → N-1 scale-step semantics
  with clamping (not wrapping) at scale extremes.
- `Humanize` carries per-axis EMA accumulators reset on transport
  start; the EMA `1.0` degenerate case is documented at the call
  site (concept.md §"Per-event humanize").

The shared test vectors at
[docs/ai/quantizer-test-vectors.json](../../../docs/ai/quantizer-test-vectors.json)
and [docs/ai/rng-test-vectors.json](../../../docs/ai/rng-test-vectors.json)
are the cross-target conformance contract; the engine ships when both
test files iterate green.

### Plugin core boundary (`pointsman_plugin_core`)

A second STATIC library carries `Source/Plugin/*.cpp` and
`Source/Editor/*.cpp` against `juce_audio_basics`,
`juce_audio_processors`, `juce_audio_utils`, `juce_gui_basics`, and
`juce_gui_extra` — but **not** `juce_audio_plugin_client`, which
provides the AU / VST3 wrappers and is plugin-only. The test binary
links `pointsman_plugin_core` instead of the `Pointsman` plugin
target, so APVTS round-trips and editor-instantiation tests can run
in a console binary without the wrapper layer trying to load.

### Parameter persistence (APVTS)

APVTS holds every parameter from `concept.md` §"Parameter surface
(canonical)" that the host parameter system can natively represent.
The pid identifiers and Choice index orderings are the on-disk
format and may **only be appended**, never reordered.

| pid | APVTS type | Choices / range / default |
|---|---|---|
| `scale` | Choice | 15 names, default `major` (idx 0) |
| `root` | Int | `0..11`, default `0` |
| `mode` | Choice | `scale` / `chord` / `harmony`, default `scale` |
| `humanizeVelocity` | Float | `0..1`, default `0` |
| `humanizeGate` | Float | `0..1`, default `0` |
| `humanizeTiming` | Float | `0..1`, default `0` |
| `humanizeDrift` | Float | `0..1`, default `0` |
| `outputLevel` | Float | `0..1`, default `1.0` |
| `triggerMode` | Choice | `passthrough` / `root`, default `passthrough` |
| `inputChannel` | Int | `0..16` (0 = omni), default `0` |
| `controlChannel` | Int | `1..16`, default `1` |
| `seed` | Int | `0..2^31-1`, default `0` |

`harmonyVoices` is variable-length (0..3 entries) and serializes into
a child `ValueTree` of `apvts.state` under tag `PointsmanState` with
attributes `version="1"`, and per-entry `interval` (3 / 4 / 5 / 6) +
`direction` (`above` / `below`). `getStateInformation` /
`setStateInformation` are implemented on the processor; the round-trip
is validated by `test_Plugin.cpp`.

### Editor (inboil-derived)

The UI is a 2-column layout that mirrors the inboil
`QuantizerSheet.svelte` — keyboard on the left, right-rail controls
— with inboil-only scene-graph affordances (Target / Track / Preset
/ Merge) **removed** because Pointsman vst is a MIDI Effect, not a
generative scene node:

```
┌────────────────────────────────────────────────────────────┐
│ POINTSMAN                                                × │ ← header
├────────────────────────────────────────┬───────────────────┤
│                                        │ Scale             │ ← right rail
│                                        │  SCALE [ ... ▾ ]  │   (fixed
│                                        │  ROOT  [ C  ▾ ]   │    width)
│                                        │                   │
│                                        │ Mode              │
│   ┌─keyboard (3 oct, multi-octave)─┐   │  [SCALE][CHORD]   │
│   │ ▮▯▮▮▯▮▮ ▮▯▮▮▯▮▮ ▮▯▮▮▯▮▮       │   │  [HARMONY]        │
│   │ C D E F G A B  …               │   │  snap to nearest  │
│   │ • • • • • • •                  │   │  scale degree     │
│   └────────────────────────────────┘   │                   │
│                                        │ Harmony           │
│                                        │  [3rd above ×]    │
│                                        │  [+]              │
│                                        │                   │
│                                        │ Humanize          │
│                                        │  VEL  [─────●──]  │
│                                        │  GATE [──●─────]  │
│                                        │  TIM  [●───────]  │
│                                        │  DRFT [●───────]  │
│                                        │  OUT  [────────●] │
│                                        │                   │
│                                        │ Routing           │
│                                        │  IN  ch [omni ▾]  │
│                                        │  CTL ch [ 1   ▾]  │
│                                        │  TRIG [pass▾]     │
│                                        │  SEED [    0   +] │
└────────────────────────────────────────┴───────────────────┘
```

Per-pane behavior carried over from `QuantizerSheet.svelte`:

- **Keyboard**: white + black keys across three octaves
  (`KBD_OCT_LO=3`..`KBD_OCT_HI=5`), with an in-scale dot under each
  scale degree, an olive chord-tier highlight on `mode = chord` for
  pitch classes in the current chord context, and a brief pulse on
  the most recently emitted output note. Tap on a key sets `root` to
  the tapped pitch class (the inboil `tapKey` semantics).
- **Mode pills**: three-button segmented control; the active pill is
  olive-bordered, others are dimmed. A one-line description below
  ("snap to nearest scale degree" / "snap to chord tones" / "add
  parallel diatonic voices") changes with the active mode.
- **Harmony voices**: 0..3 badges, each with an interval select
  (3rd / 4th / 5th / 6th) and direction select (above / below);
  `+` adds, `×` removes. Visible only when `mode = harmony`.

inboil sections **dropped** for the vst port:

- **Target / Track** — inboil routes generator output into a scene
  graph track; vst output is the host's MIDI bus. Pointsman emits
  notes; the host owns where they go.
- **Preset / Merge / Fill** — inboil writes baked output back into
  pattern cells; vst is real-time and emits per-event, so there is
  nothing to "merge" or "fill". Preset slots are listed in
  concept.md "Future extensions" and are deferred until the device
  is in real use.
- **Manual `chords[]` editor** — concept.md collapses inboil's two
  chord-context paths into one input contract: real-time MIDI on
  `controlChannel`. The vst editor does not need a chord-add UI.

inboil sections **added** for the vst port (not present in
QuantizerSheet because inboil's humanize and routing live elsewhere
in the scene graph):

- **Humanize** — five sliders (velocity / gate / timing / drift /
  outputLevel) per concept.md §"Per-event humanize".
- **Routing** — `inputChannel`, `controlChannel`, `triggerMode`,
  `seed` per concept.md §"MIDI semantics" and §"Parameter surface".

### UI logic / renderer split

Per [CLAUDE.md](../../../CLAUDE.md) §"GUI / UI components": each view
splits into a **logic layer** (testable) and a **renderer**
(manual). For the vst (JUCE), the logic layer is exposed as
`getXxxForTest()` inspectors on the Component; tests instantiate the
view and drive it via `mouseDown` / `mouseDrag` / `mouseUp` /
`keyPressed`, then assert against APVTS values and the inspector
output. No pixel snapshot tests.

Specifically:

- `ScaleKeyboardView::getKeyAtForTest(juce::Point<int>)` returns the
  pitch class hit at a coordinate (drives the tap-sets-root test).
- `ScaleKeyboardView::getInScalePcsForTest()` returns the dot set
  (drives the SCALE_INTERVALS-mirror test).
- `ControlsView::getModeButtonsForTest()` exposes the three mode
  pills for click-then-assert-APVTS tests.

Visual quality, font / kerning, host-paint cadence, and the actual
look at 100% / 150% UI scaling stay manual checks against Live and
Logic.

## Persistence

APVTS state goes through JUCE's standard `getStateInformation` /
`setStateInformation`, which serializes `apvts.state` plus the
`PointsmanState` child ValueTree carrying `harmonyVoices`. State
version is `kStateVersion = 1`. There is no migration from any
prior shape — vst v1 is the first persisted format.

## Scope

### In scope

- Scaffold removal under [vst/](../../../vst/): rename CMake project
  / bundle / plugin code / product, drop Standalone format, drop
  TM-only test, replace four-file `Source/` flat layout with the
  three-subdir split.
- `pointsman_engine`: pure C++17 port of `Quantizer`, `Rng`, and
  `Humanize` validated against the shared JSON vectors.
- `pointsman_plugin_core`: APVTS layout, processor with MIDI in / out
  + transport panic + state I/O + chord-context maintenance from
  controlChannel notes.
- `Pointsman` plugin: VST3 + AU bundles built and copied to user
  plug-in folders; loads in Live and Logic.
- Editor: inboil-derived keyboard + right rail with mode pills,
  harmony badges, humanize sliders, routing controls; logic-layer
  tests via JUCE event API.
- Test infrastructure: Catch2 v3 + nlohmann/json v3 via
  `FetchContent`; custom `tests/main.cpp` owning JUCE init / shutdown.
- Manual-host verification gate at the end of each phase (see
  Implementation checklist below) — bundling all phases into one
  end-of-batch check is the failure mode `feedback_audit_overreach`
  was logged from.

### Out of scope

- **Distribution channel and pricing.** Whether Pointsman vst ships
  free, paid, in a per-product GitHub repo, or via a different
  channel is decided in a follow-up ADR. Architecture choices made
  here (no `clap-juce-extensions` dependency, source kept private-eligible)
  do not foreclose any of those distribution options. Musical
  reasoning for deferral: the architecture has no audible
  consequence; pricing and channel are commercial decisions that
  should not block engine work.
- **CLAP format.** Both the named target hosts (Live, Logic) accept
  VST3 / AU; the musical experience for a v1 user is identical with
  or without CLAP. CLAP can be added later via
  `clap-juce-extensions` without touching engine or editor code, so
  deferring it costs nothing.
- **Standalone format.** Pointsman is MIDI-only — Standalone would
  require virtual-MIDI routing setup that is not part of the in-DAW
  musical surface. Deferred until a hardware-MIDI workflow asks for
  it.
- **iOS reuse of `pointsman_engine`.** The pure-C++17 boundary keeps
  the door open, but no iOS host is in scope here. Mentioned only
  to justify the engine-vs-plugin link separation.
- **Preset / slot system, MPE output, microtonal scales, custom
  scales, pitch-class scale editing.** All listed in concept.md
  "Future extensions"; v1 surface stays the canonical 15 presets
  and the harmonyVoices array.
- **Cross-target preset converter** (m4l preset ↔ vst preset). The
  pid + Choice-index mapping is intentionally close to the m4l
  HostParams shape so a converter is feasible later, but writing one
  is not part of this ADR.
- **MIDI clock / transport tempo display in the UI.** Pointsman is
  input-driven; the editor does not need a transport readout.
- **vst Releases / installer / signing.** Covered by the
  distribution ADR.

## Implementation checklist

Phased per [CLAUDE.md](../../../CLAUDE.md) Mandatory Workflow gates:
tests first within each phase, then implementation, then build /
test, then manual-host verification before moving to the next phase.
Each phase's manual gate exists because tests cover code-vs-spec but
not host-runtime behaviour
(`feedback_audit_overreach` 2026-05-09 lesson).

### Phase 0 — Scaffold removal + project rename

- [ ] [vst/CMakeLists.txt](../../../vst/CMakeLists.txt): rename
      project to `Pointsman`, `BUNDLE_ID` to `com.im9.pointsman`,
      `PLUGIN_CODE` to `Pntm`, `PRODUCT_NAME` to `Pointsman`,
      `FORMATS` to `VST3 AU` (drop Standalone), add
      `COPY_PLUGIN_AFTER_BUILD TRUE`.
- [ ] [vst/Makefile](../../../vst/Makefile): rename `stencil_tests`
      → `pointsman_tests`, drop the `open` target referencing
      `Stencil.app` (Standalone is dropped) or repoint it at the
      VST3 bundle path for dev convenience.
- [ ] Delete [vst/Source/PluginProcessor.cpp](../../../vst/Source/PluginProcessor.cpp),
      [vst/Source/PluginProcessor.h](../../../vst/Source/PluginProcessor.h),
      [vst/Source/PluginEditor.cpp](../../../vst/Source/PluginEditor.cpp),
      [vst/Source/PluginEditor.h](../../../vst/Source/PluginEditor.h)
      — these are the cloned Stencil scaffold; replaced under
      `Source/Plugin/` and `Source/Editor/` in Phase 2 / 3.
- [ ] Delete [vst/tests/test_TuringMachine.cpp](../../../vst/tests/test_TuringMachine.cpp)
      — TM is not a Pointsman concept.
- [ ] Refresh [README.md](../../../README.md) and
      [CLAUDE.md](../../../CLAUDE.md) `vst/` sections to reflect the
      new layout and rename. Delete any "TODO: Turing Machine"
      breadcrumbs.
- [ ] Manual gate: `cd vst && make clean && make build` succeeds
      (the rename does not regress the JUCE build); the empty
      Pointsman bundle loads as a placeholder MIDI Effect in Live
      and Logic without console errors.

### Phase 1 — Engine + tests

- [ ] Create [docs/ai/adr/003-pointsman-vst-architecture.md](003-pointsman-vst-architecture.md)
      — this file (already authored as part of starting Phase 0).
- [ ] Add Catch2 v3 + nlohmann/json v3 via `FetchContent` in
      `CMakeLists.txt` (mirror the oedipa pattern; force
      `JSON_BuildTests OFF`).
- [ ] Add `pointsman_engine` STATIC library target to
      `CMakeLists.txt`; assert at CMake time that no `juce_*` is in
      its `target_link_libraries`.
- [ ] Write `tests/main.cpp` with explicit `juce::initialiseJuce_GUI()`
      / `juce::shutdownJuce_GUI()` around the Catch2 session.
- [ ] Write `tests/test_Rng.cpp` reading
      `docs/ai/rng-test-vectors.json` via nlohmann/json; expect
      bit-identical output with the m4l engine vectors.
- [ ] Implement `Source/Engine/Rng.h` (xoshiro128++ + SplitMix64
      seeding); confirm `test_Rng` passes.
- [ ] Write `tests/test_Quantizer.cpp` reading
      `docs/ai/quantizer-test-vectors.json`; expect parity for
      `buildScalePitches`, `snapToScale`, `snapToChordTones`,
      `diatonicShift`.
- [ ] Implement `Source/Engine/Quantizer.{h,cpp}` and
      `Source/Engine/State.h`; confirm `test_Quantizer` passes.
- [ ] Write `tests/test_Humanize.cpp` with seeded fixtures asserting
      EMA convergence behaviour, `1.0` freeze degeneracy, and
      transport-start reset.
- [ ] Implement `Source/Engine/Humanize.{h,cpp}`; confirm
      `test_Humanize` passes.
- [ ] Manual gate: `cd vst && make test` runs all engine tests
      green. No host involvement needed at this phase.

### Phase 2 — Plugin (APVTS + processor)

- [ ] Add `pointsman_plugin_core` STATIC library target to
      `CMakeLists.txt` (links juce_audio_*, juce_gui_*, NOT
      juce_audio_plugin_client). Update `Pointsman` and
      `pointsman_tests` to depend on it.
- [ ] Write `tests/test_Plugin.cpp`: APVTS round-trip
      (default-construct → mutate every pid → `getStateInformation`
      → fresh processor → `setStateInformation` → assert all values
      match), `harmonyVoices` ValueTree round-trip, panic on
      transport stop, controlChannel chord-context maintenance,
      `mode = chord` controlChannel notes consumed (do not appear
      on output).
- [ ] Implement `Source/Plugin/Parameters.{h,cpp}` (pid namespace,
      Choice arrays, defaults namespace, `makeParameterLayout()`).
- [ ] Implement `Source/Plugin/PluginProcessor.{h,cpp}`: APVTS
      construction, MIDI in / out, panic discipline,
      controlChannel chord-context maintenance, state I/O.
- [ ] Confirm `test_Plugin` passes.
- [ ] Manual gate: load the Pointsman VST3 in Live and the AU in
      Logic. All canonical parameters appear in the host parameter
      list, accept automation, and round-trip across a save / close
      / reopen of the host project. MIDI input on a track produces
      quantized output with `mode = scale` defaults; no hung notes
      after transport stop; bypass leaves no hung notes.

### Phase 3 — Editor (inboil-derived UI)

- [ ] Write `tests/test_Editor.cpp`: instantiate
      `ScaleKeyboardView`, simulate `mouseDown` on a known key
      coordinate, assert APVTS `root` updated; instantiate
      `ControlsView`, click each mode pill, assert APVTS `mode`
      cycles; click `+` on harmony badges, assert
      `harmonyVoices` ValueTree grows.
- [ ] Implement `Source/Editor/Theme.{h,cpp}` carrying the inboil
      palette (cream `--color-bg`, olive `--color-olive`, dark
      `--color-fg`).
- [ ] Implement `Source/Editor/ScaleKeyboardView.{h,cpp}`:
      multi-octave keyboard, in-scale dots, chord-tier highlight,
      pulse-on-emit, tap-sets-root. Logic-layer inspectors per
      §"UI logic / renderer split" above.
- [ ] Implement `Source/Editor/ControlsView.{h,cpp}`: Scale group
      (SCALE / ROOT), Mode group (3 pills + descriptive text),
      Harmony group (interval / direction badges, max 3),
      Humanize group (5 sliders), Routing group (input / control
      channel / trigger / seed).
- [ ] Implement `Source/Editor/PluginEditor.{h,cpp}` composing the
      two views in the inboil 2-column layout; size the editor for
      the controls + a sensible keyboard width.
- [ ] Confirm `test_Editor` passes.
- [ ] Manual gate: in Live and Logic, the editor opens with the
      keyboard + right rail visible; tapping a key sets root and
      the keyboard updates; mode pills cycle and the description
      text changes; harmony badges add / remove voices and the
      output reflects them; humanize sliders perturb output; light
      / dark host themes both render readably (or document the v1
      light-only choice if dark is out of v1 scope, mirroring the
      m4l theme decision in [ADR 002](002-pointsman-release.md)).

## Per-target notes

The shared test vectors at
[docs/ai/quantizer-test-vectors.json](../../../docs/ai/quantizer-test-vectors.json)
and [docs/ai/rng-test-vectors.json](../../../docs/ai/rng-test-vectors.json)
are the cross-target conformance contract — both `m4l/engine/*` and
`vst/Source/Engine/*` iterate them. When this ADR's Phase 1 work
finds a behavioural ambiguity in the existing vectors (e.g.
unspecified tie-break in a snap edge case), the resolution updates
the JSON, then both target test suites are re-run. Per ADR 001:
*do not duplicate the data in per-target test code.*

The `pid` strings and Choice index orderings in `Parameters.h` are
intentionally chosen to mirror the m4l `HostParams` shape so a
later cross-target preset converter is a straight rename + index
mapping. Until that converter exists, m4l and vst presets are not
interchangeable.
