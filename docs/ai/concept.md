# Concept

Stencil is a probabilistic MIDI sequence generator and scale quantizer. It
ports two generators from [inboil](https://github.com/im9/inboil) — a Music
Thing-style **Turing Machine** (looping shift register that mutates under
user-controlled stability) and a **Quantizer** (scale-locked snap on note
input) — into DAW-native form.

This document describes the **musical model** — the parts that are shared
across all targets (`m4l/`, `vst/`). Target-specific UI and interaction
design live in separate ADRs.

## Topology — two devices, not one

In m4l, Stencil ships as **two separate devices**:

- **Stencil TM** — emits MIDI notes from a probabilistic shift register
- **Stencil QT** — snaps incoming MIDI notes to a chosen scale, with optional
  humanize layer

The user chains them on a track (`Stencil TM → Stencil QT`) when they want
scale-locked random melodies. Each device is also useful on its own:

- **Stencil TM alone** — feed an unquantized random pitch stream into a synth
  that has its own scale handling, or print the chromatic register output to
  a clip and edit there.
- **Stencil QT alone** — constrain any upstream MIDI source (Tonnetz walks,
  arpeggiators, played input, MPE controllers) to a scale.

This split mirrors inboil's mental model (TM and Quantizer were independent
generative nodes connected by edges) and keeps each device's UI focused. The
VST target may revisit this — combining into one plugin is a reasonable
choice when device-chaining friction is higher (see ADR 002).

## What Stencil TM does

On each step of the host transport, Stencil TM:

1. Reads the current **shift register** as an integer of `length` bits.
2. Maps the register's value to a normalized fraction `0..1` and then to a
   MIDI note within the user-set range `[lo, hi]`.
3. With probability `density`, emits the note as a `noteOn`. On fail, the
   step is silent but timing advances normally — the listener hears a hole
   in the rhythm, not a beat shift.
4. Shifts the register one position: the bit that falls off becomes the
   write-bit candidate; with probability `(1 - lock)` it is flipped before
   being inserted at the head.

`lock = 1.0` freezes the register into a perfect loop of length `length`.
`lock = 0.0` flips every bit — the register is pure noise, no loop emerges.
Intermediate values gradually mutate the loop: `lock = 0.95` is the classic
"slowly evolving pattern" sweet spot.

The musical intent is **a loop the user cannot fully author** — it emerges
from initial randomness + lock and is steered, not written. This is why TM
has no per-step program (cf. Oedipa's cells): the program *is* the register
and the user shapes it by holding `lock` high during a section they like.

## What Stencil QT does

On each incoming MIDI `noteOn`, Stencil QT:

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

### Chord and harmony modes — v2 territory

inboil's QT had `chord` mode (snap to a per-step chord context) and
`harmony` mode (output diatonic interval stacks). Both are out of scope for
v1: `chord` mode requires an external chord source (in inboil, a Tonnetz
node); `harmony` mode adds polyphony semantics. Revisit when the v1 surface
is shipping cleanly.

## Composition — TM → QT chain

The intended primary use:

```
[Stencil TM] -> [Stencil QT] -> [Synth]
```

TM emits chromatic notes from `[lo, hi]`; QT snaps them to scale. The
chain produces the canonical "Music Thing TM + Quantizer" sound.

Both devices are MIDI effects. Live's MIDI routing handles the chain — no
internal IPC or shared state between devices. They communicate via MIDI
notes, period.

## Per-event humanize (QT only)

QT applies an optional **per-event humanize** layer to its output. Five
parameters, defaults all `0` (off):

- `humanizeVelocity` (`0..1`) — signed uniform noise on output velocity
- `humanizeGate` (`0..1`) — signed uniform noise on gate length
- `humanizeTiming` (`0..1`) — signed uniform noise on note start offset
  (fraction of source step length, ±0.5 max)
- `humanizeDrift` (`0..1`) — EMA smoothing across all humanize axes; `0` =
  independent draws (jittery), `1` = slow drift (breath)
- `outputLevel` (`0..1`, default `1.0`) — global multiplier on output velocity

Humanize lives in QT (not TM) because:

- TM's "register-driven note" is already a complete musical unit; perturbing
  it before quantization muddies the lock semantic
- QT is the natural place for "shape the note as it leaves the chain" —
  whether the upstream is TM, Tonnetz, played input, or anything else

The draws are seeded (shared seed parameter) so a fixed `(seed, input
sequence, params)` reproduces the same output bit-for-bit. Drift smoothing
maintains its EMA state per-axis, reset on transport stop.

## MIDI semantics

Stencil is a MIDI effect family: each device consumes transport (clock +
position) and emits MIDI notes. Sample-accurate timing against the host
clock is expected on all targets.

### Stencil TM — input handling

`triggerMode` parameter controls how MIDI input affects the TM:

- `auto` (default) — TM advances on host transport; input is ignored
- `gate` — TM only advances while a key is held; release stops the clock
  (held register, no shift)
- `seed` — incoming `noteOn` writes a `1` bit at the head of the register
  (the player "writes the program"). `noteOff` writes `0`. The user becomes
  the bit source; `lock` no longer governs the head bit while the seed mode
  is active.

`inputChannel` selects which channel TM listens to (default `0` = omni).

### Stencil QT — input handling

QT is fundamentally input-driven (it transforms incoming notes). Its
`triggerMode` only chooses what role MIDI input plays beyond passthrough:

- `passthrough` (default) — input notes are quantized and emitted; nothing
  else
- `root` — incoming `noteOn` (within a designated control channel/range, see
  ADR 002) sets the QT `root` parameter live, allowing key changes from a
  controller. Quantized passthrough still happens for non-control notes.

### Note-off discipline

On any state change that could leave a hung note (transport stop, bypass,
preset change, parameter change that affects active output, panic), all
currently-sounding notes must receive `noteOff`. Panic (all-notes-off on
all channels) is required behavior, not optional.

### Polyphony / overlap

TM is monophonic in v1 — one note per step. QT preserves the input's
polyphony: if multiple notes arrive in the same processing block, all are
quantized and emitted.

### Transport

State is reset on transport stop. Resuming from an arbitrary position
recomputes the TM register evolution deterministically from `(seed, length,
lock, position)` so the output is identical regardless of where playback
begins. Seeded determinism is a core contract.

## What Stencil is not

Clarifying scope by exclusion:

- **Not a step sequencer.** TM has no editable per-step pattern. The user
  shapes the loop via `lock`, `length`, and `seed`, not by drawing notes.
- **Not a chord generator.** TM emits monophonic notes. QT does not stack
  intervals (no `harmony` mode in v1).
- **Not a generative synth.** No oscillators, no audio. MIDI only.
- **Not a scene graph.** inboil embeds TM and QT as nodes in a broader
  generative system. Stencil flattens this: each device does one thing.
- **Not an unseeded random walker.** The bit evolution is reproducible for
  fixed `(seed, length, lock, position)`.

## Future extensions

Deferred from v1 — listed so the v1 surface stays small and these don't get
quietly designed-around.

### TM — alternate output modes (`gate` / `velocity`)

inboil's TM has three output modes; Stencil v1 ships only `note`:

- **`gate`** — register fraction drives **gate length** instead of pitch;
  the emitted note's pitch is fixed (midpoint of `range` or a separate
  `gateNote` parameter), and `density` still controls active-step
  probability. Use case: rhythmic articulation programs where the loop
  modulates how *long* each step rings rather than *what* it plays.
- **`velocity`** — register fraction drives **output velocity** in a
  user-musical range (inboil uses `0.3..1.0`; for Stencil this should
  probably map to `[velocityMin, velocityMax]` user parameters); pitch is
  fixed. Use case: the register becomes a dynamic accent pattern.

When (re-)introduced, the parameter would be `tmOutputMode: 'note' |
'gate' | 'velocity'` with `note` remaining default. The fixed-pitch modes
need a `gateNote` / `pitchCenter` parameter to specify the constant pitch.

Likely sequencing: ship v1 with `note` only, watch how users play with
`density` and `lock`, then revisit. If users are reaching for an external
LFO or step sequencer to sculpt velocity dynamics, that's the signal that
`velocity` mode earns its weight.

### QT — chord and harmony modes

`chord` mode (snap to a per-step chord context, e.g., from a Tonnetz upstream)
and `harmony` mode (output diatonic interval stacks) — both inherited from
inboil. See "Chord and harmony modes — v2 territory" above.

### Other future surface

- **MPE output** — keep the note-emission abstraction loose enough that
  per-note pitch bend / pressure / timbre can be added without a rewrite.
- **More scales** — microtonal, custom user scales (CSV / Scala import).
- **Preset / slot system** — oedipa-style 4-slot preset bank with MIDI-
  triggered recall; useful once the v1 surface is in real use.
- **TM length sync to bar count** — currently `length` is in bits and the
  loop length in time depends on `subdivision` × `length`. Consider a
  "bars per loop" parameterization that internally derives `length`.

## Parameter surface (canonical)

Targets must expose this minimum set. Additional parameters (MIDI routing
specifics, GUI-only state) may be added per target.

### Stencil TM

| Parameter         | Type                          | Notes                                              |
|-------------------|-------------------------------|----------------------------------------------------|
| `length`          | int `2..32`                   | shift register length in bits                      |
| `lock`            | float `0..1`                  | `1` = frozen loop, `0` = pure noise                |
| `range`           | `[int 0..127, int 0..127]`    | output MIDI note range, `lo ≤ hi`                  |
| `density`         | float `0..1`                  | active-step probability (default `1.0`)            |
| `subdivision`     | `8th \| 16th \| 32nd \| 8T \| 16T` | step unit; default `16th`                     |
| `seed`            | int                           | RNG seed for reproducibility                       |
| `triggerMode`     | `auto \| gate \| seed`        | input handling; default `auto`                     |
| `inputChannel`    | int `0..16`                   | MIDI input channel; `0` = omni; default `0`        |
| `outputVelocity`  | int `1..127`                  | output note velocity; default `100`                |
| `outputGate`      | float `0..1`                  | gate length as fraction of step; default `0.5`     |

### Stencil QT

| Parameter         | Type                                                 | Notes                                              |
|-------------------|------------------------------------------------------|----------------------------------------------------|
| `scale`           | enum (15 names)                                       | scale preset; default `major`                      |
| `root`            | int `0..11`                                          | root pitch class; default `0` (C)                  |
| `mode`            | `scale` (v1)                                         | snap strategy; v1 has only `scale`                 |
| `humanizeVelocity`| float `0..1`                                          | signed-noise amplitude on velocity                 |
| `humanizeGate`    | float `0..1`                                          | signed-noise amplitude on gate                     |
| `humanizeTiming`  | float `0..1`                                          | signed-noise amplitude on timing                   |
| `humanizeDrift`   | float `0..1`                                          | EMA smoothing for all humanize axes; default `0`   |
| `outputLevel`     | float `0..1`                                          | global output velocity multiplier; default `1.0`   |
| `triggerMode`     | `passthrough \| root`                                | input handling; default `passthrough`              |
| `inputChannel`    | int `0..16`                                          | MIDI input channel; `0` = omni; default `0`        |
| `seed`            | int                                                  | RNG seed for humanize draws                        |

## Origin notes

Stencil has two ancestors:

- **inboil's `generative.ts`** (see [`reference_inboil`](../../) memory and
  CLAUDE.md) provided both algorithms — the shift register math, lock
  semantics, scale presets, snap-to-nearest. inboil's scene graph,
  multi-mode TM output (gate/velocity), and chord/harmony QT modes do not
  carry over to v1.
- **Music Thing Modular's [Turing Machine](https://musicthing.co.uk/Turing-Machine/)**
  (Tom Whitwell, 2014) is the source of the algorithm itself: an 8-bit
  shift register with a probability-controlled write-bit. Stencil generalizes
  the length to `2..32` and parameterizes lock continuously, but the
  musical intent (steered loop, not authored sequence) is identical.

The TM + Quantizer pairing is a long-standing Eurorack idiom (Music Thing TM
into Mutable Instruments Yarns or similar). Stencil is the DAW-native
expression of that idiom, with humanize at the QT layer as the
"shake-the-grid" element.
