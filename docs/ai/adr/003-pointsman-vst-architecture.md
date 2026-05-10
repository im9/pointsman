# ADR 003: Pointsman vst — architecture

## Status: Proposed

**Created**: 2026-05-10

This ADR sets the architecture for the Pointsman vst target: source
layout, plugin format, engine-vs-plugin-vs-editor boundary, parameter
persistence shape, UI direction, build / test infrastructure, and a
phased plan that takes the current cloned-Stencil scaffold under
[vst/](../../../vst/) to a Pointsman MIDI Effect that loads in
Logic (AU) and Bitwig (CLAP / VST3) with the canonical parameter
surface and the inboil-derived UI wired up.

## Context

Pointsman is one product across two targets. The m4l side has shipped
([ADR 002](002-pointsman-release.md) v1.0.0 / v1.0.1 release flow);
the vst side is **the same scale quantizer for hosts the m4l target
cannot reach** — primarily Logic Pro (AU MIDI FX) and Bitwig Studio
(VST3 / CLAP note FX), plus best-effort Reaper. Ableton Live is
deliberately *not* a vst target: Live's MIDI Effect rack does not
accept third-party VST3 or AU plug-ins (host design, not a format
limitation), so Live users go through `m4l/` — the same split
documented in oedipa's DAW support matrix
(`~/src/vst/oedipa/README.md` §"DAW support").

The musical motivation is identical to m4l — snap incoming MIDI to
scale with optional chord / harmony modes and a per-event humanize
layer — but the host surface is different (APVTS, JUCE Component,
native parameter automation), and the UI must read clearly inside
a host-drawn plugin window rather than a fixed-size Live device
strip.

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

VST3 + AU + CLAP. No Standalone. Pointsman is a MIDI Effect with no
audio output; Standalone for a MIDI-only effect routes to virtual
MIDI ports rather than producing sound, which is a hardware
integration use case orthogonal to the in-DAW musical role Pointsman
is designed for. The three plug-in formats track the named host
matrix: AU is required for Logic, VST3 + CLAP for Bitwig (where
CLAP is the native plug-in format) and Reaper. The same matrix
shipped successfully on `oedipa` (see
`~/src/vst/oedipa/vst/CMakeLists.txt` and the README §"DAW support"
table).

CLAP is added via the `clap-juce-extensions` submodule, vendored at
the same SHA `oedipa` is pinned to
(`e8de9e8571626633b8541a54c2406fccc4272767`,
`v0.26.0-107-ge8de9e8`); `clap_juce_extensions_plugin(TARGET
Pointsman ...)` derives a `Pointsman_CLAP` target from the existing
`Pointsman` plug-in target, producing `Pointsman.clap` alongside
`Pointsman.vst3` / `Pointsman.component`.

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
| `CLAP_ID` (via `clap_juce_extensions_plugin`) | `com.im9.pointsman` |
| `CLAP_FEATURES` | `note-effect utility` |

`COPY_PLUGIN_AFTER_BUILD TRUE` skips manual symlink / copy of the
built bundles into `~/Library/Audio/Plug-Ins/{VST3,Components,CLAP}`
for the Logic / Bitwig / Reaper dev loop.

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
  site (concept.md §"Per-event humanize"). Phase 4 wired the gate /
  timing / drift axes into the processor's MIDI scheduler — every
  humanize parameter has audible effect at the plugin boundary, on
  parity with m4l's bridge.

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
| `seed` | Int | `0..2^24-1`, default `0` |

The `seed` upper bound is `2^24-1`, not `2^31-1`, because APVTS stores
parameter values as IEEE-754 single-precision floats. Every integer in
`[0, 2^24]` is exactly representable; values above `2^24` quantise on
host save/reopen. 16,777,216 unique seeds is more than sufficient for a
humanize seed selector, and constraining the range here makes the
round-trip in `test_Plugin.cpp` bit-exact rather than approximate.

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
look at 100% / 150% UI scaling stay manual checks against Logic
(AU) and Bitwig (CLAP / VST3).

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
- `Pointsman` plugin: VST3 + AU + CLAP bundles built and copied to
  user plug-in folders (`~/Library/Audio/Plug-Ins/{VST3,Components,CLAP}`);
  loads in Logic (AU), Bitwig (CLAP / VST3) as **primary** hosts
  and Reaper (VST3 / CLAP) as **best-effort**.
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
  here (vendored `clap-juce-extensions` submodule, source kept
  private-eligible) do not foreclose any of those distribution
  options. Musical reasoning for deferral: the architecture has no
  audible consequence; pricing and channel are commercial decisions
  that should not block engine work.
- **Ableton Live as a vst host.** Live's MIDI Effect rack does not
  accept third-party VST3 or AU plug-ins (host design, not a format
  limitation), so Live users go through the [m4l/](../../../m4l/)
  target instead. The same split is shipped on oedipa
  (`~/src/vst/oedipa/README.md` §"DAW support"); inheriting it is
  not a choice this ADR makes alone.
- **Cubase / Nuendo.** The VST3 spec has no "MIDI Effect" sub-category
  and Cubase rejects third-party VST3 in its MIDI Inserts slot
  (Steinberg policy). Loading Pointsman as an Instrument with
  two-track MIDI-out routing works mechanically but conflicts with
  the "MIDI fx, not synth" identity — the same rejection oedipa
  recorded for v1.
- **Standalone format.** Pointsman is MIDI-only — Standalone would
  require virtual-MIDI routing setup that is not part of the in-DAW
  musical surface. Deferred until a hardware-MIDI workflow asks for
  it.
- **Windows / Linux distribution.** macOS-only for v1 (matching
  oedipa's v1 scope). Cross-platform builds are deferred; the
  pure-C++17 engine boundary keeps the door open with no
  architectural cost.
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

- [x] [vst/CMakeLists.txt](../../../vst/CMakeLists.txt): rename
      project to `Pointsman`, `BUNDLE_ID` to `com.im9.pointsman`,
      `PLUGIN_CODE` to `Pntm`, `PRODUCT_NAME` to `Pointsman`,
      `FORMATS` to `VST3 AU` (drop Standalone), add
      `COPY_PLUGIN_AFTER_BUILD TRUE`.
- [x] [vst/Makefile](../../../vst/Makefile): drop the `open` target
      referencing `Stencil.app` (Standalone is dropped). The
      `stencil_tests` → `pointsman_tests` rename is deferred —
      Phase 0 has no test sources or Catch2 dependency to compile,
      so the test target is removed and rebuilt from scratch in
      Phase 1 alongside `tests/main.cpp` and FetchContent.
- [x] Delete `vst/Source/PluginProcessor.{cpp,h}` and
      `vst/Source/PluginEditor.{cpp,h}` (the cloned Stencil
      scaffold), and seed minimal Pointsman stubs at the new ADR
      paths [vst/Source/Plugin/PluginProcessor.{h,cpp}](../../../vst/Source/Plugin/)
      and [vst/Source/Editor/PluginEditor.{h,cpp}](../../../vst/Source/Editor/).
      The stubs are required for the manual gate ("the empty
      Pointsman bundle loads") — JUCE needs an `AudioProcessor` +
      `AudioProcessorEditor` pair to compile a plugin. Phase 2 / 3
      fill the stubs in place rather than replace them.
- [x] Delete `vst/tests/test_TuringMachine.cpp` — TM is not a
      Pointsman concept. The `tests/` directory is empty after
      removal and is recreated in Phase 1.
- [x] Refresh [README.md](../../../README.md) and
      [CLAUDE.md](../../../CLAUDE.md) `vst/` sections to reflect the
      new layout and rename. Delete any "TODO: Turing Machine"
      breadcrumbs.
- [x] Add [vst/clap-juce-extensions/](../../../vst/clap-juce-extensions/)
      submodule pinned at `e8de9e8571626633b8541a54c2406fccc4272767`
      (`v0.26.0-107-ge8de9e8`) — same SHA `oedipa` ships on. CMake
      adds `add_subdirectory(clap-juce-extensions EXCLUDE_FROM_ALL)`
      and a `clap_juce_extensions_plugin(TARGET Pointsman ...)`
      block deriving the `Pointsman_CLAP` target (CLAP_FEATURES
      `note-effect utility`, CLAP_ID `com.im9.pointsman`). Note:
      `clap-juce-extensions` itself nests `clap-libs/clap` and
      `clap-libs/clap-helpers` submodules — `git submodule update
      --init --recursive` is required for a fresh checkout.
- [x] **Build half**: `cd vst && make clean && make build`
      succeeds. `Pointsman.vst3`, `Pointsman.component`, and
      `Pointsman.clap` all build, are ad-hoc signed by JUCE's
      post-build hook (CLAP via `clap-juce-extensions`), and
      install to
      `~/Library/Audio/Plug-Ins/{VST3,Components,CLAP}/` via
      `COPY_PLUGIN_AFTER_BUILD TRUE`.
- [x] **Manual gate (host)**: the empty Pointsman bundle loads as
      a placeholder MIDI Effect in Logic (AU) and Bitwig (CLAP /
      VST3) without console errors. *(awaiting user verification —
      the gate `feedback_audit_overreach` was logged for; do not
      start Phase 1 until this is confirmed.)*

### Phase 1 — Engine + tests

- [x] Create [docs/ai/adr/003-pointsman-vst-architecture.md](003-pointsman-vst-architecture.md)
      — this file (already authored as part of starting Phase 0).
- [x] Add Catch2 v3 + nlohmann/json v3 via `FetchContent` in
      `CMakeLists.txt` (mirror the oedipa pattern; force
      `JSON_BuildTests OFF`).
- [x] Add `pointsman_engine` STATIC library target to
      `CMakeLists.txt`; assert at CMake time that no `juce_*` is in
      its `target_link_libraries` (deferred call on
      `pointsman_engine`'s `LINK_LIBRARIES` property — see CMakeLists
      `_pointsman_assert_engine_pure`).
- [x] Write `tests/main.cpp` with explicit `juce::initialiseJuce_GUI()`
      / `juce::shutdownJuce_GUI()` around the Catch2 session.
- [x] Write `tests/test_Rng.cpp` reading
      `docs/ai/rng-test-vectors.json` via nlohmann/json; expect
      bit-identical output with the m4l engine vectors.
- [x] Implement `Source/Engine/Rng.h` (xoshiro128++ + SplitMix64
      seeding); confirm `test_Rng` passes.
- [x] Write `tests/test_Quantizer.cpp` reading
      `docs/ai/quantizer-test-vectors.json`; expect parity for
      `buildScalePitches`, `snapToScale`, `snapToChordTones`,
      `diatonicShift`.
- [x] Implement `Source/Engine/Quantizer.{h,cpp}` and
      `Source/Engine/State.h`; confirm `test_Quantizer` passes.
- [x] Write `tests/test_Humanize.cpp` with seeded fixtures asserting
      EMA convergence behaviour, `1.0` freeze degeneracy, and
      transport-start reset.
- [x] Implement `Source/Engine/Humanize.{h,cpp}`; confirm
      `test_Humanize` passes.
- [x] Manual gate: `cd vst && make test` runs all engine tests
      green (562 assertions across 29 test cases on first
      end-to-end run). No host involvement needed at this phase.

### Phase 2 — Plugin (APVTS + processor)

- [x] Add `pointsman_plugin_core` STATIC library target to
      `CMakeLists.txt` (links juce_audio_*, juce_gui_*, NOT
      juce_audio_plugin_client). `Pointsman` re-compiles the same
      Plugin/Editor sources directly so `juce_audio_plugin_client`
      can resolve `createPluginFilter()`; `pointsman_tests` links
      `pointsman_plugin_core` for wrapper-free processor access.
- [x] Write `tests/test_Plugin.cpp`: APVTS round-trip
      (default-construct → mutate every pid → `getStateInformation`
      → fresh processor → `setStateInformation` → assert all values
      match), `harmonyVoices` ValueTree round-trip, panic on
      transport stop, controlChannel chord-context maintenance,
      `mode = chord` controlChannel notes consumed (do not appear
      on output), plus `triggerMode=root` consumes + sets root and a
      mode=scale tie-to-lower quantize sanity check.
- [x] Implement `Source/Plugin/Parameters.{h,cpp}` (pid namespace,
      Choice arrays, defaults namespace, `makeParameterLayout()`).
      `seed` range constrained to `[0, 2^24-1]` to keep round-trip
      bit-exact under APVTS's float32 storage (see §"Parameter
      persistence (APVTS)" above).
- [x] Implement `Source/Plugin/PluginProcessor.{h,cpp}`: APVTS
      construction, MIDI in / out, panic discipline (transport
      stop → flush all in-flight outputs + clear chord context;
      drift state preserved per concept.md), controlChannel
      chord-context maintenance, state I/O via standard
      get/setStateInformation with the `PointsmanState` child tree.
- [x] Confirm `test_Plugin` passes (622 assertions across 36 test
      cases — 8 plugin-layer cases on top of the engine vector
      iteration).
- [x] Manual gate: load the Pointsman AU in Logic and the CLAP /
      VST3 in Bitwig. All canonical parameters appear in the host
      parameter list, accept automation, and round-trip across a
      save / close / reopen of the host project. MIDI input on a
      track produces quantized output with `mode = scale`
      defaults; no hung notes after transport stop; bypass leaves
      no hung notes.

### Phase 3 — Editor (inboil-derived UI)

- [x] Write `tests/test_Editor.cpp`: instantiate
      `ScaleKeyboardView`, simulate `mouseDown` on a known key
      coordinate, assert APVTS `root` updated; instantiate
      `ControlsView`, click each mode pill, assert APVTS `mode`
      cycles; click `+` on harmony badges, assert
      `harmonyVoices` ValueTree grows. JUCE-headless caveat: a
      console-app `pointsman_tests` cannot pump JUCE's async queue
      reliably (no NSApp), so `juce::Button::triggerClick()` does
      not fire `onClick` — the test invokes the public `onClick`
      lambda directly via a `clickSync()` helper that mirrors
      `Button::sendClickMessage`'s gate (`isEnabled()` then
      `onClick()`).
- [x] Implement `Source/Editor/Theme.{h,cpp}` carrying the inboil
      palette (cream `--color-bg`, olive `--color-olive`, dark
      `--color-fg`).
- [x] Implement `Source/Editor/ScaleKeyboardView.{h,cpp}`:
      multi-octave keyboard, in-scale dots, chord-tier highlight,
      tap-sets-root. Logic-layer inspectors (`getPcAtForTest`,
      `getKeyCenterForTest`, `getInScalePcsForTest`) per
      §"UI logic / renderer split" above. Pulse-on-emit was
      cut from this phase — Pointsman's emitted-note state is
      computed inside `processBlock` (audio thread) and is not
      exposed across the engine→editor boundary; surfacing it
      cleanly belongs with future last-note diagnostic work and
      is not load-bearing for v1's quantizer surface.
- [x] Implement `Source/Editor/ControlsView.{h,cpp}`: Scale group
      (SCALE / ROOT), Mode group (3 pills + descriptive text),
      Harmony group (interval / direction badges, max 3),
      Humanize group (5 sliders), Routing group (input / control
      channel / trigger / seed).
- [x] Implement `Source/Editor/PluginEditor.{h,cpp}` composing the
      two views in the inboil 2-column layout; size the editor for
      the controls + a sensible keyboard width (header strip +
      keyboard left, 280px right rail).
- [x] Confirm `test_Editor` passes (638 assertions across 40 test
      cases — 4 editor-layer cases on top of the engine + plugin
      iteration).
- [x] Manual gate: in Logic (AU) and Bitwig (CLAP / VST3), the
      editor opens with the keyboard + right rail visible; tapping
      a key sets root and the keyboard updates; mode pills cycle
      and the description text changes; harmony badges add /
      remove voices and the output reflects them; humanize
      sliders perturb output. v1 ships light-only (cream / olive /
      dark on white) matching the m4l theme decision in
      [ADR 002](002-pointsman-release.md); no dark-host adaptation
      in this phase. *(awaiting user verification — the gate
      `feedback_audit_overreach` was logged for.)*

### Phase 4 — Humanize gate / timing / drift parity

Closes the Phase 0–3 cut originally documented in §"Engine boundary"
(now removed): the m4l ↔ vst audit caught that vst's GATE / TIM /
DRFT sliders advanced the RNG but did not change audible output,
silently violating the contract in concept.md §"Per-event humanize".

- [x] `tests/test_Plugin.cpp`: fixtures asserting output noteOff
      sample-position = noteOn + sourceStep (default humanize),
      input noteOff is silently consumed (gate-driven only, m4l
      semantics), and `humanizeTiming = 1` shifts noteOn within
      `[0, 0.5 × sourceStep)` (negative offset clamps to input
      sample, parity with m4l/host/bridge.ts:313).
- [x] `Source/Plugin/PluginProcessor`: track absolute sample
      counter (`blockStartAbs_`) across blocks and `lastInputSampleAbs_`
      per input event; convert sample-distance to ms via
      `getSampleRate()` to feed `ComposeArgs::sourceStepDuration`.
      First-event fallback `kFirstEventStepMs = 250` mirrors
      m4l/host/host.ts FIRST_EVENT_STEP_MS.
- [x] `Source/Plugin/PluginProcessor`: replace input-noteOff →
      output-noteOff pairing with a humanize-gate scheduler.
      `pending_` queue carries paired (noteOn, noteOff) entries
      keyed by absolute sample target; `drainPendingInto` per block
      sorts and emits entries falling in
      `[blockStartAbs_, blockStartAbs_ + numSamples)`. Input
      noteOffs are silently consumed (parity with m4l host.ts:222-230)
      so the gate is purely humanize-driven. `sounding_` tracks
      currently-emitted-but-not-yet-released output notes for panic
      flush on transport stop.
- [x] `Source/Plugin/PluginProcessor`: re-seed RNG and reset
      drift on transport-start edge so each play loop reproduces
      bit-for-bit (concept.md §"Transport"; mirrors m4l host.ts:237).
- [ ] Manual gate: in Logic / Bitwig, set `humanizeGate = 0.5`
      and confirm output gate length varies per event; same for
      `humanizeTiming` (output sample position varies); same for
      `humanizeDrift` (slow EMA smoothing across consecutive events
      on all three axes). No hung notes after transport stop or
      bypass with non-zero humanize.

## Post-Phase 4 audit follow-ups

A bug / RT-safety / threading audit on 2026-05-10 produced two
classes of follow-ups: **mechanical** items (RT-safety refactors,
UB guards, numerical-stability tweaks) handled in subsequent
commits without re-opening the spec; and **spec-decision** items
listed below, where the right fix depends on a product call about
acceptable bounds, behaviour, or trade-offs that this ADR has not
made yet. These are tracked here (rather than in a private TODO
file) so they surface in any future ADR pass that touches the same
surface.

Mechanical items already merged or queued:

- [x] **#1 buffer overflow on preset load** — `syncHarmonyVoicesFromTree`
      now clamps to `kHarmonyVoicesMax` (matches the
      `setHarmonyVoices()` setter). Commit `fea334e`.
- [x] **#12 `rotl32(x, 0)` UB guard** — never invoked with `k=0`
      today, but the `x >> (32 - k)` form is UB at `k=0`. Mask the
      shift count.
- [x] **#5 `snapToChordTones` per-call vector alloc** — replace the
      `std::vector<int>` build with a fixed `std::array<int, 128>`
      + count.
- [x] **#4 `buildScalePitches` per-block alloc** — cache the result
      keyed on `(scale, root)`; rebuild only when either changes.
- [x] **#7 `juce::MidiBuffer out;` per block** — make `out` a
      processor member, `clear()` and reuse.
- [x] **#9 pulse-decay numerical stability** — store a stable
      `baseIntensity` per pulse; compute current intensity as
      `base × (1 − ageMs / kPulseDecayMs)` on demand, not by
      reciprocal-multiply each tick.
- [ ] **#2 / #3 UI ↔ audio data race on `harmonyVoices` and
      `chordContext.pitchClasses`** — adopt a `juce::SpinLock`
      with try-lock on the audio side and a UI-side snapshot copy.
      Conservative-mechanical: this pins the behaviour without
      committing to a lock-free design.

Spec-decision items (TBD):

- [ ] **#6 `pending_` / `sounding_` reserve cap.** Current `reserve(64)`
      saturates at ~8 input noteOns when harmony=3 (`(1+3) × 2`
      events per noteOn). The right answer depends on the worst-case
      polyphony × harmony × in-flight gate length the v1 surface
      promises to handle without an audio-thread `push_back`
      reallocation. Options: (A) leave as-is and accept rare
      reallocs; (B) bump to a generous fixed reserve (e.g. 512); (C)
      fixed-capacity ring buffer with documented overflow policy.
- [ ] **#8 `setValueNotifyingHost` from `processBlock`.** `triggerMode
      = Root` writes the `root` parameter from the audio thread on
      every matching noteOn. JUCE tolerates this, but rapid-fire
      root changes can spam host listeners. Options: (A) keep — the
      use case is one root pulse per phrase, not per 16th; (B) route
      through an `AsyncUpdater` with a single-slot pending PC.
- [ ] **#10 `rebuildHarmonyBadges` double-fire.** `onAddHarmonyClicked`
      calls `rebuildHarmonyBadges()` directly *and* the
      `setHarmonyVoices()` → `syncHarmonyVoicesToTree` path triggers
      the editor's `valueTreeChildAdded` listener which posts
      another `rebuildHarmonyBadges` via `callAsync`. Two rebuilds
      per click. Visual effect today is benign but the sync rebuild
      destroys and recreates badge subcomponents — a user mid-edit
      on an interval combo gets the combo torn down. Options: (A)
      drop the direct call (async-only); (B) suppress the listener
      from internal setter paths.
- [ ] **#11 pulse-poll loss on burst noteOns.** The `lastEmittedPulse`
      atomic is a single-slot edge: if multiple noteOns are emitted
      within one editor poll (~16 ms), only the most recent is
      visualised. This is documented as an intentional simplification
      ("lossy single-shot signal") and is fine for the visual-glow
      role, but a 16th-note burst @ 240 BPM = 16 ms/event so it sits
      right at the boundary. Options: (A) accept lossiness; (B)
      replace with an SPSC FIFO of recent pulses (bounded depth, no
      audio-side alloc).
- [ ] **#13 preset XML field validation.** `syncHarmonyVoicesFromTree`
      reads `interval` without validating against the canonical set
      `{3, 4, 5, 6}`, and `direction` falls back to `above` on any
      unrecognised string. A hand-edited or forward-incompatible
      preset can therefore inject out-of-range intervals (which
      `diatonicShift` will treat as scale-step counts and clamp at
      extremes — defined behaviour, but not the spec). Options: (A)
      silent clamp at the boundary; (B) drop the offending voice;
      (C) refuse the preset and log. Decision interacts with how
      forward-compatibility for future interval values is framed.
- [ ] **#14 `gateLenSamples` overflow guard.** Theoretical overflow
      at `static_cast<uint64_t>(hr.gateFinal * sourceStepSamples)`
      if the input rate degenerates (e.g. two noteOns minutes apart
      makes `sourceStepSamples` enormous, then `gateFinal=1.0`
      schedules a noteOff that far in the future). Practically not
      reachable in normal use; the question is whether v1 wants a
      hard cap on gate length in seconds for predictability when
      something upstream goes wrong. Options: (A) no cap; (B) clamp
      `sourceStepDuration` to a max (e.g. 5 s) at the bridge
      boundary; (C) clamp the final scheduled offset to a max.

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
