# ADR 001: Engine Interface — Turing Machine + Quantizer

## Status: Proposed

**Created**: 2026-04-30

This ADR defines the interface contracts and shared test vectors for both
generators. It will flip to "Implemented" once a reference implementation
(m4l) passes the vectors — not once every target has shipped. Each target's
engine implementation may be tracked in its own ADR if substantial.

## Context

[concept.md](../concept.md) describes Stencil's musical model in prose:
shift register with lock-controlled mutation, scale-snap to nearest, chained
TM → QT for the canonical sound. Prose is not a contract. Without a
specified interface:

- Each target (`m4l/` in TS, `vst/` in C++) may implement divergent semantics
- Behavior differences between targets become hard to diagnose
- Cross-target test vectors cannot be written
- The promise of "same TM evolution and same QT snap across all targets" is
  unverifiable

This ADR defines two pure-function engines:

- `turing.ts` / `Turing.cpp` — shift register evolution and output mapping
- `quantizer.ts` / `Quantizer.cpp` — scale construction and snap

The host (target-specific code) carries sequencer state, transport handling,
MIDI I/O, and humanize.

## Decision

Define each engine as a set of **pure functions** operating on plain-value
types. Stateless, no I/O, no globals, no allocation in the hot path beyond
fixed-size arrays. Targets implement these in their native language; shared
JSON test vectors verify cross-target conformance.

The shift register state is passed in and out by value (or as an immutable
view in C++). The host owns the canonical state and decides when to advance.
This keeps the engine trivially portable, testable, and replayable.

## TM interface

### Types

| Type             | Definition                                                   |
|------------------|--------------------------------------------------------------|
| `MidiNote`       | integer `0..127`                                             |
| `RegisterBits`   | unsigned integer holding `length` bits in the low positions  |
| `Length`         | integer `2..32`                                              |
| `Lock`           | float `0..1`                                                 |
| `Density`        | float `0..1`                                                 |
| `Range`          | `[MidiNote, MidiNote]` with `lo ≤ hi`                        |
| `RngState`       | seeded PRNG state (target-idiomatic; e.g., a `u32` or class) |

The register is conceptually a `length`-bit integer; bit `0` is the "head"
(most-recently-written), bit `length-1` is the "tail" (about-to-fall-off).
Higher bits beyond `length` are unused and MUST be masked to zero.

### Core functions

```
createRegister(length: Length, rng: RngState) -> RegisterBits
```
Initializes a fresh register by drawing `length` random bits from the seeded
RNG. The function does not mutate `rng` in place; it consumes draws via the
target's idiomatic mechanism (e.g., returns a new `(register, rng')` tuple in
TS, or takes `rng` by reference in C++).

```
shiftAndFlip(register: RegisterBits, length: Length, lock: Lock, rng: RngState) -> RegisterBits
```
Shifts the register one position toward the tail and inserts a new head bit:

1. Tail bit is `register & 1` (the bit about to fall off).
2. Right-shift `register` by 1 (`register >> 1`).
3. Draw uniform `r ∈ [0, 1)` from `rng`.
4. If `r < (1 - lock)`, write-bit is `tail XOR 1` (flipped); else write-bit
   is `tail` (preserved).
5. Insert write-bit at position `length - 1`:
   `result = (register >> 1) | (writeBit << (length - 1))`
6. Mask to `length` bits: `result & ((1 << length) - 1)`.

The exact PRNG and draw order matter for cross-target reproducibility — see
*Determinism* below.

```
shiftAndForce(register: RegisterBits, length: Length, forceBit: 0 | 1) -> RegisterBits
```
Same as `shiftAndFlip` but the head bit is forced (no PRNG draw). Used by
the `triggerMode = 'seed'` host path to write incoming MIDI notes into the
register. `forceBit = 1` for `noteOn`, `forceBit = 0` for `noteOff`.

```
registerToFraction(register: RegisterBits, length: Length) -> float in [0, 1]
```
`register / ((1 << length) - 1)`. The "all-ones" register maps to `1.0`,
the "all-zeros" register maps to `0.0`.

```
mapToNote(fraction: float in [0, 1], range: Range) -> MidiNote
```
`floor(lo + fraction × (hi - lo + 1))`, clamped to `hi` (so `fraction = 1.0`
maps to `hi`, not `hi + 1`). Returns an integer MIDI note.

### Step composition (reference algorithm)

```
TmStepResult tmStep(TmState state, TmParams params, RngState rng):
    note   = mapToNote(registerToFraction(state.register, params.length), params.range)
    active = drawUniform(rng) < params.density
    newRegister = shiftAndFlip(state.register, params.length, params.lock, rng)
    return { register: newRegister, output: { note, active } }
```

Note ordering: the **current** register is read for the output note, *then*
the register is shifted for the next step. This means the note heard at
step `n` reflects the register state *before* step `n`'s flip. This is the
inboil convention and is what produces the "loop establishes itself"
behavior.

`active` is computed from a separate PRNG draw. Both `density` and the bit-
flip draw consume from the same `rng`; the order is fixed (density draw
*before* flip draw) for cross-target reproducibility.

### Determinism requirement

For any `(seed, length, lock, density, range, position)`, the sequence of
emitted `(note, active)` pairs MUST be identical across targets, bit-for-bit.

This is enforceable only with a specified PRNG. Stencil specifies
**xoshiro128++** (32-bit state, 4×32-bit `s` words) with a documented
seeding routine: SplitMix64 from `seed: u64` to fill `s`. See test vectors
for the expected first-N draws given a seed.

Targets MAY use a faster PRNG internally if they ship a runtime flag to
switch back to xoshiro128++ for vector conformance. Default builds MUST use
xoshiro128++.

## QT interface

### Types

| Type          | Definition                                                 |
|---------------|------------------------------------------------------------|
| `MidiNote`    | integer `0..127`                                           |
| `PitchClass`  | integer `0..11` (C=0, C#=1, …, B=11)                       |
| `ScaleName`   | enum of 15 names (see concept.md §Scales)                  |
| `ScalePitches`| sorted ascending `MidiNote[]`, no duplicates               |

### Core functions

```
buildScalePitches(scale: ScaleName, root: PitchClass) -> ScalePitches
```
Returns all MIDI notes in `0..127` that belong to scale `scale` transposed
to root `root`. Output is sorted ascending. Each scale's interval set is
defined in the test vectors; see "Scale definitions" below.

```
snapToScale(note: MidiNote, pitches: ScalePitches) -> MidiNote
```
Returns the `MidiNote` in `pitches` nearest to `note`. Tie-breaking: when
the candidate is exactly between two pitches (`d_lower == d_upper`), return
the **lower** pitch. Implementation: binary search to find insertion point,
compare neighbors, apply tie rule.

### Scale definitions

Each `ScaleName` corresponds to an ordered set of semitone intervals from
the root within one octave (12 semitones). Notes outside the input scale
are obtained by repeating the interval set across all octaves and clamping
to MIDI `0..127`.

| Scale              | Intervals                          |
|--------------------|------------------------------------|
| `major`            | `[0, 2, 4, 5, 7, 9, 11]`           |
| `minor`            | `[0, 2, 3, 5, 7, 8, 10]`           |
| `dorian`           | `[0, 2, 3, 5, 7, 9, 10]`           |
| `phrygian`         | `[0, 1, 3, 5, 7, 8, 10]`           |
| `lydian`           | `[0, 2, 4, 6, 7, 9, 11]`           |
| `mixolydian`       | `[0, 2, 4, 5, 7, 9, 10]`           |
| `locrian`          | `[0, 1, 3, 5, 6, 8, 10]`           |
| `pentatonic`       | `[0, 2, 4, 7, 9]`                  |
| `minor-pentatonic` | `[0, 3, 5, 7, 10]`                 |
| `blues`            | `[0, 3, 5, 6, 7, 10]`              |
| `harmonic`         | `[0, 2, 3, 5, 7, 8, 11]`           |
| `melodic`          | `[0, 2, 3, 5, 7, 9, 11]` (ascending only) |
| `whole`            | `[0, 2, 4, 6, 8, 10]`              |
| `chromatic`        | `[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]` |
| `chromatic-half`   | identity passthrough; `snapToScale` returns the input note unchanged |

`chromatic-half` is a sentinel used by hosts to bypass quantization while
keeping the device in the chain (useful for A/B comparison and automation).
Its `buildScalePitches` returns `[0, 1, …, 127]`; `snapToScale` is then a
no-op by construction.

### Determinism requirement

`snapToScale` is fully deterministic — no PRNG. Cross-target conformance is
input/output equality on every test vector entry.

## Test vectors

Two shared JSON files:

- [`docs/ai/turing-test-vectors.json`](../turing-test-vectors.json) — TM
  conformance:
  - `prng` — xoshiro128++ first-N draws for documented seeds (sanity check
    that the PRNG is implemented correctly before testing register math)
  - `register_init` — `createRegister` results for `(seed, length)` pairs
  - `shift_and_flip` — single-step results for `(register, length, lock,
    rng_state)` inputs
  - `register_to_fraction` — scalar mapping cases including all-zeros, all-
    ones, alternating bits
  - `map_to_note` — scalar mapping cases for various ranges
  - `tm_step` — end-to-end multi-step walks: input
    `(seed, length, lock, density, range, n_steps)`, expected output
    `(note, active)[]`
- [`docs/ai/quantizer-test-vectors.json`](../quantizer-test-vectors.json) —
  QT conformance:
  - `build_scale_pitches` — pitch lists for each `(scale, root)` (a few
    spot-check entries; full enumeration is implementation-checkable from
    the interval table)
  - `snap_to_scale` — `(input_note, scale, root, expected_note)` tuples,
    including ties, edge cases (`note < min(pitches)`, `note > max(pitches)`)

Each target's test suite reads these JSONs and iterates the cases. New
semantic cases are added to JSON, not duplicated per target.

Binding assertion: every output value equals the expected value exactly.
Floating-point fractions in `register_to_fraction` use exact rational
representation (numerator/denominator) in the JSON to avoid float drift —
targets compute `fraction = num / den` and compare with a target-idiomatic
exact comparison (`===` in TS, `==` on `double` in C++ since the operands
are exactly representable up to `length = 32`).

## Sequencer state (reference shape)

The TM engine is stateless; the host carries this canonical state:

```
TmHostState {
  register: RegisterBits
  rng:      RngState         // advanced by every shiftAndFlip / density draw
  position: int              // host step index, monotonic
}
```

QT is fully stateless from the engine's perspective. The host's only
QT-related state is its parameter cache (scale, root, etc.) and the
humanize draw state (per-axis EMA value for drift smoothing) — which lives
in the host, not the engine.

## Scope

**In scope for this ADR:**
- TM register evolution semantics (shift, flip, force-bit)
- TM output mapping (fraction → note)
- QT scale construction and snap-to-nearest
- Pure-function interface contracts
- Determinism requirements (PRNG specification, exact-match conformance)
- Cross-target test vectors

**Out of scope (separate ADRs or deferred):**
- M4L device topology, host architecture, MIDI I/O — see ADR 002
- VST / JUCE implementation specifics
- TM `gate` / `velocity` output modes — see [concept.md §Future extensions](../concept.md#future-extensions)
- QT `chord` / `harmony` modes — see [concept.md §Future extensions](../concept.md#future-extensions)
- Per-event humanize layer (lives in QT host, not engine)
- MIDI input semantics (target-specific, see ADR 002)
- UI / visualization (target-specific)
- Preset / state persistence format (target-specific)

## Reference implementation (TBD)

The m4l target will host the reference implementation:

- `m4l/engine/turing.ts` — TS port; tested under Node `node:test` against
  `turing-test-vectors.json`
- `m4l/engine/quantizer.ts` — TS port; tested similarly against
  `quantizer-test-vectors.json`

This ADR flips to *Implemented* once both files exist, all test vectors
pass, and they are loaded by the m4l host (see ADR 002).

## Implementation checklist

- [ ] Implement xoshiro128++ + SplitMix64 seeding in `turing.ts`
- [ ] Implement `createRegister`, `shiftAndFlip`, `shiftAndForce`,
      `registerToFraction`, `mapToNote`, `tmStep` in `turing.ts`
- [ ] Implement `buildScalePitches`, `snapToScale` in `quantizer.ts`; encode
      scale interval table
- [x] Author `turing-test-vectors.json` (PRNG draws, register math,
      end-to-end walks) — generated by [`scripts/gen-test-vectors.mjs`](../../../scripts/gen-test-vectors.mjs)
- [x] Author `quantizer-test-vectors.json` (build, snap, ties, edges) —
      generated by the same script
- [ ] Wire `*.test.ts` files in each engine package to consume vectors and
      assert exact match
- [ ] All vector cases passing — flip status to *Implemented*
