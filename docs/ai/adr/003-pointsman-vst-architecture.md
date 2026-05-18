# ADR 003: Pointsman vst — architecture

## Status: Proposed

**Created**: 2026-05-10
**Phases 0–5 shipped**: 2026-05-17 — pure-C++17 engine + APVTS plugin core + inboil-derived editor across AU / VST3 / CLAP, v2 parameter surface from Phase 5 chord/harmony merge, signing + notarization pipeline producing `dist/Pointsman.dmg` verified end-to-end.

**Revised**: 2026-05-18 — added §Release procedure at the foot of this ADR (pkg port from oedipa + `release-vst` Makefile target + Polar distribution channel + first `vst-v0.1.0` ship). Phases 0–5 architecture work remains shipped; status flipped Implemented → Proposed and the file moved out of `archive/` to track the new checklist. Flips back to Implemented and re-archives when §Release procedure is `[x]` end-to-end.

**Revised**: 2026-05-16 — parameter surface redesign (Phase 5). The
2026-05-10 ↔ 2026-05-15 phases (0–4) shipped a working vst against
the original 12-parameter surface inherited from inboil. Live test in
Logic / Bitwig revealed two failures: (1) `mode = chord` produced no
audible output on a default single-channel DAW track because
`controlChannel = 1` collided with `inputChannel = 1` and all input
was consumed as chord context; (2) the right-rail control surface was
opaque even to the author. Phase 5 collapses the parameter surface
(see §"Parameter persistence (APVTS)" below for the new shape) and
re-purposes `chord` mode as **single-note-becomes-chord expansion**:
each input attack emits the scale-snapped input plus N diatonic
voices configured by `harmonyVoices` (default `[{3 above}, {5 above}]`
= 1-3-5 triad). The pre-merge 3-mode (scale / chord / harmony)
surface collapses to 2 modes (scale / chord) — the former harmony
mode's voice-stack semantics are absorbed into chord with a
pre-populated default. Phases 0–4 history is preserved as-is for the
audit trail; the §"Editor (inboil-derived)" and §"Parameter
persistence (APVTS)" sections below have been rewritten in place to
describe the v2 surface that Phase 5 implements. m4l receives the
same redesign on a parallel branch — both targets bump to v2.0.0
with no on-disk preset migration from v1 (m4l v1.0.0 was a canary
release with effectively zero installed base; vst v1 has not been
released).

> **Mid-Phase 5 course correction (2026-05-17).** Phase 5's initial
> direction was "chord context derived from held notes on
> `inputChannel`" — a 1-in-1-out snap-to-derived-chord-tone semantic.
> Manual gate caught that this was indistinguishable from scale mode
> in any realistic use; the actual intent was "single note becomes a
> chord (1-in-N-out)". The held-input chord-context infrastructure
> (`synthesizeTriadFromRoot`, `deriveChordContextMask`,
> `kChordContextRetentionMs`, per-pc reference counts + decay timer,
> related JSON sections) was added, then removed in a cleanup pass
> when the merge-with-harmony approach replaced it. Paragraphs below
> that still describe the chord-context-from-input direction are
> superseded by this note and by Phase 5's §"Mid-phase course
> correction" callout further down.

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
format. Phase 5 changes the surface shape; on-disk state moves to
`kStateVersion = 2` with no migration from v1 (vst v1 was never
released; m4l v1.0.0 was canary-only).

| pid | APVTS type | Choices / range / default |
|---|---|---|
| `scale` | Choice | 15 names, default `major` (idx 0) |
| `root` | Int | `0..11`, default `0` |
| `mode` | Choice | `scale` / `chord` / `harmony`, default `scale` |
| `feel` | Float | `0..1`, default `0` |
| `drift` | Float | `0..1`, default `0` |
| `inputChannel` | Int | `0..16` (0 = omni), default `0` |
| `seed` | Int | `0..2^24-1`, default = random per instance |

The `seed` upper bound is `2^24-1`, not `2^31-1`, because APVTS stores
parameter values as IEEE-754 single-precision floats. Every integer in
`[0, 2^24]` is exactly representable; values above `2^24` quantise on
host save/reopen. 16,777,216 unique seeds is more than sufficient for a
humanize seed selector, and constraining the range here makes the
round-trip in `test_Plugin.cpp` bit-exact rather than approximate.

`seed` is the one parameter whose default value is not a literal —
`PluginProcessor` picks a random integer in `[0, 2^24-1]` on
construction so two parallel Pointsman instances default to
independent humanize streams (concept.md §"Per-event humanize"
rationale). The randomly chosen value is written into APVTS the same
way any other parameter is, so preset save / load remains bit-exact;
the only divergence from "default = 0" is on a fresh `new` of the
processor when no state is being restored. The editor does **not**
expose `seed`; it remains accessible through the host parameter
automation lane.

`harmonyVoices` is variable-length (0..3 entries) and serializes into
a child `ValueTree` of `apvts.state` under tag `PointsmanState` with
attributes `version="2"`, and per-entry `interval` (3 / 4 / 5 / 6) +
`direction` (`above` / `below`). `getStateInformation` /
`setStateInformation` are implemented on the processor; the round-trip
is validated by `test_Plugin.cpp`. Loading a state tree with
`version != "2"` resets to defaults (no migration).

**Phase 5 removed parameters** (deleted from APVTS, not just hidden in
the UI):

- `humanizeVelocity`, `humanizeGate`, `humanizeTiming` → replaced by
  `feel`, which feeds three independent draws inside the engine.
- `humanizeDrift` → renamed to `drift` (no longer prefixed; pid
  changes are part of the v1 → v2 break).
- `outputLevel` → removed; downstream gain / velocity scaling is the
  DAW's job, not a quantizer's.
- `triggerMode` → removed; editor keyboard tap and host parameter
  automation cover live `root` changes.
- `controlChannel` → removed; chord context derives from
  `inputChannel` (engine maintains the held-pcs set internally,
  §"Chord context (engine)" below).

### Chord context (engine)

`pointsman_engine` exposes a `ChordContext` value carrying the current
pitch-class mask consulted by `snapToChordTones`. The processor —
not the engine — owns the held-pcs set and decay clock; the engine
is pure functions over `(input pc, ChordContext, scale, root)`.

The processor maintains:

- `heldInputPcs : std::array<uint64_t, 12>` — per-pc reference count
  of active `noteOn`s on `inputChannel` (omni or matching channel).
  `noteOn` increments, `noteOff` schedules a decay timer entry.
- `decayingPcs : ring buffer` — pcs whose count dropped to zero
  within the retention window (`kChordContextRetentionMs = 150.0`).
  Each entry carries an absolute sample deadline; on every
  `processBlock` and on every input event, entries past their
  deadline are dropped.
- `chordContextMask : std::atomic<uint16_t>` — 12-bit mask of
  `(heldInputPcs[pc] > 0) || (pc has a live decay entry)`,
  republished atomically for UI poll (keyboard chord-tier highlight).

On each input `noteOn` (only `mode = chord` and `mode = harmony`
consult the context; `mode = scale` ignores it):

1. Compute the chord context **at the moment of attack** from the
   current `heldInputPcs` + `decayingPcs` snapshot.
2. If the snapshot is empty (size 0), context = ∅.
3. If size 1, synthesize the diatonic triad on `(scale, root)`
   starting at that pc (concept.md §"Chord and harmony modes").
4. If size ≥ 2, context = (literal held / decaying pcs) ∪ (diatonic
   triad of the lowest held pc).
5. Pass `(input pc, context, scale, root)` to `snapToChordTones`
   for `mode = chord`, or to `snapToScale` for `mode = harmony`
   (harmony voices are scale-step computed off the snapped output,
   not chord-tone snapped — see concept.md §"Chord and harmony
   modes" last paragraph).
6. After the snap result is published, increment the input pc's
   held count (the new note joins the context for *subsequent*
   attacks).

The retention window value (150 ms) is an engine-level constant in
`Source/Engine/State.h`. It is short enough that the user clearing
the room (~250 ms silence) returns to "no context" behaviour, and
long enough that ordinary phrasing (one note at a time, ~120 BPM
quarters = 500 ms) does **not** clear it. A test in
`test_Plugin.cpp` exercises the boundary: `noteOff → wait 100 ms →
noteOn` retains; `noteOff → wait 250 ms → noteOn` clears.

### Editor (inboil-derived)

The UI is a 2-column layout that mirrors the inboil
`QuantizerSheet.svelte` — keyboard on the left, right-rail controls
— with inboil-only scene-graph affordances (Target / Track / Preset
/ Merge) **removed** because Pointsman vst is a MIDI Effect, not a
generative scene node. Phase 5 shrinks the right-rail from 11
controls + harmony badges down to 6 controls + harmony badges:

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
│                                        │  FEEL  [─●─────]  │
│                                        │  DRIFT [●──────]  │
│                                        │                   │
│                                        │ Routing           │
│                                        │  IN  ch [omni ▾]  │
└────────────────────────────────────────┴───────────────────┘
```

Per-pane behavior carried over from `QuantizerSheet.svelte`:

- **Keyboard**: white + black keys across three octaves
  (`KBD_OCT_LO=3`..`KBD_OCT_HI=5`), with an in-scale dot under each
  scale degree, an olive chord-tier highlight on `mode = chord` /
  `mode = harmony` for pitch classes in the current chord context
  (published from the processor's `chordContextMask` atomic), and a
  brief pulse on the most recently emitted output note. Tap on a key
  sets `root` to the tapped pitch class (the inboil `tapKey`
  semantics).
- **Mode pills**: three-button segmented control; the active pill is
  olive-bordered, others are dimmed. A one-line description below
  ("snap to nearest scale degree" / "snap to chord tones from held
  input" / "add parallel diatonic voices") changes with the active
  mode. The chord / harmony descriptions are updated to reflect the
  Phase 5 chord-context-from-input semantics.
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
- **Manual `chords[]` editor** — concept.md derives chord context
  from held notes on `inputChannel`; no chord-add UI is needed.

inboil sections **added** for the vst port (not present in
QuantizerSheet because inboil's humanize and routing live elsewhere
in the scene graph):

- **Humanize** — two sliders (`feel` / `drift`) per concept.md
  §"Per-event humanize". The Phase 5 collapse from five sliders
  (`humanizeVelocity` / `humanizeGate` / `humanizeTiming` /
  `humanizeDrift` / `outputLevel`) reflects the surface redesign
  recorded in the §Status block.
- **Routing** — `inputChannel` only. `controlChannel`, `triggerMode`,
  and `seed` are no longer right-rail controls — the first two were
  removed from APVTS, `seed` is APVTS-only with random-per-instance
  default (§"Parameter persistence (APVTS)").

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
version is `kStateVersion = 2` after the Phase 5 redesign. There is
no migration from `kStateVersion = 1` shapes; vst v1 was never
released and m4l v1.0.0 is canary-only, so a hard break is
acceptable. A v1 state tree (recognised by missing `feel` /
present `humanizeVelocity` pids, or `PointsmanState.version="1"`)
is discarded silently and defaults are restored — the processor
logs a one-line "discarding pre-v2 state" notice via `juce::Logger`
for support visibility but does not surface this to the host.

## Scope

### In scope

- Scaffold removal under [vst/](../../../vst/): rename CMake project
  / bundle / plugin code / product, drop Standalone format, drop
  TM-only test, replace four-file `Source/` flat layout with the
  three-subdir split.
- `pointsman_engine`: pure C++17 port of `Quantizer`, `Rng`, and
  `Humanize` validated against the shared JSON vectors. Phase 5
  adds engine-side triad synthesis for single-pc chord-context
  expansion.
- `pointsman_plugin_core`: APVTS layout (v2 shape from Phase 5),
  processor with MIDI in / out + transport panic + state I/O +
  chord-context maintenance from `inputChannel`-held notes with a
  ~150 ms retention window.
- `Pointsman` plugin: VST3 + AU + CLAP bundles built and copied to
  user plug-in folders (`~/Library/Audio/Plug-Ins/{VST3,Components,CLAP}`);
  loads in Logic (AU), Bitwig (CLAP / VST3) as **primary** hosts
  and Reaper (VST3 / CLAP) as **best-effort**.
- Editor: inboil-derived keyboard + right rail with mode pills,
  harmony badges, `feel` / `drift` humanize sliders, single
  `inputChannel` routing control; logic-layer tests via JUCE
  event API.
- Test infrastructure: Catch2 v3 + nlohmann/json v3 via
  `FetchContent`; custom `tests/main.cpp` owning JUCE init / shutdown.
- Manual-host verification gate at the end of each phase (see
  Implementation checklist below) — bundling all phases into one
  end-of-batch check is the failure mode `feedback_audit_overreach`
  was logged from.
- Phase 5 surface redesign — `kStateVersion = 2` hard break with no
  migration from v1; m4l receives the parallel redesign on its own
  branch (engine semantics shared via JSON test vectors, host /
  UI plumbing per-target).

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
- [ ] ~~Manual gate: in Logic / Bitwig, set `humanizeGate = 0.5`
      and confirm output gate length varies per event…~~
      **Superseded by Phase 5 manual gate.** The
      `humanizeVelocity` / `humanizeGate` / `humanizeTiming` /
      `humanizeDrift` / `outputLevel` sliders are removed in Phase
      5; the audibility check is rolled into Phase 5's `feel` /
      `drift` gate, which exercises the same Phase 4 wiring through
      the v2 surface.

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
- [x] **#2 / #3 UI ↔ audio data race on `harmonyVoices` and
      `chordContext.pitchClasses`** — `harmonyVoices` is UI-writer /
      audio-reader: `juce::SpinLock` on the writer, audio-thread
      try-lock with version-counter refresh into a fixed-size cache
      (last-known-good on contention). `chordContext` was
      audio-writer / UI-reader: replaced the vector with
      `std::atomic<uint16_t>` (12-bit pitch-class mask) and added a
      mask overload to `snapToChordTones` — fully lock-free, no
      try-lock retry needed. The chord-context inspector now
      returns by value (sorted ascending), which is a behavioural
      change the existing tests align with.

Spec-decision items (TBD):

- [x] **#6 `pending_` / `sounding_` reserve cap.** Current `reserve(64)`
      saturates at ~8 input noteOns when harmony=3 (`(1+3) × 2`
      events per noteOn). The right answer depends on the worst-case
      polyphony × harmony × in-flight gate length the v1 surface
      promises to handle without an audio-thread `push_back`
      reallocation. Options: (A) leave as-is and accept rare
      reallocs; (B) bump to a generous fixed reserve (e.g. 512); (C)
      fixed-capacity ring buffer with documented overflow policy.
      Resolved with option (B): `pending_.reserve(512)` /
      `sounding_.reserve(128)` in prepareToPlay. Headroom for ~64
      in-flight noteOns at the 3-voice harmony max without an
      audio-thread realloc.
- [x] **#8 `setValueNotifyingHost` from `processBlock`.** `triggerMode
      = Root` writes the `root` parameter from the audio thread on
      every matching noteOn. JUCE tolerates this, but rapid-fire
      root changes can spam host listeners. Options: (A) keep — the
      use case is one root pulse per phrase, not per 16th; (B) route
      through an `AsyncUpdater` with a single-slot pending PC.
      Resolved with option (A): no code change. The musical use case
      is sparse root pulses; deferring through an AsyncUpdater would
      add latency between the root-trigger noteOn and the resulting
      scale shift, which is the worse failure mode.
- [x] **#10 `rebuildHarmonyBadges` double-fire.** Resolved with option (A):
      direct `rebuildHarmonyBadges()` calls dropped from
      `onAddHarmonyClicked` / `onRemoveHarmonyClicked`; rebuild now
      flows only through the `valueTreeChildAdded/Removed` →
      `callAsync` path. Halves the badge teardowns per add/remove.
      Headless test now relies on the in-handler cap guard rather
      than the (deferred) disabled-button gate. Original detail:
      `onAddHarmonyClicked`
      calls `rebuildHarmonyBadges()` directly *and* the
      `setHarmonyVoices()` → `syncHarmonyVoicesToTree` path triggers
      the editor's `valueTreeChildAdded` listener which posts
      another `rebuildHarmonyBadges` via `callAsync`. Two rebuilds
      per click. Visual effect today is benign but the sync rebuild
      destroys and recreates badge subcomponents — a user mid-edit
      on an interval combo gets the combo torn down. Options: (A)
      drop the direct call (async-only); (B) suppress the listener
      from internal setter paths.
- [x] **#11 pulse-poll loss on burst noteOns.** The `lastEmittedPulse`
      atomic is a single-slot edge: if multiple noteOns are emitted
      within one editor poll (~16 ms), only the most recent is
      visualised. This is documented as an intentional simplification
      ("lossy single-shot signal") and is fine for the visual-glow
      role, but a 16th-note burst @ 240 BPM = 16 ms/event so it sits
      right at the boundary. Options: (A) accept lossiness; (B)
      replace with an SPSC FIFO of recent pulses (bounded depth, no
      audio-side alloc).
      Resolved with option (A): no code change. The pulse signal is
      a visual glow, not functional MIDI; under burst the most-recent
      "representative" pulse is more readable than overlapping every
      emit. SPSC FIFO is implementation cost without UX win at v1
      surface.
- [x] **#13 preset XML field validation.** `syncHarmonyVoicesFromTree`
      reads `interval` without validating against the canonical set
      `{3, 4, 5, 6}`, and `direction` falls back to `above` on any
      unrecognised string. A hand-edited or forward-incompatible
      preset can therefore inject out-of-range intervals (which
      `diatonicShift` will treat as scale-step counts and clamp at
      extremes — defined behaviour, but not the spec). Options: (A)
      silent clamp at the boundary; (B) drop the offending voice;
      (C) refuse the preset and log. Decision interacts with how
      forward-compatibility for future interval values is framed.
      Resolved with option (A): silent clamp to [3, 6] in
      `syncHarmonyVoicesFromTree` via `juce::jlimit`. Refusing the
      preset would break any v1↔future migration; drop-voice would
      silently change the voicing count.
- [x] **#14 `gateLenSamples` overflow guard.** Theoretical overflow
      at `static_cast<uint64_t>(hr.gateFinal * sourceStepSamples)`
      if the input rate degenerates (e.g. two noteOns minutes apart
      makes `sourceStepSamples` enormous, then `gateFinal=1.0`
      schedules a noteOff that far in the future). Practically not
      reachable in normal use; the question is whether v1 wants a
      hard cap on gate length in seconds for predictability when
      something upstream goes wrong. Options: (A) no cap; (B) clamp
      `sourceStepDuration` to a max (e.g. 5 s) at the bridge
      boundary; (C) clamp the final scheduled offset to a max.
      Resolved with option (B): `kMaxSourceStepMs = 5000.0` clamps
      the derived sourceStepSamples in `processBlock` before it
      flows into humanize. 5 s = half-note at 24 BPM, well outside
      any normal play context.

### Phase 5 — Parameter surface redesign (chord-from-input, feel/drift collapse)

Closes the surface-redesign direction recorded in the §Status
revision block (2026-05-16). Two problem statements:

1. **`mode = chord` produces no audible output** on a default
   single-channel DAW track because `controlChannel = 1` collides
   with `inputChannel = 1` and all input is consumed as chord
   context.
2. **The right-rail surface is opaque** — 5 humanize sliders +
   TRIG + CTL CH + IN CH + SEED + harmony badges + MODE pills is
   too many controls without clear grouping, even for the author.

Phase 5 lands a single coordinated change: chord context moves to
held notes on `inputChannel`, the humanize axes collapse to `feel`
+ `drift`, and the removed parameters (`humanizeVelocity` /
`humanizeGate` / `humanizeTiming` / `outputLevel` / `triggerMode` /
`controlChannel`) disappear from APVTS. m4l receives the same
redesign on a parallel branch (engine semantics are shared, host
plumbing differs).

> **Mid-phase course correction (2026-05-17).** The original Phase 5
> direction implemented `chord` mode as 1-in-1-out (snap to a derived
> held-input chord context). Manual gate caught that this was
> indistinguishable from `scale` mode in any realistic use, contradicting
> the actual intent: **single note becomes a chord (1-in-N-out)**.
> Phase 5 was re-scoped mid-implementation to merge `chord` and `harmony`
> into a single `chord` mode that emits the scale-snapped input plus N
> diatonic voices configured by `harmonyVoices` (default `[{3 above},
> {5 above}]`). The originally-added `synthesizeTriadFromRoot` /
> `deriveChordContextMask` engine helpers, `kChordContextRetentionMs`
> retention timer, per-pc reference counts, and the corresponding
> JSON test vector sections were all removed in the same cleanup pass.
> The merged 2-mode surface (`scale` / `chord`) is what shipped.

- [x] **Engine** — Phase 5 shipped scope: `kHarmonyVoicesMax`,
      `diatonicShift`, and `snapToScale` carry chord-mode output.
      Shared vectors at
      [docs/ai/quantizer-test-vectors.json](../../../docs/ai/quantizer-test-vectors.json)
      stayed at their pre-Phase-5 sections (build / snap / chord-tones /
      harmony); the held-input derivation sections added mid-phase were
      removed when the merge replaced the held-context approach.
- [x] **Plugin** — Rewrote
      [vst/Source/Plugin/Parameters.{h,cpp}](../../../vst/Source/Plugin/)
      to the v2 surface (remove `humanizeVelocity` / `humanizeGate` /
      `humanizeTiming` / `humanizeDrift` / `outputLevel` /
      `triggerMode` / `controlChannel`; add `feel` and `drift` as
      top-level pids; bump `kStateVersion = 2`; reduce `ModeChoice` to
      `{Scale, Chord}`). In
      [vst/Source/Plugin/PluginProcessor.{h,cpp}](../../../vst/Source/Plugin/):
      random-seed `seed` in `[0, 2^24-1]` at construction (so the
      random becomes the saved default); initialise `harmonyVoices`
      with the default 1-3-5 triad; route `feel` to the three
      Humanize axes (one independent draw each, amplitude scaled by
      `feel`); chord-mode output = scale-snapped input + N
      diatonicShift voices; discard any v1 state on load (removed
      pid present or `version != "2"`) with a log line, defaulting
      on discard. `test_Plugin.cpp` covers chord-mode triad output
      (single + multi-attack), default-voices invariant, scale-mode
      counter-test, v1 state discard, random-seed divergence across
      16 fresh constructs.
- [x] **Editor** —
      [vst/Source/Editor/ControlsView.{h,cpp}](../../../vst/Source/Editor/):
      humanize group collapses 5 sliders to 2 (`FEEL`, `DRIFT`);
      routing group keeps only `IN ch` (drop `CTL ch` / `TRIG` /
      `SEED`); mode pills reduced to 2 (`SCALE`, `CHORD`); pill
      description text updated ("expand to a diatonic chord (1 in,
      N out)").
      `ScaleKeyboardView.{h,cpp}`: chord-tier highlight removed (no
      held-context concept post-merge); pulse-on-emit glow path
      unchanged.
      `test_Editor.cpp`: drop removed-control tests; add `feel` /
      `drift` slider → APVTS coverage; pill-count and description-
      text assertions match the 2-mode surface.
- [x] **Build gate** — `cd vst && make clean && make build`
      produces `Pointsman.vst3` / `Pointsman.component` /
      `Pointsman.clap` (`feedback_build_is_part_of_task`: a green
      test suite without a fresh build is not enough).
- [x] **Manual gate (host)** — Logic (AU) and Bitwig (CLAP / VST3)
      on a default single-channel MIDI track:
      - `mode = chord` + single-note melody → each input note
        emits as a diatonic 1-3-5 triad (the "single note becomes a
        chord" intent).
      - Edit the HARMONY badges (add / remove / change interval) →
        chord-mode output reflects the new voice stack.
      - Clear all HARMONY voices → `chord` mode degenerates to
        1-in-1-out (identical to `scale`).
      - `feel = 0.5` / `drift = 0.95` → velocity / gate / timing
        vary across consecutive notes with a slow drift envelope.
      - Save / reopen the project → `scale` / `root` / `mode` /
        `feel` / `drift` / `harmonyVoices` / `seed` round-trip
        bit-identical (verify by inspecting humanize draws).
      - Two parallel instances fed the same MIDI with `feel = 0.7`
        are NOT phase-coherent (random-seed-per-instance check).
      - Transport stop flushes in-flight notes and clears chord
        context; bypass leaves no hung notes.

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

After Phase 5, m4l receives a parallel redesign so that the cross-
target parameter surface stays aligned. m4l's host layer
(`m4l/host/host.ts`, `m4l/host/bridge.ts`) and UI (`m4l/host/ui/`,
`m4l/scaleKeyboard.jsui.js`, `m4l/Pointsman.maxpat`) carry the
equivalent changes; the engine layer (`m4l/engine/quantizer.ts`)
shares the chord-context-derivation update with vst via the
updated JSON test vectors. m4l v2.0.0 is also a hard break with no
v1 preset migration (v1.0.0 canary release, effectively zero
installed base).

## Release procedure

Added 2026-05-18. Mirrors oedipa's ADR 009 (dmg) / ADR 010 (CLAP
joins dmg); oedipa later added a pkg installer paired with the
dmg, which this section ports across.

The dmg path is already shipping:
[`vst/scripts/codesign.sh`](../../../vst/scripts/codesign.sh),
[`notarize.sh`](../../../vst/scripts/notarize.sh),
[`build-dmg.sh`](../../../vst/scripts/build-dmg.sh) +
[`entitlements.plist`](../../../vst/scripts/entitlements.plist)
produce a signed + notarized + stapled
[`dist/Pointsman.dmg`](../../../dist/Pointsman.dmg) (verified
end-to-end 2026-05-17 against the shared `im9-notary` keychain
profile and `DEVELOPER_TEAM_ID=8TUXRN8XUZ`). The new work is a
paired `.pkg` installer mechanically ported from
`~/src/vst/oedipa/vst/scripts/` — per-format opt-out at install
time (VST3 / AU / CLAP each toggleable), system-wide install
only (mirrors oedipa's domain choice — `~/Library` placement
stays the dmg's job), en + ja localized welcome / license /
conclusion. `productsign` uses the matching `Developer ID
Installer` cert under the same team ID.

**Distribution channel**: tag `vst-vX.Y.Z` on `im9/pointsman`
carries **no GH binary asset**. Pointsman vst is paid via Polar
per the im9 distribution strategy (2026-05-17);
`dist/Pointsman.dmg` and `dist/Pointsman.pkg` are uploaded to
Polar manually. (m4l stays free with `m4l-vX.Y.Z` tags + `.amxd`
attached as the GH Release asset, unchanged from ADR 002.)

- [x] Port `vst/scripts/build-pkg.sh` from
      `~/src/vst/oedipa/vst/scripts/build-pkg.sh` with mechanical
      substitutions (`Oedipa` → `Pointsman`,
      `fm.im9.oedipa.{vst3,au,clap}` →
      `fm.im9.pointsman.{vst3,au,clap}`,
      `Oedipa_artefacts` → `Pointsman_artefacts`).
- [x] Port `vst/scripts/distribution.xml` and
      `vst/scripts/pkg-resources/{en,ja}.lproj/{welcome,license,conclusion}.txt`
      with the same substitutions. `license.txt` reflects the
      vst-side proprietary terms
      ([`vst/LICENSE`](../../../vst/LICENSE) per c6311f0), not
      the m4l MIT license.
- [x] Add `release-vst` to root
      [`Makefile`](../../../Makefile) chaining
      `cd vst && make build` → `codesign.sh` → `notarize.sh` →
      `build-dmg.sh` → `build-pkg.sh`. Make `release` depend on
      `release-m4l release-vst`. Remove the stale
      `release-vst is deferred (see ADR 002 §Out of scope)`
      comment.
- [x] Update [`.claude/skills/release/SKILL.md`](../../../.claude/skills/release/SKILL.md)
      so `/release vst` produces the dmg + pkg pair (Step 2.5
      invokes `make release-vst`; pre-flight Check 4, Step 4
      verify, and Step 4.5 Polar reminder all mention both
      artifacts). Mirrors oedipa / stencil's vst artifact-pair
      operation; the tag-only-no-GH-asset pattern stays per the im9
      distribution strategy.
- [ ] Verification: `make release-vst` on a clean tree produces
      both `dist/Pointsman.dmg` and `dist/Pointsman.pkg`, both
      `xcrun stapler validate`-clean; pkg installs on the author
      machine with at least one format opt-out exercised on the
      choices screen; bundles load in Logic Pro (AU MIDI FX)
      and Bitwig Studio (CLAP + VST3) without Gatekeeper
      friction.
- [ ] `gh release create vst-v0.1.0` on `im9/pointsman` with no
      binary asset attached; upload `dist/Pointsman.dmg` and
      `dist/Pointsman.pkg` to Polar manually; flip the vst rows
      in [`README.md`](../../../README.md) §Targets to "Released
      (vst-v0.1.0)" and add the Polar product link.
