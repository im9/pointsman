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

Fifteen presets matching inboil:

`major`, `minor`, `dorian`, `phrygian`, `lydian`, `mixolydian`, `locrian`,
`pentatonic`, `minor-pentatonic`, `blues`, `harmonic`, `melodic`, `whole`,
`chromatic`, `chromatic-half` (last is a no-op identity for "passthrough
within the device chain").

### Chord and harmony modes

Pointsman ships three quantize modes — `scale` (snap to nearest scale
degree), `chord` (snap to chord-tone with scale fallback), `harmony`
(input plus diatonic voice stack). The chord context source is real-time
MIDI on a control channel (held notes form the current chord) rather
than an offline `chords[]` array; this collapses inboil's two
chord-context paths (manual progression, Tonnetz coupling) into one
input contract that any chord generator (clip, played, Oedipa) can
drive.

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
Five parameters, defaults all `0` (off):

- `humanizeVelocity` (`0..1`) — signed uniform noise on output velocity
- `humanizeGate` (`0..1`) — signed uniform noise on gate length
- `humanizeTiming` (`0..1`) — signed uniform noise on note start offset
  (fraction of source step length, ±0.5 max)
- `humanizeDrift` (`0..1`) — EMA smoothing across all humanize axes; `0` =
  independent draws (jittery), values close to `1` produce slow drift
  (breath). Note: `1.0` exactly is degenerate — the EMA never blends a
  new draw, so the layer freezes at its current value (effectively no
  humanize). Use `0.95–0.99` for "very slow drift".
- `outputLevel` (`0..1`, default `1.0`) — global multiplier on output velocity

Humanize lives in Pointsman because Pointsman is the natural place for
"shape the note as it leaves the chain" — whether the upstream is a
TM-style generator, Tonnetz, played input, or anything else. Perturbing
upstream notes before quantization would muddy any deterministic
loop / lock semantics in the source; doing it after the snap leaves
upstream timing intact.

The draws are seeded (shared seed parameter) so a fixed `(seed, input
sequence, params)` reproduces the same output bit-for-bit. Drift
smoothing maintains its EMA state per-axis, reset on transport
**start** (so each play loop re-seeds from the same initial state).
Transport stop does not touch drift state — it only flushes any
in-flight notes and clears chord context.

## MIDI semantics

Pointsman is a MIDI effect: it consumes transport (clock + position) and
emits MIDI notes. Sample-accurate timing against the host clock is
expected on all targets.

### Input handling

Pointsman is fundamentally input-driven (it transforms incoming notes).
Its `triggerMode` only chooses what role MIDI input plays beyond
passthrough:

- `passthrough` (default) — input notes are quantized and emitted;
  nothing else
- `root` — incoming `noteOn` (within a designated control channel/range,
  see each target's ADRs) sets the Pointsman `root` parameter live,
  allowing key changes from a controller. Quantized passthrough still
  happens for non-control notes.

When `mode = chord`, the control channel switches role: held notes form
the current chord context (see §Chord and harmony modes), and the
single-note `root` setter is suppressed for that channel.

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
| `humanizeVelocity`| float `0..1`                                         | signed-noise amplitude on velocity                 |
| `humanizeGate`    | float `0..1`                                         | signed-noise amplitude on gate                     |
| `humanizeTiming`  | float `0..1`                                         | signed-noise amplitude on timing                   |
| `humanizeDrift`   | float `0..1`                                         | EMA smoothing for all humanize axes; default `0`   |
| `outputLevel`     | float `0..1`                                         | global output velocity multiplier; default `1.0`   |
| `triggerMode`     | `passthrough \| root`                                | input handling; default `passthrough`              |
| `inputChannel`    | int `0..16`                                          | MIDI input channel; `0` = omni; default `0`        |
| `controlChannel`  | int `1..16`                                          | control channel for root / chord context           |
| `seed`            | int                                                  | RNG seed for humanize draws                        |

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
