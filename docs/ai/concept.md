# Concept

Pointsman is a DAW-native **scale quantizer** for MIDI: it snaps incoming
notes to a user-selected scale, with optional chord-mode and harmony-mode
(diatonic voice stack), and a per-event humanize layer (velocity / gate /
timing / drift). MIDI effect, single-purpose UI, ships as a standalone
product on `m4l/` and `vst/` targets.

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

### Chord and harmony modes

Pointsman ships three quantize modes — `scale` (snap to nearest scale
degree), `chord` (snap to chord-tone with scale fallback), `harmony`
(input plus diatonic voice stack). The mode is a single 3-way exclusive
selection; output is always 1 emitted note per input attack in `scale`
and `chord` modes, and `1 + harmonyVoices.length` notes in `harmony`
mode.

**Chord context derivation.** In `chord` and `harmony` modes the chord
context is derived from notes currently held on the input channel — no
separate control channel, no offline `chords[]` array. The engine
maintains a set of currently-sounding input pitch classes:

- **0 held** → context is empty → `chord` mode falls through to scale
  snap; `harmony` mode emits the diatonic voice stack against the
  scale (harmony is scale-relative, not chord-relative).
- **1 held** → that pc is interpreted as a root, and the chord context
  is synthesized as a diatonic triad starting at that pc in the
  current `(scale, root)`. The held note itself emits as pass-through
  (it is a member of its own triad). Subsequent attacks while the
  first note is still held snap against this triad.
- **2+ held** → context is the literal set of held pcs, unioned with
  the diatonic triad of the lowest held pc (so the context always
  carries a "tonal centre" anchor even when the user is playing wide
  voicings).

**Ordering per attack.** Each incoming `noteOn` is snapped against the
chord context *as it stands at the moment of attack*, then added to
the context. So the first note of a held cluster always snaps to scale
(empty context); subsequent notes within the cluster snap to the
context built by the earlier notes. This makes `chord` mode
distinguishable from `scale` mode in legato / held-cluster playing
while preserving "single note in → single note out".

**Context retention.** A short retention window (~150 ms) keeps a
released pc in the context after its `noteOff` so that non-legato
playing — releasing one note before pressing the next — still
benefits from `chord` mode. The retention time is an engine constant,
not a user parameter; it is short enough that intentional silence
clears the context, long enough that ordinary phrasing maintains it.

`harmony` mode is scale-relative: the diatonic voice stack is computed
purely from `(scale, root)` and the per-voice interval, independent
of held pcs. Held-input chord context is still tracked for `harmony`
mode so a future "harmony follows chord" extension is possible, but
v1 harmony voices are not chord-tone-snapped.

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
- **Chord clips** — feed harmonic content; Pointsman in `chord` /
  `harmony` mode generates voice-leading against the held chord.

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
flushes any in-flight notes and clears chord context.

## MIDI semantics

Pointsman is a MIDI effect: it consumes transport (clock + position) and
emits MIDI notes. Sample-accurate timing against the host clock is
expected on all targets.

### Input handling

Pointsman is fundamentally input-driven (it transforms incoming notes).
Input arrives on the `inputChannel` (omni or 1..16) — the only channel
filter Pointsman exposes. Notes on other channels pass through
untouched. There is no separate control channel: chord context in
`chord` / `harmony` modes is derived from notes held on the
`inputChannel` itself (§Chord and harmony modes).

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
  one job (quantize / harmony).
- **Not an unseeded random walker.** Humanize draws are reproducible
  for fixed `(seed, input sequence, params)`.

## Future extensions

Listed so the surface stays small and these don't get quietly
designed-around. Pointsman's quantize modes (`scale` / `chord` /
`harmony`) are shipped — those are no longer "future".

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
| `mode`            | `scale \| chord \| harmony`                          | snap strategy; default `scale`                     |
| `harmonyVoices`   | `HarmonyVoice[]` (length 0..3)                       | diatonic voice stack used in `harmony` mode        |
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
- `controlChannel` — dropped. Chord context derives from
  `inputChannel` itself (§Chord and harmony modes).

## Origin notes

Pointsman has two ancestors:

- **inboil's `generative.ts`** (see the `reference_inboil` memory and
  CLAUDE.md) provided the algorithm — scale presets, snap-to-nearest,
  chord-tone snap, and diatonic harmony voice stacking. inboil's scene
  graph does not carry over: Pointsman is a flat MIDI effect, not a
  generative graph node.
- **The TM + Quantizer Eurorack idiom** (Music Thing TM into Mutable
  Instruments Yarns or similar) is the long-standing pairing Pointsman
  is designed to slot into. Pointsman is the DAW-native expression of
  that idiom's quantizer half, with its humanize layer as the
  "shake-the-grid" element that hardware quantizers historically lack.
