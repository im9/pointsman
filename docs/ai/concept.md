# Concept

Pointsman is a DAW-native **scale quantizer** for MIDI: it snaps incoming
notes to a user-selected scale, with optional chord-mode (single-note-
becomes-chord expansion via a configurable diatonic voice stack), and
a per-event humanize layer (velocity / gate / timing / drift). MIDI
effect, single-purpose UI, ships as a standalone product on `m4l/` and
`vst/` targets.

This document describes the **musical model** — the parts that are shared
across Pointsman's targets (`m4l/`, `vst/`). Per-target UI, parameter
surface specifics, and interaction design live in each target's own ADRs.

## What Pointsman does

On each incoming MIDI `noteOn`, Pointsman:

1. Computes the active scale pitches as MIDI numbers across the octave range,
   built from `(scale, root)`.
2. Snaps the input note to the **nearest** scale pitch (binary search; ties
   round down).
3. Optionally perturbs the output's velocity, gate length, and timing per the
   humanize layer (signed uniform noise on each axis, opt-in, default 0).
4. Emits the snapped note with the scaled velocity, gate, and timing offset.

Snap is **always nearest** — no skip mode, no repeat mode. Nearest is the
most musically useful default and the only one inboil shipped with success.

### Scales (v1)

Fifteen presets, derived from inboil's fourteen with two adjustments
(rename `minor-pent` → `minor-pentatonic` for naming consistency, and
add `chromatic-half`):

`major`, `minor`, `dorian`, `phrygian`, `lydian`, `mixolydian`, `locrian`,
`pentatonic`, `minor-pentatonic`, `blues`, `harmonic`, `melodic`, `whole`,
`chromatic`, `chromatic-half` (last is a no-op identity for "passthrough
within the device chain").

### Scale and chord modes

Pointsman ships two quantize modes — `scale` (snap to nearest scale
degree, 1-in-1-out) and `chord` (single-note-becomes-chord
expansion, 1-in-`1+N`-out via a configurable diatonic voice stack).
The mode is a single 2-way exclusive selection; default is `scale`.

`chord` mode emits the scale-snapped input plus `N` diatonic voices
configured by `harmonyVoices` (length 0..3). Each voice is a
`(interval, direction)` pair: interval ∈ {3, 4, 5, 6} (diatonic
3rd / 4th / 5th / 6th along the active scale), direction ∈
{above, below}. A voice that clamps to the scale extreme (top of
MIDI range) is still emitted at that pitch — harmony slots are
positional, not de-duplicated.

`harmonyVoices` defaults to `[{3, above}, {5, above}]` on new plugin
instances, so `chord` mode out of the box emits a diatonic 1-3-5
triad rooted on the input pitch (e.g. C → {C, E, G} in C major,
D → {D, F, A} in C major). Users edit voices in the editor's
HARMONY group; clearing all voices collapses `chord` to 1-in-1-out
(identical to `scale` mode).

Out-of-scale input is snapped to the nearest scale degree first, so
e.g. C# in C major → C, then the chord is built rooted on C.

## Composition — upstream → Pointsman → Synth

The intended primary use is a chain placing Pointsman between any MIDI
source and the synth:

```
[MIDI source] -> [Pointsman] -> [Synth]
```

Sources that pair naturally:

- **Music Thing-style Turing Machine** (e.g. inboil's TM, or its
  standalone DAW-native sibling [Stencil](https://github.com/im9/stencil))
  — chromatic random pitch stream; Pointsman snaps the result to scale,
  producing the canonical "Music Thing TM + Quantizer" sound.
- **Tonnetz walks / arpeggiators** — Pointsman locks free pitch motion
  to a key.
- **Played input / MPE controllers** — Pointsman acts as a real-time
  scale lock for the player.
- **Single-note melodies** — Pointsman in `chord` mode expands each
  attack into the configured diatonic voice stack, turning a
  monophonic source into automatic chord voicings.

Pointsman is also useful on its own as a real-time scale lock for any
upstream MIDI source. The host's MIDI routing handles the chain — no
internal IPC or shared state with other devices. Communication is via
MIDI notes, period.

## Per-event humanize

Pointsman applies an optional **per-event humanize** layer to its output.
Two parameters, defaults both `0` (off):

- `feel` (`0..1`) — global humanize amount. A single 0..1 value drives
  signed uniform noise on three independently-drawn axes (velocity,
  gate length, note start offset). One control instead of three lets
  the user dial "how much human" without having to balance three
  sliders. Timing offset is bounded to ±0.5 × source step length.
- `drift` (`0..1`) — EMA smoothing across the three humanize axes; `0`
  = independent draws (jittery), values close to `1` produce slow
  drift (breath). Note: `1.0` exactly is degenerate — the EMA never
  blends a new draw, so the layer freezes at its current value
  (effectively no humanize). Use `0.95–0.99` for "very slow drift".

The three internal axes (velocity / gate / timing) each receive their
own RNG draw scaled by `feel`; `drift` smooths each axis
independently. They are not collapsed to a single shared draw — that
would phase-lock the three axes, which sounds artificial.

Humanize lives in Pointsman because Pointsman is the natural place for
"shape the note as it leaves the chain" — whether the upstream is a
TM-style generator, Tonnetz, played input, or anything else. Perturbing
upstream notes before quantization would muddy any deterministic
loop / lock semantics in the source; doing it after the snap leaves
upstream timing intact.

The draws are seeded (`seed` parameter, persisted in plugin state but
not exposed in the editor) so a fixed `(seed, input sequence, params)`
reproduces the same output bit-for-bit. New plugin instances pick a
random seed on construction so two parallel Pointsman instances on
double-tracked parts do not produce phase-coherent identical humanize;
saving a preset captures the current seed, so reloading reproduces the
saved performance. Drift smoothing maintains its EMA state per-axis,
reset on transport **start** (so each play loop re-seeds from the same
initial state). Transport stop does not touch drift state — it only
flushes any in-flight notes.

## MIDI semantics

Pointsman is a MIDI effect: it consumes transport (clock + position) and
emits MIDI notes. Sample-accurate timing against the host clock is
expected on all targets.

### Input handling

Pointsman is fundamentally input-driven (it transforms incoming notes).
Input arrives on the `inputChannel` (omni or 1..16) — the only channel
filter Pointsman exposes. Notes on other channels are dropped, not
passed through: the filter is a real filter, so the active mode's
output (single note in `scale`, chord in `chord`) is what reaches
downstream, never a stray untransformed note. Set `inputChannel = 0`
(OMNI) to act on all channels. There is no separate control channel:
`chord` mode's voice stack is configured by `harmonyVoices`, not
driven by held input notes (§Scale and chord modes).

The `root` parameter is set from the editor (keyboard tap), the host
parameter automation lane, or preset recall — not from incoming MIDI.
Earlier drafts of Pointsman exposed a "trigger mode" that let an
incoming `noteOn` rewrite `root`; this was removed because the editor
keyboard already covers live key changes and the dual-purpose
controlChannel that drove it created the "chord mode silently
consumes all input" failure mode that the 2026-05-16 surface redesign
addresses.

### Note-off discipline

On any state change that could leave a hung note (transport stop, bypass,
preset change, parameter change that affects active output, panic), all
currently-sounding notes must receive `noteOff`. Panic (all-notes-off on
all channels) is required behavior, not optional.

### Polyphony / overlap

Pointsman preserves the input's polyphony: if multiple notes arrive in
the same processing block, all are quantized and emitted.

### Transport

Humanize state (the EMA accumulator) is reset on transport stop.
Resuming from an arbitrary position does not require Pointsman-side
recomputation — the device is input-driven, and the upstream source
is responsible for deterministic position handling. Pointsman's only
seeded contract is over humanize draws: a fixed `(seed, input
sequence, params)` reproduces the same output bit-for-bit.

## What Pointsman is not

Clarifying scope by exclusion:

- **Not a sequencer.** Pointsman emits a note only when it receives
  one. It has no internal clock-driven note generation.
- **Not a synth.** No oscillators, no audio. MIDI only.
- **Not a scene graph.** inboil embeds Quantizer as a node in a
  broader generative system. Pointsman flattens this: one MIDI effect,
  one job (quantize / chord-expansion).
- **Not an unseeded random walker.** Humanize draws are reproducible
  for fixed `(seed, input sequence, params)`.

## Future extensions

Listed so the surface stays small and these don't get quietly
designed-around. Pointsman's quantize modes (`scale` / `chord`) are
shipped — those are no longer "future".

- **MPE output** — keep the note-emission abstraction loose enough that
  per-note pitch bend / pressure / timbre can be added without a rewrite.
- **More scales** — microtonal, custom user scales (CSV / Scala import).
- **Preset / slot system** — Oedipa-style 4-slot preset bank with
  MIDI-triggered recall; useful once the device is in real use.
- **Pitch-class scale editing** — `scale` is currently an enum of
  preset names; supporting a free pitch-class set (per-key toggle on
  the keyboard) would generalize beyond the preset list.

## Parameter surface (canonical)

Targets must expose this minimum set. Additional parameters (MIDI routing
specifics, GUI-only state) may be added per target.

| Parameter         | Type                                                 | Notes                                              |
|-------------------|------------------------------------------------------|----------------------------------------------------|
| `scale`           | enum (15 names)                                      | scale preset; default `major`                      |
| `root`            | int `0..11`                                          | root pitch class; default `0` (C)                  |
| `mode`            | `scale \| chord`                                     | output strategy; default `scale`                   |
| `harmonyVoices`   | `HarmonyVoice[]` (length 0..3)                       | diatonic voice stack emitted in `chord` mode (default `[{3 above}, {5 above}]` = 1-3-5 triad) |
| `feel`            | float `0..1`                                         | humanize amount across velocity / gate / timing; default `0` |
| `drift`           | float `0..1`                                         | EMA smoothing for humanize axes; default `0`       |
| `inputChannel`    | int `0..16`                                          | MIDI input channel; `0` = omni; default `0`        |
| `seed`            | int `0..2^24-1`                                      | RNG seed for humanize draws. **Persisted in plugin state but not exposed in the editor.** New instances pick a random seed on construction; preset save / load is bit-exact. Range bounded by IEEE-754 single-precision exact-representation: APVTS-style hosts store params as float32, and every integer in `[0, 2^24]` is exactly representable, so seeds round-trip bit-identical. m4l mirrors the same range for cross-target preset compatibility. |

Parameters that earlier Pointsman drafts exposed and **v2 removes** —
listed here so the surface change is auditable rather than a quiet
deletion:

- `humanizeVelocity` / `humanizeGate` / `humanizeTiming` — collapsed
  into `feel` (three independent draws scaled by one amount).
- `outputLevel` — dropped. Output velocity is what the upstream sends
  (optionally perturbed by `feel`); per-instance MIDI gain belongs to
  the host's velocity scaling or the synth's velocity sensitivity,
  not to a quantizer.
- `triggerMode` — dropped. Key-change from a controller is covered by
  the editor keyboard tap or host parameter automation on `root`.
- `controlChannel` — dropped. Chord-mode output is now
  configuration-driven (`harmonyVoices`) rather than derived from a
  separate channel's held notes (§Scale and chord modes).
- `harmony` mode (third mode value) — merged into `chord`. The
  former harmony mode's voice-stack semantics are now `chord` mode's
  semantics, with `harmonyVoices` pre-populated by default to a
  1-3-5 triad so the surface ships "single note becomes a chord".

## Origin notes

Pointsman has two ancestors:

- **inboil's `generative.ts`** (see the `reference_inboil` memory and
  CLAUDE.md) provided the algorithm — scale presets, snap-to-nearest,
  chord-tone bias, and diatonic voice stacking. inboil's scene
  graph does not carry over: Pointsman is a flat MIDI effect, not a
  generative graph node.
- **The TM + Quantizer Eurorack idiom** (Music Thing TM into Mutable
  Instruments Yarns or similar) is the long-standing pairing Pointsman
  is designed to slot into. Pointsman is the DAW-native expression of
  that idiom's quantizer half, with its humanize layer as the
  "shake-the-grid" element that hardware quantizers historically lack.
