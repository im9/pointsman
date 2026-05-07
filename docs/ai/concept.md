# Concept

Stencil and Pointsman together port two generators from
[inboil](https://github.com/im9/inboil) into DAW-native form: a Music
Thing-style **Turing Machine** (looping shift register that mutates under
user-controlled stability) and a **Quantizer** (scale-locked snap on note
input). Per [ADR 005](adr/005-product-split.md), each generator ships as
its own product from its own repository — **Stencil** is the TM product
(this repo); **Pointsman** is the QT product
([~/src/vst/pointsman/](../../../pointsman/)).

This document describes the **musical model** — the parts that are shared
across the two products and across each product's targets (`m4l/`,
`vst/`). Per-product UI, parameter surface, and interaction design live
in each product's own ADRs.

## Topology — two products, chained at the DAW

Stencil and Pointsman are independent products that ship as single-purpose
MIDI effects:

- **Stencil** — emits MIDI notes from a probabilistic shift register
- **Pointsman** — snaps incoming MIDI notes to a chosen scale, with
  optional humanize layer and chord/harmony modes

The user chains them on a track (`Stencil → Pointsman`) when they want
scale-locked random melodies. Each product is also useful on its own:

- **Stencil alone** — feed an unquantized random pitch stream into a synth
  that has its own scale handling (or into a sampler where one fixed pitch
  per pad makes the shift register a probabilistic trigger pattern), or
  print the chromatic register output to a clip and edit there.
- **Pointsman alone** — constrain any upstream MIDI source (Tonnetz walks,
  arpeggiators, played input, MPE controllers, chord clips) to a scale.

This split mirrors inboil's mental model — TM and Quantizer were
independent generative nodes connected by edges — and gives each product
a single-purpose UI. ADR 005 §Architectural motivation records why VST
follows the same per-product split rather than collapsing into one plugin
(brand consistency with m4l, standalone discoverability, single-purpose
UI focus).

## What Stencil does

On each step of the host transport, Stencil:

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
from initial randomness + lock and is steered, not written. This is why
Stencil has no per-step program (cf. Oedipa's cells): the program *is* the
register and the user shapes it by holding `lock` high during a section
they like.

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
input contract that any chord generator (clip, played, oedipa) can
drive.

## Composition — Stencil → Pointsman chain

The intended primary use:

```
[Stencil] -> [Pointsman] -> [Synth]
```

Stencil emits chromatic notes from `[lo, hi]`; Pointsman snaps them to
scale. The chain produces the canonical "Music Thing TM + Quantizer"
sound.

Both products are MIDI effects. The host's MIDI routing handles the
chain — no internal IPC or shared state between products. They
communicate via MIDI notes, period.

## Per-event humanize (Pointsman only)

Pointsman applies an optional **per-event humanize** layer to its output.
Five parameters, defaults all `0` (off):

- `humanizeVelocity` (`0..1`) — signed uniform noise on output velocity
- `humanizeGate` (`0..1`) — signed uniform noise on gate length
- `humanizeTiming` (`0..1`) — signed uniform noise on note start offset
  (fraction of source step length, ±0.5 max)
- `humanizeDrift` (`0..1`) — EMA smoothing across all humanize axes; `0` =
  independent draws (jittery), `1` = slow drift (breath)
- `outputLevel` (`0..1`, default `1.0`) — global multiplier on output velocity

Humanize lives in Pointsman (not Stencil) because:

- Stencil's "register-driven note" is already a complete musical unit;
  perturbing it before quantization muddies the lock semantic
- Pointsman is the natural place for "shape the note as it leaves the
  chain" — whether the upstream is Stencil, Tonnetz, played input, or
  anything else

The draws are seeded (shared seed parameter) so a fixed `(seed, input
sequence, params)` reproduces the same output bit-for-bit. Drift smoothing
maintains its EMA state per-axis, reset on transport stop.

## MIDI semantics

Stencil and Pointsman are both MIDI effects: each consumes transport
(clock + position) and emits MIDI notes. Sample-accurate timing against
the host clock is expected on all targets.

### Stencil — input handling

`triggerMode` parameter controls how MIDI input affects Stencil:

- `auto` (default) — Stencil advances on host transport; input is ignored
- `gate` — Stencil only advances while a key is held; release stops the
  clock (held register, no shift)
- `seed` — incoming `noteOn` writes a `1` bit at the head of the register
  (the player "writes the program"). `noteOff` writes `0`. The user
  becomes the bit source; `lock` no longer governs the head bit while
  the seed mode is active.

`inputChannel` selects which channel Stencil listens to (default `0` =
omni).

### Pointsman — input handling

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

Stencil is monophonic — one note per step. Pointsman preserves the
input's polyphony: if multiple notes arrive in the same processing
block, all are quantized and emitted.

### Transport

State is reset on transport stop. Resuming from an arbitrary position
recomputes the Stencil register evolution deterministically from
`(seed, length, lock, position)` so the output is identical regardless
of where playback begins. Seeded determinism is a core contract.

## What these products are not

Clarifying scope by exclusion:

- **Not a step sequencer.** Stencil has no editable per-step pattern.
  The user shapes the loop via `lock`, `length`, and `seed`, not by
  drawing notes.
- **Not a generative synth.** No oscillators, no audio. MIDI only.
- **Not a scene graph.** inboil embeds TM and Quantizer as nodes in a
  broader generative system. The split here flattens this: Stencil does
  one thing (TM), Pointsman does one thing (quantize / harmony).
- **Not an unseeded random walker.** Stencil's bit evolution is
  reproducible for fixed `(seed, length, lock, position)`; Pointsman's
  humanize draws are reproducible for fixed `(seed, input sequence,
  params)`.

## Future extensions

Listed so the surface stays small and these don't get quietly
designed-around. Stencil's TM output modes (`note` / `gate` / `velocity`,
ADR 003) and Pointsman's quantize modes (`scale` / `chord` / `harmony`,
ADR 003) are shipped — those are no longer "future".

- **MPE output** — keep the note-emission abstraction loose enough that
  per-note pitch bend / pressure / timbre can be added without a rewrite.
- **More scales** — microtonal, custom user scales (CSV / Scala import).
- **Preset / slot system** — oedipa-style 4-slot preset bank with
  MIDI-triggered recall; useful once each product is in real use.
- **Stencil length sync to bar count** — currently `length` is in bits
  and the loop length in time depends on `subdivision` × `length`.
  Consider a "bars per loop" parameterization that internally derives
  `length`.
- **Pointsman pitch-class scale editing** — `scale` is currently an enum
  of preset names; supporting a free pitch-class set (per-key toggle on
  the keyboard) would generalize beyond the preset list.

## Parameter surface (canonical)

Targets must expose this minimum set. Additional parameters (MIDI routing
specifics, GUI-only state) may be added per target.

### Stencil

| Parameter         | Type                          | Notes                                              |
|-------------------|-------------------------------|----------------------------------------------------|
| `length`          | int `2..32`                   | shift register length in bits                      |
| `lock`            | float `0..1`                  | `1` = frozen loop, `0` = pure noise                |
| `range`           | `[int 0..127, int 0..127]`    | output MIDI note range, `lo ≤ hi`                  |
| `density`         | float `0..1`                  | active-step probability (default `1.0`)            |
| `subdivision`     | `8th \| 16th \| 32nd \| 8T \| 16T` | step unit; default `16th`                     |
| `seed`            | int                           | RNG seed for reproducibility                       |
| `mode`            | `note \| gate \| velocity`    | output mode; default `note`                        |
| `triggerMode`     | `auto \| gate \| seed`        | input handling; default `auto`                     |
| `inputChannel`    | int `0..16`                   | MIDI input channel; `0` = omni; default `0`        |
| `outputVelocity`  | int `1..127`                  | output note velocity; default `100`                |
| `outputGate`      | float `0..1`                  | gate length as fraction of step; default `0.5`     |

### Pointsman

| Parameter         | Type                                                 | Notes                                              |
|-------------------|------------------------------------------------------|----------------------------------------------------|
| `scale`           | enum (15 names)                                       | scale preset; default `major`                      |
| `root`            | int `0..11`                                          | root pitch class; default `0` (C)                  |
| `mode`            | `scale \| chord \| harmony`                          | snap strategy; default `scale`                     |
| `harmonyVoices`   | `HarmonyVoice[]` (length 0..3)                       | diatonic voice stack used in `harmony` mode        |
| `humanizeVelocity`| float `0..1`                                          | signed-noise amplitude on velocity                 |
| `humanizeGate`    | float `0..1`                                          | signed-noise amplitude on gate                     |
| `humanizeTiming`  | float `0..1`                                          | signed-noise amplitude on timing                   |
| `humanizeDrift`   | float `0..1`                                          | EMA smoothing for all humanize axes; default `0`   |
| `outputLevel`     | float `0..1`                                          | global output velocity multiplier; default `1.0`   |
| `triggerMode`     | `passthrough \| root`                                | input handling; default `passthrough`              |
| `inputChannel`    | int `0..16`                                          | MIDI input channel; `0` = omni; default `0`        |
| `controlChannel`  | int `0..16`                                          | control channel for root / chord context           |
| `seed`            | int                                                  | RNG seed for humanize draws                        |

## Origin notes

Stencil and Pointsman have two ancestors:

- **inboil's `generative.ts`** (see [`reference_inboil`](../../) memory
  and each repo's CLAUDE.md) provided both algorithms — the shift
  register math, lock semantics, scale presets, snap-to-nearest, multi-
  mode TM output, and chord/harmony quantizer modes. inboil's scene
  graph does not carry over: the products are flat MIDI effects, not
  generative graph nodes.
- **Music Thing Modular's [Turing Machine](https://musicthing.co.uk/Turing-Machine/)**
  (Tom Whitwell, 2014) is the source of the shift-register algorithm:
  an 8-bit register with a probability-controlled write-bit. Stencil
  generalizes the length to `2..32` and parameterizes lock continuously,
  but the musical intent (steered loop, not authored sequence) is
  identical.

The TM + Quantizer pairing is a long-standing Eurorack idiom (Music
Thing TM into Mutable Instruments Yarns or similar). Stencil and
Pointsman are the DAW-native expression of that idiom, with Pointsman's
humanize layer as the "shake-the-grid" element.
