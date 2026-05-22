# ADR 004: Pointsman v0.2 — chord shape primitive and arpeggiator

## Status: Proposed

**Created**: 2026-05-22

## Context

Pointsman v0.1 has two structural shortcomings that v0.2 addresses
together because they share a primitive:

**1. The arpeggiator gap.** Pointsman is purely transformative —
emits only when input arrives. With no upstream source the device is
silent. The dominant post-v0.1 complaint is "the device doesn't
stand on its own — it always needs another plugin upstream." An
arpeggiator gives the device standalone musical output on a single
held key.

**2. `harmonyVoices` is awkward and limiting.** The v0.1 chord-mode
voicing primitive (`[{interval, direction}] × 0..3`, where interval
∈ {3, 4, 5, 6} diatonic) requires the user to construct a 1-3-5
triad from individual voice editors every time. The 3-voice cap is
too tight for extensions (7th, 9th, 13th chords). And the
diatonic-interval framing prevents standard jazz / chromatic chord
vocabulary (no proper `m7♭5`, `dim7`, `maj7` — quality is determined
by the scale, not selectable).

These two concerns are linked. An arpeggiator's job, since the term
"arpeggio" itself, is to **decompose a chord** over time. An arp
without a real chord primitive operating beneath it is either
trivially "iterate held notes" (single key → boring single-note
repeat) or has hidden behaviour. v0.1's `harmonyVoices` is the chord
primitive; if we redesign it for jazz expressiveness, the arp falls
out naturally as "the same primitive, decomposed in time."

So v0.2:

1. Replaces `harmonyVoices` with `chordShape` (intervallic, 20
   jazz-named presets — `maj`, `m7`, `dim7`, `9`, `13`, etc.).
2. Adds `arp` as a third value of `mode`, decomposing the chord
   built by `chordShape` over a tempo-synced clock.

The combined design preserves Pointsman's identity (scale quantizer
for incoming MIDI) while elevating chord construction from "manual
diatonic voice stacking" to "named chord." Roles are split:

- **Scale** defines the modal center for melodic input snap.
- **Chord shape** defines the vertical voicing built on each
  snapped root. Voices are intervallic and may go out-of-scale —
  this is deliberate (e.g. `m7` over a major scale = borrowed minor
  chord, a valid musical move).
- **Arpeggiator** decomposes the chord-expanded pool over time
  (mode = arp).

Status flips back to Implemented (and the file moves to `archive/`)
once all checklist items are complete.

## Decision

### Mode is exclusive, three values

`mode = scale | chord | arp` (exclusive). Each mode layers on the
previous:

- `scale`: input is scale-snapped, output is the snapped pitch
  (1-in-1-out). `chordShape` is ignored.
- `chord`: input is scale-snapped, then `chordShape` builds
  intervallic voices on top of the snapped root (1-in-N-out, all
  voices simultaneous). N is determined by the preset (`maj` =
  3 voices, `9` = 5 voices, `13` = 6 voices).
- `arp`: input is scale-snapped + chord-expanded (same as `chord`
  mode), producing a pool of voices. The pool is decomposed
  sequentially over time by arp pattern + rate.

The modes form a natural progression — scale = no chord, chord =
chord without decomposition, arp = chord with decomposition. The
`chordShape` primitive is shared between `chord` and `arp` (no
hidden state), so looking at the current `mode` plus `chordShape`
tells the user exactly what the device is doing.

### Chord shape primitive (replaces `harmonyVoices`)

`chordShape` is a single enum parameter, valued from a 20-preset
table. Each preset maps to an intervallic voicing — absolute
semitones from the snapped root, **not scale degrees**.

| preset    | intervals (semitones)             | notes                            |
|-----------|-----------------------------------|----------------------------------|
| `maj`     | `[0, 4, 7]`                       | major triad — **default**        |
| `m`       | `[0, 3, 7]`                       | minor triad                      |
| `dim`     | `[0, 3, 6]`                       | diminished triad                 |
| `aug`     | `[0, 4, 8]`                       | augmented triad                  |
| `sus2`    | `[0, 2, 7]`                       |                                  |
| `sus4`    | `[0, 5, 7]`                       |                                  |
| `power`   | `[0, 7]`                          | 1-5 power chord                  |
| `maj7`    | `[0, 4, 7, 11]`                   |                                  |
| `m7`      | `[0, 3, 7, 10]`                   |                                  |
| `7`       | `[0, 4, 7, 10]`                   | dominant 7th                     |
| `m7b5`    | `[0, 3, 6, 10]`                   | half-diminished                  |
| `dim7`    | `[0, 3, 6, 9]`                    |                                  |
| `6`       | `[0, 4, 7, 9]`                    |                                  |
| `m6`      | `[0, 3, 7, 9]`                    |                                  |
| `add9`    | `[0, 4, 7, 14]`                   |                                  |
| `maj9`    | `[0, 4, 7, 11, 14]`               |                                  |
| `m9`      | `[0, 3, 7, 10, 14]`               |                                  |
| `9`       | `[0, 4, 7, 10, 14]`               | dominant 9                       |
| `13`      | `[0, 4, 7, 10, 14, 21]`           |                                  |
| `octave`  | `[0, 12]`                         | root + octave                    |

**Intervallic semantics, not diatonic**: `maj7` on `C` produces
`C, E, G, B` regardless of the active scale. In `C major` all four
pitches are in scale; in `C minor` the `E` and `B` are
out-of-scale. The chord still emits them — these are chromatic
colours / borrowed-chord material, which is musically valid and
deliberate. Scale-snap applies only to incoming MIDI (chord roots),
not to chord voices.

This is a v2-era design departure. `harmonyVoices` is removed
entirely; the migration is a hard break per the v1 → v2 precedent
(no migrator).

### Scale-snap is input-only

When `mode ∈ {chord, arp}`, the engine applies scale-snap to
incoming MIDI to determine each chord's root, then applies
`chordShape`'s intervals from that root without further snap.
Outputs may therefore contain pitches outside the active scale —
this is the chord-voicing freedom that the new design buys.

When `mode == scale`, scale-snap applies as in v0.1 (`chordShape`
is ignored, output is the snapped pitch).

The keyboard editor's "in-scale" dot indicators continue to derive
from `(scale, root)` — they reflect the input snap target, not the
chord output. This keeps the keyboard's role (showing the scale)
consistent across all modes.

### Arpeggiator parameters

Seven parameters effective only when `mode == arp`:

| Parameter        | Type                                                                                | Default       | Notes                                                                                                                                                                                                                |
|------------------|-------------------------------------------------------------------------------------|---------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `arpPattern`     | enum: `up` / `down` / `up-down` / `random` / `as-played` / `strike`                 | `up`          | Pool emission shape (see §Pattern semantics). The first five are traversal patterns (one pool entry per tick); `strike` is the non-traversal complement (whole pool per tick, rate-pulsed chord). |
| `arpRate`        | enum: `1/4` / `1/4D` / `1/4T` / `1/8` / `1/8D` / `1/8T` / `1/16` / `1/16D` / `1/16T` / `1/32` | `1/16`        | Step duration in PPQ. Dotted = base × 1.5, triplet = base × 2/3. Always tempo-synced to host.                                                                                                                       |
| `arpOctaves`     | int 1..4                                                                            | `1`           | Pattern extension: after one full pool iteration, the pool is replayed at `+12` semitones, up to `arpOctaves` rounds, then wraps.                                                                                  |
| `arpStepRepeats` | int 1..8                                                                            | `1`           | Each pattern step emits N consecutive ticks before the pattern advances. `1` = one emit per tick; `2` = ratchet (C C E E G G ...). Orthogonal to `arpPattern`; distinct from rate change.                            |
| `arpGate`        | float 0..1                                                                          | `0.5`         | Fraction of `arpRate` step length that the note sounds. `0.5` = staccato half, `1.0` = legato.                                                                                                                       |
| `arpVariation`   | float 0..1                                                                          | `0.0`         | Probabilistic modulation of pattern execution: rests / octave shifts / flams applied per tick (see §Pattern semantics §Variation modulation). At `0` strict; at `1` ~65% of ticks are varied while pattern + repeat structure stay readable. |
| `arpLatch`       | bool                                                                                | `false`       | When on, the pool persists after all keys released; new noteOn after release replaces (not adds to) the pool.                                                                                                       |

### Held-note pool

The "pool" is the set of voices the arp iterates. It is only built
and maintained when `mode == arp`:

1. Incoming `noteOn` is scale-snapped (existing).
2. The snapped pitch is chord-expanded by `chordShape` into N
   voices (intervallic offsets from the snapped pitch). These N
   voices are added to the pool, tagged with the source note for
   noteOff removal.
3. Incoming `noteOff` removes the voices contributed by that source
   note (unless `arpLatch == true`, in which case the pool is held
   until the next `noteOn` after all keys released).
4. Pool deduplicates by `(pitch, channel)` — overlapping voices
   from multiple held notes collapse.
5. Changing `chordShape` mid-hold rebuilds the pool from currently-
   held notes with the new shape (panic + rebuild).

In `mode ∈ {scale, chord}` the pool is not built; notes emit
immediately per v0.1 / v2 behaviour. Switching `mode` mid-session
triggers `panic` (flush sounding notes, discard pool; drift state
untouched per concept.md §"Per-event humanize").

### Arp clock

The arp clock ticks at the host's PPQ position, sample-accurately,
only when `mode == arp`. On each tick:

1. Advance pattern index per `arpPattern` over current pool size N
   (and over `arpOctaves` rounds, with `arpStepRepeats` ticks per
   index — full cycle length = N × arpOctaves × arpStepRepeats for
   traversal patterns, arpOctaves × arpStepRepeats for `strike`).
2. Resolve the voice (or chord, for `strike`) at the current
   index / round, with octave offset and step-repeat sub-counter.
3. Apply variation modulation (rest / octave shift / flam / normal)
   per §Variation modulation.
4. Schedule `noteOn` at the tick sample and `noteOff` at
   `tick + (arpRate samples) × arpGate`. For `strike`, schedule one
   `noteOn` per pool voice at the same tick. For flam, schedule the
   second emission at `tick + step_samples × 0.5`.
5. Velocity and timing offset go through the existing humanize
   layer (`feel` / `drift`) per emitted step. Variation draws occur
   **before** humanize's feel/drift draws on the same tick, so the
   two layers are sequentially deterministic against the shared
   RNG stream.

Transport semantics:

- **Stop**: emit panic (existing); the next start resets pattern
  index to 0 and rebuilds humanize from `seed`.
- **Start**: pattern begins on the next clock tick after `playing`
  goes true. Initial pool: whatever notes are held at start.
- **Tempo change mid-block**: rate is recomputed from the new BPM
  at block boundary (no mid-step re-quantisation; rate change
  takes effect on the next tick).

### Pattern semantics

The arp's per-tick emission is the composition of four independent
layers, evaluated in this order: **base pattern → octave traversal
→ step repeats → variation modulation**. Each layer takes the
previous layer's output and transforms it; the result of the
cascade is what emits at the current tick.

For pool `[p0, p1, ..., p_{N-1}]` (sort = pitch ascending, ties by
insertion order):

#### Base patterns

- `up`: indices `0, 1, ..., N-1, 0, 1, ...` (one voice per tick).
- `down`: `N-1, N-2, ..., 0, N-1, ...` (one voice per tick).
- `up-down`: `0, 1, ..., N-1, N-2, ..., 1, 0, 1, ...` (one voice
  per tick; endpoints visited once per excursion).
- `random`: `rand() % N` per tick. Uses the existing humanize RNG
  stream so a fixed `(seed, input sequence, params)` reproduces
  the arp bit-for-bit.
- `as-played`: insertion order (oldest source note first, voices
  within each source in chord-shape order), one voice per tick.
- `strike`: **all pool voices emit simultaneously** per tick. Each
  tick is a chord pulse at the arp rate — rhythmic, not iterative.
  Octave traversal applies to the whole chord per tick. Variation's
  flam doubles the chord, not individual voices.

#### Octave traversal

Octave round `r ∈ [0, arpOctaves)` adds `12r` semitones to the
resolved pitch (or to every voice of a `strike` chord). After one
full pool cycle the round advances; total cycle length = N ×
arpOctaves ticks (traversal), or arpOctaves ticks (`strike`). If
the shifted pitch exceeds MIDI 127, the note is dropped (silent
step) rather than clamped.

#### Step repeats

`arpStepRepeats` (1..8) multiplies each pattern step by N: the
same pool voice emits N consecutive ticks before the pattern
advances.

- `up` × `arpStepRepeats=2`: `0,0, 1,1, ..., N-1,N-1, 0,0, ...`
  yielding `C C E E G G ...` for an up arp on `[C, E, G]`.
- `strike` × `arpStepRepeats=2`: the chord pulses twice per octave
  round before advancing.
- Total cycle length = N × arpOctaves × arpStepRepeats (traversal)
  or arpOctaves × arpStepRepeats (`strike`).

Step repeats is the rhythmic ratchet axis — distinct from rate
change (which compresses the whole pattern in time) because it
preserves the arp rate while subdividing the harmonic motion. It
is also distinct from variation's flam (next subsection), which is
a sub-tick subdivision of a single emission.

#### Variation modulation

`arpVariation` (0..1) is the arp's character knob: a single value
that probabilistically perturbs each tick's emission while
preserving the pattern axis and step-repeat structure (up / down /
etc. remains readable, ratchet remains audible, even at max
variation). At each tick — after base pattern, octave round, and
step repeat have determined the would-be emission — one RNG draw
`v ∈ [0, 1)` selects from a probability cascade:

| Range of `v`                          | Effect             | Notes                                                                                  |
|---------------------------------------|--------------------|----------------------------------------------------------------------------------------|
| `[0, 0.30 × arpVariation)`            | **Rest**           | This tick emits nothing. Pattern index and step-repeat counter still advance — the gap is musical, not a stall. |
| `[0.30 × av, 0.50 × av)`              | **Octave shift**   | Resolved pitch ±12 semitones (second RNG draw for sign). If shift would exit `[0, 127]`, fall through to "normal step". For `strike`, the whole chord shifts. |
| `[0.50 × av, 0.65 × av)`              | **Flam**           | Emit the resolved pitch (or chord) twice: once at the tick, once at `tick + step_samples × 0.5`. |
| `[0.65 × av, 1.0)`                    | **Normal step**    | The pre-variation emission emits unchanged.                                            |

Probability summary at `arpVariation = 1.0`: 30% rest, 20% octave
shift, 15% flam, 35% normal. The 35% normal floor ensures the
pattern shape and the step-repeat ratchet stay musically
recognisable even at max variation.

**Composition guarantees**:

- **Chord-shape preservation**: octave shift adds ±12 semitones,
  which is a no-op on pitch class — the chord shape is preserved
  across octave-shifted voices.
- **RNG stream**: variation draws share the existing humanize RNG
  per concept.md §"Per-event humanize". A fixed `(seed, input
  sequence, params)` reproduces the varied arp output bit-for-bit.
- **Chord shape during flam**: when flam fires in `mode == arp`,
  the second emission re-resolves the same pool index — there is
  no fresh chord-shape evaluation, since the chord was already
  baked into the pool at noteOn time.

### Edge cases

- **Pool empty when tick fires**: no emission, pattern index stays
  at 0. (Latched mode preserves the last pool, so empty-pool only
  occurs when arp is active but no keys have ever been pressed.)
- **Pool grows mid-cycle**: pattern index is preserved; if it now
  exceeds `N × arpOctaves`, it wraps modulo on the next tick.
- **Pool shrinks mid-cycle**: pattern index wraps modulo
  `N × arpOctaves` on the next tick.
- **`chordShape` change mid-hold**: pool rebuilt from currently
  held notes with the new shape; pattern index resets to 0; panic
  flushes any pending arp emissions.
- **MPE pass-through**: per-note channel input (channels 2..15 in
  MPE) bypasses arp processing entirely and falls through to the
  existing pass-through path (concept.md §"Input handling"). Arp
  only consumes notes on `inputChannel`.

## Persistence

**vst (APVTS)**:

- `harmonyVoices` removed entirely (no migration, hard v2 → v3
  break per the v1 → v2 precedent).
- `chordShape` added as an int / Choice pid, indexed 0..19 over
  the preset table above (default `maj` = 0). On-disk index order
  is append-only — future presets append, never insert.
- `mode` choice array extended from `{ "Scale", "Chord" }` to
  `{ "Scale", "Chord", "Arp" }` (append-only).
- Seven new arp pids: `arpPattern`, `arpRate`, `arpOctaves`,
  `arpStepRepeats`, `arpGate`, `arpVariation`, `arpLatch`.
- `kStateVersion` bumps to **3**. A v2 state tree is recognised and
  discarded (no migrator); the new default state takes over. The
  `kRemovedV1Pids` array grows by one entry (`harmonyVoices`,
  alongside the existing v1 entries) so v2 state detection
  remains unambiguous.

**m4l (live.\*)**: parallel changes — `harmonyVoices` `live.*`
objects removed; new `chordShape` `live.menu` added with the same
20-preset choices; `mode` `live.menu` extended with `"arp"`; seven
new `live.*` objects for arp params. parameter_longname matches the
vst pids 1:1.

Preset save/load coverage extends ADR 002 §Phase 0 manual-Live
verification (mode-contextual visibility, chord-shape preset round-
trip, arp param round-trip).

## UI

Both targets use **mode-contextual visibility**: groups are shown
only when their mode is active. CHORD SHAPE is a single dropdown
visible in `chord` and `arp` modes; ARP params (six controls
beyond `chordShape`) are visible only in `arp` mode.

The m4l keyboard stays at full 176 px (no shortening); the vst
right rail's content height stays at 570 (the chord shape +
arp slot collapses cleanly to fit within the existing budget).

### m4l layout

The left column's lower area (y ~ 88..176, ~88 px tall, previously
occupied by 3 rows of VOICES selectors) becomes a mode-switched
slot:

| `mode` value | Lower-left content                                                                       |
|--------------|-------------------------------------------------------------------------------------------|
| `scale`      | Empty (no extra controls).                                                                |
| `chord`      | CHORD SHAPE dropdown (1 row, `live.menu` over 20 presets).                                 |
| `arp`        | CHORD SHAPE dropdown + ARP params (6 widgets) in a compact 4-row layout. |

`chordShape` collapsing from VOICES' 3 rows to a single dropdown
frees ~56 px in the lower-left for ARP params under `mode == arp`.
Other columns (SCALE / ROOT / MODE on top-left, keyboard centre,
right column IN-CH / FEEL / DRIFT / SEED) are unchanged across
modes.

Candidate arp-mode layout (5 rows × 16 px + gaps ≈ 84 px, fits in
~88 px budget):

```
┌─ lower-left ───────────────────────────┐
│ Chord    [ maj      v ]                │
│ Pattern  [ up       v ]                │
│ Rate     [ 1/16     v ]                │
│ Oct [1]  Repeat [1]   Latch [×]        │
│ Gate [0.50]    Variation [0.00]        │
└────────────────────────────────────────┘
```

Gate and Variation use `live.numbox` (16 px tall) rather than
`live.dial` (24+ px) to fit the budget. (The vst target uses dials,
where rail vertical budget is generous.)

### vst layout

The right rail's existing group stack restructures around a single
**CHORD SHAPE** slot that is mode-switched in content, plus a
mode-conditional **ARP** group:

| `mode` value | Slot content                                                          |
|--------------|------------------------------------------------------------------------|
| `scale`      | Both CHORD SHAPE and ARP hidden.                                       |
| `chord`      | CHORD SHAPE dropdown only (~37 px including legend, replacing the v1 HARMONY group's 97 px). |
| `arp`        | CHORD SHAPE dropdown + ARP group (~93 px for arp param rows).         |

`rightRailContentHeight` stays at **570 px**. The HARMONY group's
former 97 px slot now accommodates either `chord`'s 37 px CHORD
SHAPE block alone (60 px spare collapses gracefully) or `arp`'s
~130 px CHORD SHAPE + ARP block (33 px more than HARMONY's 97 —
absorbed by the existing rail headroom plus the slack from other
groups since rail content remains under 570).

ARP group height under current theme tokens:

```
legend + 2                                   = 11
row 1: [Pattern v]   [Rate v]                = 22
gap                                          =  4
row 2: Oct [n]   Repeat [n]   Latch [×]      = 22
gap                                          =  4
row 3: Gate ●─ 0.50    Var ●─ 0.00           = 22
groupGap                                     =  8
                                              ───
                                               93 px
```

CHORD SHAPE group (visible in chord + arp):

```
legend + 2                                   = 11
row 1: [ chord shape v ]                     = 22
groupGap                                     =  8
                                              ───
                                               41 px
```

The breakdown comment at
[PluginEditor.cpp:38-49](../../vst/Source/Editor/PluginEditor.cpp#L38-L49)
gains per-mode breakdowns and the explicit note that CHORD SHAPE
and ARP slots are mode-switched.

Mockups:

```
┌─ CHORD SHAPE ──────────────────────────┐
│ [ maj                              v ] │
└────────────────────────────────────────┘
```

```
┌─ ARP ──────────────────────────────────┐
│ Pattern  [ up        v ]               │
│ Rate     [ 1/16      v ]               │
│ Oct [1]  Repeat [1]   Latch  [×]       │
│ Gate    ●─── 0.50    Var ●─── 0.00     │
└────────────────────────────────────────┘
```

### Logic layer (testable, shared)

- `applyChordShape(rootMidi, shape) → number[]` — pure lookup +
  interval addition over the preset table. Test for all 20
  presets at multiple root pitches, including MIDI-127-edge cases
  (high root + high interval drops voices that exceed 127).
- `nextArpIndex(pattern, currentIndex, currentRound, repeatTick, poolSize, octaves, stepRepeats) → { newIndex, newRound, newRepeatTick }`
  — pure function over enum + ints.
- `resolveArpStep(pool, index, octaveRound) → { pitches[] | rest }`
  — returns array (size 1 for traversal patterns, size N for
  `strike`). Test for pool-empty, MIDI-127 overflow, index wrap.
- `parseArpRate(enum) → ppq` — table lookup, dotted / triplet math.
- `applyArpVariation(emission, variation, rngDraw) → { emit | rest, pitchShift, flam }`
  — pure variation cascade.

### Renderer (manual)

CHORD SHAPE + ARP group layout in `Source/Editor/ControlsView`
(vst) and mode-switched regions in `Pointsman.maxpat` plus
`host/ui/` wiring (m4l). Mode-contextual visibility implemented via
JUCE `Component::setVisible` (vst) and `[thispatcher]`/scripting
visibility messages (m4l). Manual checks per CLAUDE.md "GUI / UI
components" — visual quality, mode-switch UX (no flicker / no
layout shift), host load behaviour, interaction feel.

## Scope

**In scope**:

- Replacing `harmonyVoices` with `chordShape` (intervallic, 20
  presets, default `maj`).
- Extending `mode` enum from 2 to 3 values (append `arp`),
  exclusive semantics.
- Seven new arp parameters effective in `mode == arp`.
- Engine: chord-shape lookup, arp pool maintenance (chord-expanded
  voices), pattern indexing with step-repeat sub-counter, clock
  tick scheduling, `strike` simultaneous emission, variation
  cascade.
- UI: mode-contextual visibility — CHORD SHAPE in chord+arp, ARP
  params in arp. m4l keyboard stays at full 176 px; vst rail
  content height stays at 570 px.
- Persistence: v2 → v3 hard break (`harmonyVoices` removed, all
  new params added). v2 state recognised and discarded.
- Composition with existing humanize (`feel` / `drift`) and shared
  RNG seed for reproducibility.
- Manual-Live / manual-Logic verification additions in ADR 002 /
  003 release checklists.
- concept.md major revision (§Scales, §Chord shape new section,
  §What Pointsman is not, §Parameter surface, §Future extensions).

**Out of scope** — deferred with musical reasoning, not YAGNI:

- **User-defined chord shapes** (custom intervals beyond the 20
  presets): the preset list covers canonical jazz / pop / power-
  chord vocabulary; novel custom voicings deserve a real editor
  surface (per-voice integer input or named-degree builder), not
  a corner of this ADR. Add when user demand surfaces, likely as
  a future `chordShape = { kind: "preset" | "custom", ... }`
  expansion.
- **User-defined arp patterns (step seq)**: parametrised patterns
  (up / down / up-down / random / as-played / strike) cover the
  canonical hardware-arp vocabulary. User patterns encode the
  composer's hand and deserve their own ADR with a step editor
  surface. Tracked in concept.md §Future extensions.
- **Per-pattern swing**: humanize already covers timing
  perturbation via `feel`. A dedicated swing axis duplicates the
  surface; if needed later it belongs in humanize's airspace.
- **Cross-octave pattern flavours** (`converge`, `diverge`,
  `key-sync` random): each adds an enum entry + state; none is
  load-bearing in v0.2.
- **Microtonal / Scala-imported chord shapes**: 12-TET intervallic
  presets cover the v0.2 audience; microtonal tuning is a deeper
  data-model question.

## Implementation checklist

Phased per CLAUDE.md TDD gates. Each phase: tests first →
implementation → build + test. Manual verification ride-alongs are
flagged where DAW / UI behaviour cannot be unit-tested.

- [ ] **Phase 1 — Engine logic (cross-target, pure functions)**
  - Add `applyChordShape(rootMidi, shape) → number[]` to both
    `m4l/engine/quantizer.ts` and
    `vst/Source/Engine/Quantizer.{h,cpp}`. Internal preset table
    (20 entries).
  - Add `nextArpIndex`, `resolveArpStep`, `parseArpRate`,
    `applyArpVariation` per §Logic layer.
  - Extend `docs/ai/quantizer-test-vectors.json`: chord-shape
    cases (20 presets × multiple root pitches, including MIDI-127
    overflow); arp cases (pattern × pool size × octaves × repeats
    × variation seeded RNG).
  - Existing scale-snap / `buildScalePitches` tests continue to
    pass. `diatonicShift` and harmony-voice helpers are removed
    (no callers in the v3 design).

- [ ] **Phase 2 — vst APVTS + processor wiring (v2 → v3 break)**
  - In `vst/Source/Plugin/Parameters.{h,cpp}`: remove
    `harmonyVoices` ValueTree child; add `chordShape` Choice pid
    (20 presets); extend `mode` choices to add `"Arp"`; append
    seven arp pids with §Parameter additions defaults. Add
    `"harmonyVoices"` to `kRemovedV1Pids` (renamed in spirit to
    `kRemovedLegacyPids`) so v2 state detection remains
    unambiguous.
  - Bump `kStateVersion` to 3 in `Engine/State.h`. v2 tree is
    recognised and discarded; new defaults take over.
  - Extend `PluginProcessor::processBlock`: in `mode == chord`,
    apply `chordShape` to snapped root for vertical expansion; in
    `mode == arp`, build/maintain pool via `applyChordShape`,
    schedule arp ticks via the existing `pending_` queue, apply
    variation cascade. Mode-switch triggers `panic` + pool flush.
    Chord-shape change mid-hold rebuilds pool.
  - APVTS round-trip test: v3 round-trips both chord-shape and
    arp state. Loading a v2 tree resets to v3 defaults
    (verifiable by checking `chordShape == maj` after load).
  - Build all targets (VST3 / AU / CLAP) — `make build` succeeds.

- [ ] **Phase 3 — m4l host wiring**
  - In `Pointsman.maxpat`: remove `harmonyVoices` `live.*`
    objects; add `chordShape` `live.menu` (20 choices); extend
    `mode` `live.menu` with `"arp"`; add seven arp `live.*`
    objects. parameter_longname matches vst pids.
  - In `m4l/host/bridge.ts`: relay `chordShape` and arp params
    to host state. Remove `harmonyVoices` plumbing.
  - In `m4l/host/host.ts`: implement chord-shape expansion in
    `mode == chord` and `mode == arp`; arp clock ticks on
    `transport.position` / BPM (only when `mode == arp`); apply
    variation cascade with shared humanize RNG; mode-switch
    handler flushes pool + emits panic. New `host.test.ts` cases.
  - `pnpm -r test`, `pnpm -r build`, `pnpm bake` all succeed;
    baked `.amxd` loads in Live (manual; n4m process behaviour
    per CLAUDE.md "Live runtime gotchas").

- [ ] **Phase 4 — UI (mode-contextual visibility, both targets)**
  - vst: remove HARMONY group (replaced by CHORD SHAPE single
    dropdown, visible in chord+arp). Add ARP group, visible in
    arp only. Both attach a `ParameterListener` on `mode` to
    drive `setVisible`. `rightRailContentHeight` stays 570;
    breakdown comment at PluginEditor.cpp:38-49 gains per-mode
    sub-breakdowns. Layout sanity test (zero-size-children guard)
    covers the new groups and visibility transitions.
  - m4l: in `Pointsman.maxpat`, replace 3-row VOICES with
    `chordShape` `live.menu` (visible in chord+arp); add ARP
    region (6 widgets) visible in arp via patcher visibility /
    scripting. Bridge wiring routes `mode` changes to visibility
    toggles. Logic layer pure-TS tests for the mode-driven
    visibility helper.
  - Manual visual / interaction check in Live (m4l) and Logic +
    Bitwig (vst). Verify mode-switch UX: no flicker, no layout
    shift, no zombie widgets; pool flush works on switch.

- [ ] **Phase 5 — Documentation + release checklist update**
  - concept.md major revision:
    - §Scales: clarify scale-snap applies to input only when
      chord shape is engaged.
    - **New §Chord shape**: intervallic semantics, 20-preset
      table, default `maj`, out-of-scale chord voices are
      deliberate.
    - §Scale and chord modes: replace `harmonyVoices` references
      with `chordShape`; add the `arp` mode description.
    - §What Pointsman is not: amend "Not a sequencer" to clarify
      `mode == arp` is rate-driven iteration over held notes (not
      autonomous generation).
    - §Parameter surface (canonical): remove `harmonyVoices` row;
      add `chordShape` row; update `mode` row to 3 values; add
      seven arp rows.
    - §Future extensions: add "User-defined chord shapes" and
      "User-defined arp patterns".
  - ADR 002 §Phase 0 manual-Live checklist: chord-shape preset
    round-trip, mode-switch UX, ARP group coverage, pool flush
    on switch.
  - ADR 003 release checklist: chord shape + arp coverage across
    Logic / Bitwig.

## Per-target notes

- **m4l**: arp clock driven by `transport.position` polling at
  the n4m host layer. Existing host.ts scheduler already handles
  pending event queues for humanize timing offset; arp ticks fold
  into the same queue.
- **vst**: arp clock derived from
  `PlayHead::getPosition().ppqPosition` + `bpm`, projected to
  sample offset per block. Existing `pending_` `PendingMidi`
  queue carries scheduled events; arp tick scheduling reuses it.
- **Shared engine**: chord-shape expansion, arp index advancement,
  step resolution, rate parsing, and variation cascade are pure
  functions exercised by the shared JSON vectors at
  `docs/ai/quantizer-test-vectors.json`. Both targets' test
  suites must conform.
