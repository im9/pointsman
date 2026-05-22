# Concept

Pointsman is a DAW-native **scale quantizer** for MIDI: it snaps incoming
notes to a user-selected scale, with optional `chord` mode (single-note-
becomes-chord expansion via a configurable intervallic chord shape) and
`arp` mode (the chord-expanded pool decomposed sequentially over a
tempo-synced clock). A per-event humanize layer (velocity / gate /
timing / drift) applies across all modes. MIDI effect, single-purpose
UI, ships as a standalone product on `m4l/` and `vst/` targets.

This document describes the **musical model** — the parts that are shared
across Pointsman's targets (`m4l/`, `vst/`). Per-target UI, parameter
surface specifics, and interaction design live in each target's own ADRs.

## What Pointsman does

On each incoming MIDI `noteOn`, Pointsman:

1. Computes the active scale pitches as MIDI numbers across the octave
   range, built from `(scale, root)`.
2. Snaps the input note to the **nearest** scale pitch (binary search;
   ties round down).
3. Depending on `mode`, either emits the snapped pitch (`scale`),
   expands it into a chord via `chordShape` (`chord`), or pushes the
   chord-expanded voices into a pool that the arpeggiator iterates
   over time (`arp`).
4. Optionally perturbs each emitted note's velocity, gate length, and
   timing per the humanize layer (signed uniform noise on each axis,
   opt-in, default 0).

Snap is **always nearest** — no skip mode, no repeat mode. Nearest is
the most musically useful default and the only one inboil shipped with
success.

**Scale-snap applies to input only.** In `chord` / `arp` modes, the
scale-snapped pitch becomes the *root* of the chord, but the chord's
voices themselves are determined intervallically by `chordShape` (see
§"Chord shape" below). Chord voices may therefore go out-of-scale —
this is deliberate. `m7` over a major scale is a valid borrowed-chord
move, and Pointsman lets the user pick it.

### Scales (v1)

Fifteen presets, derived from inboil's fourteen with two adjustments
(rename `minor-pent` → `minor-pentatonic` for naming consistency, and
add `chromatic-half`):

`major`, `minor`, `dorian`, `phrygian`, `lydian`, `mixolydian`, `locrian`,
`pentatonic`, `minor-pentatonic`, `blues`, `harmonic`, `melodic`, `whole`,
`chromatic`, `chromatic-half` (last is a no-op identity for "passthrough
within the device chain").

The scale defines the **modal center** for melodic input snap. It does
not constrain chord voices in `chord` or `arp` modes.

### Modes

Pointsman ships three exclusive modes — `scale`, `chord`, `arp`.
Each layers on the previous:

- **`scale`** (default, 1-in-1-out): snap input to nearest scale
  pitch and emit it. `chordShape` is ignored.
- **`chord`** (1-in-N-out): snap input + apply `chordShape` to build
  N intervallic voices on top of the snapped root, all emitted
  simultaneously. N varies by preset (`maj` = 3 voices, `9` = 5,
  `13` = 6, etc.).
- **`arp`**: snap input + apply `chordShape` → pool of voices. The
  pool is decomposed sequentially by the arpeggiator at a tempo-
  synced rate, with optional probabilistic variation. See ADR 004
  for the full pattern / rate / variation / latch / step-repeat
  parameter surface and semantics.

The three modes form a natural progression: scale = no chord,
chord = chord without time decomposition, arp = chord with time
decomposition. Looking at `mode` plus `chordShape` tells the user
exactly what the device is doing — no hidden state.

### Chord shape

`chordShape` is a single enum parameter, valued from a 20-preset
table. Each preset maps to an **intervallic voicing** — absolute
semitones from the snapped root (not scale degrees). Default `maj`.

| preset    | intervals (semitones from root)   | notes                              |
|-----------|-----------------------------------|------------------------------------|
| `maj`     | `[0, 4, 7]`                       | major triad — **default**          |
| `m`       | `[0, 3, 7]`                       | minor triad                        |
| `dim`     | `[0, 3, 6]`                       | diminished triad                   |
| `aug`     | `[0, 4, 8]`                       | augmented triad                    |
| `sus2`    | `[0, 2, 7]`                       |                                    |
| `sus4`    | `[0, 5, 7]`                       |                                    |
| `power`   | `[0, 7]`                          | 1-5 power chord                    |
| `maj7`    | `[0, 4, 7, 11]`                   |                                    |
| `m7`      | `[0, 3, 7, 10]`                   |                                    |
| `7`       | `[0, 4, 7, 10]`                   | dominant 7th                       |
| `m7b5`    | `[0, 3, 6, 10]`                   | half-diminished                    |
| `dim7`    | `[0, 3, 6, 9]`                    |                                    |
| `6`       | `[0, 4, 7, 9]`                    |                                    |
| `m6`      | `[0, 3, 7, 9]`                    |                                    |
| `add9`    | `[0, 4, 7, 14]`                   |                                    |
| `maj9`    | `[0, 4, 7, 11, 14]`               |                                    |
| `m9`      | `[0, 3, 7, 10, 14]`               |                                    |
| `9`       | `[0, 4, 7, 10, 14]`               | dominant 9                         |
| `13`      | `[0, 4, 7, 10, 14, 21]`           |                                    |
| `octave`  | `[0, 12]`                         | root + octave                      |

**Intervallic, not diatonic.** `maj7` on a `C` input produces
`C, E, G, B` regardless of the active scale. In `C major` all four
pitches happen to be in scale; in `C minor` the `E` and `B` are
out-of-scale — they still emit, as chromatic colours / borrowed-
chord material. This is the v2-era replacement for v0.1's diatonic
`harmonyVoices` (which constrained quality to whatever the scale
allowed); the chord shape primitive now carries the chord identity
explicitly, letting the user pick jazz / chromatic / power-chord
vocabulary independently of the modal center.

Earlier Pointsman drafts (v1) exposed `harmonyVoices` (a 0..3-entry
list of `{interval, direction}` pairs with interval ∈ {3, 4, 5, 6}
diatonic). v2 removes this in favour of `chordShape` — see ADR 004
for migration semantics (hard v2 → v3 break, no migrator).

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
  attack into the configured chord shape, turning a monophonic source
  into automatic chord voicings.
- **Single held note + arp** — Pointsman in `arp` mode decomposes the
  chord built on the held note over a tempo-synced clock, producing a
  full arpeggio from one key.

Pointsman is also useful on its own (especially in `arp` mode) as a
real-time scale + chord + decomposition layer. The host's MIDI
routing handles the chain — no internal IPC or shared state with
other devices. Communication is via MIDI notes, period.

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
TM-style generator, Tonnetz, played input, or Pointsman's own
arpeggiator. Perturbing upstream notes before quantization would muddy
any deterministic loop / lock semantics in the source; doing it after
the snap leaves upstream timing intact.

The draws are seeded (`seed` parameter, persisted in plugin state but
not exposed in the editor) so a fixed `(seed, input sequence, params)`
reproduces the same output bit-for-bit. **The arp's variation cascade
(rest / octave shift / flam) draws from the same RNG stream**, so a
fixed seed reproduces the varied arp output bit-for-bit as well. New
plugin instances pick a random seed on construction so two parallel
Pointsman instances on double-tracked parts do not produce
phase-coherent identical humanize; saving a preset captures the
current seed, so reloading reproduces the saved performance. Drift
smoothing maintains its EMA state per-axis, reset on transport
**start** (so each play loop re-seeds from the same initial state).
Transport stop does not touch drift state — it only flushes any
in-flight notes.

## MIDI semantics

Pointsman is a MIDI effect: it consumes transport (clock + position) and
emits MIDI notes. Sample-accurate timing against the host clock is
expected on all targets.

### Input handling

Pointsman is fundamentally input-driven (it transforms incoming notes;
in `arp` mode it also tempo-iterates them, but still emits only when a
key has been pressed or is latched). Input arrives on the
`inputChannel` (omni or 1..16) — the only channel filter Pointsman
exposes. Notes on other channels pass through untouched. This
pass-through is load-bearing for MPE: with `IN CH` set to the master
channel (e.g. 1), per-note channels (2..15) carrying pitch bend /
pressure / timbre must still flow to the downstream MPE instrument,
even though Pointsman only chord-expands or arpeggiates the master.
There is no separate control channel: `chord` / `arp` mode's voice
stack is configured by `chordShape`, not driven by held input notes.

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
preset change, parameter change that affects active output, panic,
mode switch, `chordShape` change mid-hold), all currently-sounding
notes must receive `noteOff`. Panic (all-notes-off on all channels) is
required behavior, not optional.

### Polyphony / overlap

Pointsman preserves the input's polyphony: if multiple notes arrive in
the same processing block, all are quantized and (in `chord` / `arp`
modes) chord-expanded; in `arp` mode all chord-expanded voices accrue
into the pool.

### Transport

Humanize state (the EMA accumulator) is reset on transport stop. The
arp clock starts on the next tick after `playing` goes true; pattern
index resets to 0 on play-start. Resuming from an arbitrary position
does not require Pointsman-side recomputation in `scale` / `chord`
modes — the device is input-driven, and the upstream source is
responsible for deterministic position handling. In `arp` mode the
clock derives from the host's PPQ position, so transport scrubbing
naturally re-aligns the arp tick grid.

Pointsman's seeded contract is over humanize and arp-variation draws:
a fixed `(seed, input sequence, params)` reproduces the same output
bit-for-bit.

## What Pointsman is not

Clarifying scope by exclusion:

- **Not an autonomous sequencer.** Pointsman in `arp` mode emits at a
  tempo-synced rate, but only iterates notes that the user is holding
  (or that are latched from a prior hold). There is no internal
  pattern source — the harmonic content always comes from input.
- **Not a synth.** No oscillators, no audio. MIDI only.
- **Not a scene graph.** inboil embeds Quantizer as a node in a
  broader generative system. Pointsman flattens this: one MIDI effect,
  one job (quantize / chord-expand / arpeggiate).
- **Not an unseeded random walker.** Humanize and arp-variation draws
  are reproducible for fixed `(seed, input sequence, params)`.
- **Not a strict scale quantizer for chord voices.** Scale-snap
  applies to *input* only. Chord voices are intervallic and may emit
  out-of-scale pitches — this is deliberate (chromatic / borrowed
  chord voicings are valid musical material).

## Future extensions

Listed so the surface stays small and these don't get quietly
designed-around. Pointsman's quantize modes (`scale` / `chord` /
`arp`) and chord shape primitive are shipped — those are no longer
"future".

- **MPE output** — keep the note-emission abstraction loose enough that
  per-note pitch bend / pressure / timbre can be added without a rewrite.
- **More scales** — microtonal, custom user scales (CSV / Scala import).
- **Pitch-class scale editing** — `scale` is currently an enum of
  preset names; supporting a free pitch-class set (per-key toggle on
  the keyboard) would generalize beyond the preset list.
- **User-defined chord shapes** — the 20-preset `chordShape` table
  covers canonical jazz / pop / power-chord vocabulary; custom
  intervallic voicings (per-voice interval input or named-degree
  builder) extend the surface for users with novel chord vocabularies.
- **User-defined arp patterns** — the parametrised `arpPattern` set
  (up / down / up-down / random / as-played / strike) covers canonical
  hardware-arp vocabulary; a step editor would let the user define
  the composer's hand at the level of "which pool index plays on
  which step, with what rest / velocity / gate."
- **Preset / slot system** — Oedipa-style 4-slot preset bank with
  MIDI-triggered recall; useful once the device is in real use.

## Parameter surface (canonical)

Targets must expose this minimum set. Additional parameters (MIDI routing
specifics, GUI-only state) may be added per target.

| Parameter         | Type                                                       | Notes                                              |
|-------------------|------------------------------------------------------------|----------------------------------------------------|
| `scale`           | enum (15 names)                                            | scale preset; default `major`                      |
| `root`            | int `0..11`                                                | root pitch class; default `0` (C)                  |
| `mode`            | enum: `scale` / `chord` / `arp`                            | output strategy; default `scale`. Three values exclusive; layers on the previous (chord adds shape, arp adds time decomposition). |
| `chordShape`      | enum (20 presets — see §"Chord shape")                     | intervallic chord voicing; default `maj`. Effective in `chord` and `arp` modes; ignored in `scale`. Replaces v1 `harmonyVoices`. |
| `arpPattern`      | enum: `up` / `down` / `up-down` / `random` / `as-played` / `strike` | arp pool emission shape; default `up`. Effective only when `mode == arp`. See ADR 004 §"Pattern semantics". |
| `arpRate`         | enum: `1/4` / `1/4D` / `1/4T` / `1/8` / `1/8D` / `1/8T` / `1/16` / `1/16D` / `1/16T` / `1/32` | arp step duration in PPQ; default `1/16`. Effective only when `mode == arp`. Tempo-synced. |
| `arpOctaves`      | int `1..4`                                                 | arp octave traversal extent; default `1`. Effective only when `mode == arp`. |
| `arpStepRepeats`  | int `1..8`                                                 | each pattern step emits N consecutive ticks (ratchet axis); default `1`. Effective only when `mode == arp`. |
| `arpGate`         | float `0..1`                                               | fraction of arp step length that the note sounds; default `0.5`. Effective only when `mode == arp`. |
| `arpVariation`    | float `0..1`                                               | probabilistic per-tick modulation (rest / octave / flam); default `0.0`. Effective only when `mode == arp`. See ADR 004 §"Variation modulation". |
| `arpLatch`        | bool                                                       | pool persists after all keys released; default `false`. Effective only when `mode == arp`. |
| `feel`            | float `0..1`                                               | humanize amount across velocity / gate / timing; default `0` |
| `drift`           | float `0..1`                                               | EMA smoothing for humanize axes; default `0`       |
| `inputChannel`    | int `0..16`                                                | MIDI input channel; `0` = omni; default `0`        |
| `seed`            | int `0..2^24-1`                                            | RNG seed for humanize + arp-variation draws. **Persisted in plugin state but not exposed in the editor.** New instances pick a random seed on construction; preset save / load is bit-exact. Range bounded by IEEE-754 single-precision exact-representation: APVTS-style hosts store params as float32, and every integer in `[0, 2^24]` is exactly representable, so seeds round-trip bit-identical. m4l mirrors the same range for cross-target preset compatibility. |

Parameters that earlier Pointsman drafts exposed and are **removed**
in v2 / v3 (the surface change is auditable rather than a quiet
deletion):

- `humanizeVelocity` / `humanizeGate` / `humanizeTiming` (v1 → v2) —
  collapsed into `feel` (three independent draws scaled by one
  amount).
- `humanizeDrift` (v1 → v2) — renamed to `drift`.
- `outputLevel` (v1 → v2) — dropped. Output velocity is what the
  upstream sends (optionally perturbed by `feel`); per-instance MIDI
  gain belongs to the host's velocity scaling or the synth's velocity
  sensitivity, not to a quantizer.
- `triggerMode` (v1 → v2) — dropped. Key-change from a controller is
  covered by the editor keyboard tap or host parameter automation on
  `root`.
- `controlChannel` (v1 → v2) — dropped. Chord-mode output is
  configuration-driven (`chordShape` in v3, `harmonyVoices` in v2)
  rather than derived from a separate channel's held notes.
- `harmony` mode (v1 → v2) — merged into `chord` (v2 sense). The
  former harmony mode's voice-stack semantics became chord mode's
  semantics in v2; in v3 those semantics are replaced by intervallic
  `chordShape`.
- `harmonyVoices` (v2 → v3) — replaced by `chordShape`. The
  per-voice diatonic `{interval, direction}` list was awkward for
  building common chord voicings, capped at 3 voices (too few for
  7th / 9th / 13th extensions), and forced chord quality to be
  determined by the active scale rather than user-selectable. v3's
  `chordShape` is a single enum of 20 intervallic presets covering
  canonical jazz / pop / power-chord vocabulary. See ADR 004.

## Origin notes

Pointsman has two ancestors:

- **inboil's `generative.ts`** (see the `reference_inboil` memory and
  CLAUDE.md) provided the algorithm — scale presets, snap-to-nearest,
  and diatonic harmony as the v1 chord primitive. inboil's scene
  graph does not carry over: Pointsman is a flat MIDI effect, not a
  generative graph node. The diatonic `harmonyVoices` primitive
  inherited from inboil was replaced by intervallic `chordShape` in
  v3 (see ADR 004) to admit chromatic / jazz chord vocabulary that
  the diatonic constraint couldn't express.
- **The TM + Quantizer Eurorack idiom** (Music Thing TM into Mutable
  Instruments Yarns or similar) is the long-standing pairing Pointsman
  is designed to slot into. Pointsman is the DAW-native expression of
  that idiom's quantizer half, with its humanize layer as the
  "shake-the-grid" element that hardware quantizers historically
  lack, and its `arp` mode as the standalone-playable extension that
  removes the need for an upstream MIDI source.
