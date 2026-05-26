# ADR 004: Pointsman v0.2 — chord shape, arpeggiator, and groove

## Status: Proposed

**Created**: 2026-05-22

**Amended 2026-05-25**: Added third concern (groove-as-character) and the
acid-oriented additions that follow from it — `arpSwing`, per-step
`arpAccent`, per-step `arpSlide`, plus the `phrygian-dominant` scale.
Driven by market signal that pointsman alone should be capable of being
a full acid box, rather than splitting the groove half off to stencil.
See §"Why the arp owns the groove layer" below.

## Context

Pointsman v0.1 has three structural shortcomings that v0.2 addresses
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

**3. Groove-as-character is absent.** The per-event humanize layer
covers stochastic timing / velocity perturbation (`feel` + `drift`).
The arp gives time decomposition. Neither addresses **deterministic
per-step accent / slide / swing** — the rhythmic vocabulary that
defines a whole class of music (acid house, electro, techno) where
the pattern's character lives in *which* steps are loud, *which*
steps tie into the next, and *how* the 16th grid is shuffled.
Pointsman could lean on an upstream sequencer for these per-step
controls, but that contradicts concern 1 (the standalone-musical-
output goal that motivates the arp at all).

These concerns are linked. An arpeggiator's job, since the term
"arpeggio" itself, is to **decompose a chord** over time. An arp
without a real chord primitive operating beneath it is either
trivially "iterate held notes" (single key → boring single-note
repeat) or has hidden behaviour. v0.1's `harmonyVoices` is the chord
primitive; if we redesign it for jazz expressiveness, the arp falls
out naturally as "the same primitive, decomposed in time." And the
arp is also the natural home for the groove layer: it already owns
the per-tick scheduler, so deterministic per-step controls compose
on top of the existing pattern cascade with no new infrastructure.

So v0.2:

1. Replaces `harmonyVoices` with `chordShape` (intervallic, 20
   jazz-named presets — `maj`, `m7`, `dim7`, `9`, `13`, etc.).
2. Adds `arp` as a third value of `mode`, decomposing the chord
   built by `chordShape` over a tempo-synced clock.
3. Extends the arp cascade with a **groove layer** — `arpSwing`
   (global 16th shuffle), `arpAccent` (16-step velocity pattern),
   `arpSlide` (16-step tie pattern producing legato overlaps for
   receiver-synth glide). Plus a new `phrygian-dominant` scale
   preset, the canonical pitch vocabulary of the same musical
   territory the groove layer addresses.

### Why the arp owns the groove layer

The instinctive split is "scale = pointsman, groove = some other
plug-in." That split is not load-bearing: pointsman has no contract
to be pitch-only, and the v0.1 humanize layer is already a
rhythm-domain feature (timing perturbation). What the split would
buy — clean role separation — costs the user a two-plug-in chain to
get a sound a single 303 emulation produces alone, and contradicts
the standalone-musical-output framing of concern 1.

The arp's per-tick scheduler is the right host for per-step controls
because the schedule is exactly where "this tick is accented" /
"this tick ties into the next" decisions land. Threading those
decisions back from a separate plug-in would require either MIDI
hacks (CC carrying accent intent) or invariants that DAWs do not
preserve. Folding them in is a 3-parameter addition to a structure
that already has the right shape.

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

### Scale additions

Adds one preset to the v0.1 scale table:

- **`phrygian-dominant`** — intervals `[0, 1, 4, 5, 7, 8, 10]`.
  The canonical acid / Spanish / klezmer / Hebrew-traditional scale
  (Hardfloor, Plastikman territory, also called Freygish, Spanish
  Gypsy, Ahava Rabbah). It is the missing acid-vocabulary scale
  given that v0.1 already covers `minor`, `minor-pentatonic`,
  `phrygian`, `blues`, and `harmonic`.

The scale enum order is append-only — `phrygian-dominant` slots
after `chromatic-half` (last v0.1 entry). Total preset count goes
from 15 to 16. `concept.md` §"Scales" updates the count and the
list. Test vectors at `docs/ai/quantizer-test-vectors.json` gain a
`phrygian-dominant` block covering snap behaviour at several roots.

### Arpeggiator parameters

Ten parameters effective only when `mode == arp`:

| Parameter        | Type                                                                                | Default       | Notes                                                                                                                                                                                                                |
|------------------|-------------------------------------------------------------------------------------|---------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `arpPattern`     | enum: `up` / `down` / `up-down` / `random` / `as-played` / `strike`                 | `up`          | Pool emission shape (see §Pattern semantics). The first five are traversal patterns (one pool entry per tick); `strike` is the non-traversal complement (whole pool per tick, rate-pulsed chord). |
| `arpRate`        | enum: `1/4` / `1/4D` / `1/4T` / `1/8` / `1/8D` / `1/8T` / `1/16` / `1/16D` / `1/16T` / `1/32` | `1/16`        | Step duration in PPQ. Dotted = base × 1.5, triplet = base × 2/3. Always tempo-synced to host.                                                                                                                       |
| `arpOctaves`     | int 1..4                                                                            | `1`           | Pattern extension: after one full pool iteration, the pool is replayed at `+12` semitones, up to `arpOctaves` rounds, then wraps.                                                                                  |
| `arpStepRepeats` | int 1..8                                                                            | `1`           | Each pattern step emits N consecutive ticks before the pattern advances. `1` = one emit per tick; `2` = ratchet (C C E E G G ...). Orthogonal to `arpPattern`; distinct from rate change.                            |
| `arpGate`        | float 0..1                                                                          | `0.5`         | Fraction of `arpRate` step length that the note sounds. `0.5` = staccato half, `1.0` = legato. Overridden by `arpSlide` on slide-on steps (slide forces full overlap into the next emission's noteOn). |
| `arpVariation`   | float 0..1                                                                          | `0.0`         | Probabilistic modulation of pattern execution: rests / octave shifts / flams applied per tick (see §Pattern semantics §Variation modulation). At `0` strict; at `1` ~65% of ticks are varied while pattern + repeat structure stay readable. |
| `arpLatch`       | bool                                                                                | `false`       | When on, the pool persists after all keys released; new noteOn after release replaces (not adds to) the pool.                                                                                                       |
| `arpSwing`       | float 0..0.75                                                                       | `0.0`         | 16th-note swing. Delays every even 16th-grid tick by `arpSwing × half_of_16th_duration`. Caps at 0.75 (beyond that the swung tick collides with the next 16th — musically not useful). Independent of `arpRate`: swing is always quantised against the 16th grid, so a 1/8 arp at `arpSwing=0.5` still receives the swing offset on its on-beat 16th boundaries (see §Groove layer). |
| `arpAccent`      | 16-int pattern, each 0..127                                                         | all `100`     | Per-step velocity. Indexed by `tick_index mod 16` (NOT by base-pattern step) — the 16-step grid is the rhythm cycle, decoupled from the harmonic pattern's cycle. Each step value is the absolute velocity emitted for that 16th, before humanize's `feel` jitter is applied. Default `100` matches v0.1's typical output velocity. |
| `arpSlide`       | 16-bool pattern                                                                     | all `off`     | Per-step tie. Indexed by `tick_index mod 16`. When the current tick's `arpSlide[i] == true`, the emission's noteOff is **suppressed** and the held note ties into the next emission's noteOn (legato overlap). On the receiving synth this triggers built-in portamento / glide (303 emulations and most polysynths interpret overlap-then-release as legato). Slide is mutually exclusive with rest: a step that variation turned into a Rest emits no note and produces no tie. |

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
4. Apply groove (accent / slide / swing) per §Groove layer — the
   16-step groove tables are indexed by `tick_index mod 16`, where
   `tick_index` is the global tick counter (zero on transport start,
   incrementing one per arp clock tick regardless of `arpRate`).
5. Schedule `noteOn` at `tick_sample + swing_offset` and (if not
   slide-tied) `noteOff` at `tick_sample + (arpRate samples) ×
   arpGate`. For `strike`, schedule one `noteOn` per pool voice at
   the same tick. For flam, schedule the second emission at
   `tick + step_samples × 0.5` (swing applies to the tick base; the
   half-step flam offset is added on top).
6. Velocity and timing offset go through the existing humanize
   layer (`feel` / `drift`) per emitted step. Layer order on the
   same tick is **variation → groove → humanize** — variation can
   convert the tick to rest before groove applies (no groove on
   rests); groove sets the deterministic per-step velocity / tie /
   swing offset; humanize then jitters around the deterministic
   target. All three layers consume the shared RNG in fixed order
   so a fixed `(seed, input, params)` reproduces output bit-for-bit.

Transport semantics:

- **Stop**: emit panic (existing); the next start resets pattern
  index to 0 and rebuilds humanize from `seed`.
- **Start**: pattern begins on the next clock tick after `playing`
  goes true. Initial pool: whatever notes are held at start.
- **Tempo change mid-block**: rate is recomputed from the new BPM
  at block boundary (no mid-step re-quantisation; rate change
  takes effect on the next tick).

### Pattern semantics

The arp's per-tick emission is the composition of five independent
layers, evaluated in this order: **base pattern → octave traversal
→ step repeats → variation modulation → groove layer**. Each layer
takes the previous layer's output and transforms it; the result of
the cascade is what emits at the current tick.

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

#### Groove layer

After variation has decided whether the tick emits (or is rest), the
groove layer applies deterministic per-step character to the
surviving emission. Three independent sub-axes, each indexed against
the 16-step rhythm grid by `tick_index mod 16` (so a 1/16 arp cycles
the groove every 16 ticks = one bar; a 1/8 arp cycles it every 16
ticks = two bars but only the even-indexed entries are visited; a
1/4 arp visits indices 0, 4, 8, 12 only).

This indexing choice — by `tick_index`, NOT by `arpPattern` step
index — is deliberate. The 16-step grid is the **rhythm cycle**,
decoupled from the harmonic-pattern cycle. A `random` arpPattern
still gets an accent on rhythm-step 0; a 5-note pool on `up` arp
visits accent index `(tick mod 16)` regardless of where the pool
cursor sits. This matches the canonical hardware-acid intuition
where accent / slide patterns are bar-relative, not melody-relative.

- **`arpAccent[i]` → velocity**: the resolved emission's velocity
  becomes `arpAccent[tick_index mod 16]` (absolute MIDI velocity
  0..127), replacing the pool voice's source velocity. Default
  pattern (all `100`) reproduces v0.1's typical velocity. Setting
  step 0 to `127` and the rest to `60` gives the canonical "accent
  on the downbeat, ghosted in between" acid feel. Humanize's
  `feel` jitter applies on top per existing semantics.

- **`arpSlide[i]` → noteOff suppression**: when `arpSlide[tick_index
  mod 16] == true`, the current emission's `noteOff` is **not
  scheduled** at `tick + gate_samples`. Instead, the noteOff is
  deferred until the next emission's noteOn fires — at which point
  the held note's noteOff is sent immediately *before* the new
  noteOn, producing a sample-tight overlap. On a receiving 303
  emulation or any synth with built-in glide, this overlap triggers
  the synth's portamento behaviour (slide between the two pitches).
  If the next tick is a rest, the held note's noteOff still fires
  at the next tick boundary (no infinite hold). `arpGate` is
  overridden on slide-on steps (slide implies full overlap).

- **`arpSwing` → timing offset**: every odd 16th-grid position
  (i.e. `tick_index mod 16 ∈ {1, 3, 5, 7, 9, 11, 13, 15}` for a
  1/16 arp; the corresponding off-beat positions for slower rates)
  has its noteOn delayed by `arpSwing × (16th_duration / 2)`. At
  `arpSwing = 0.5` the off-beat sits halfway to the following beat
  (classic MPC 75%-equivalent depending on how you count); at
  `arpSwing = 0.75` it sits at the cap before colliding with the
  next downbeat. Swing applies to the tick base only; humanize's
  `drift` jitter on timing applies on top.

**Composition guarantees**:

- **Rest precedence**: variation's Rest decision wins. A slide-on
  step that variation muted emits nothing and does not produce a
  tie (the previous note's noteOff fires at its original gate
  boundary).
- **Slide + flam**: variation's Flam doubles the emission; if the
  current step is slide-on, only the second flam emission ties into
  the next tick's noteOn. The first flam emission gets its normal
  noteOff (since the tie target is the next *tick*, not the next
  *emission*).
- **Slide across rate changes**: if `arpRate` changes mid-bar
  while a slide is in flight, the deferred noteOff fires at the
  next tick under the new rate. No re-quantisation of the held
  region.
- **Accent on strike**: in `strike` mode the per-step accent
  velocity applies to every voice of the chord pulse (one velocity
  value, all pool voices). Per-voice velocity is out of scope.

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
- Scale choice array extended by one entry (`phrygian-dominant`)
  appended after `chromatic-half`. Older presets that index by
  position remain valid (positions 0..14 unchanged).
- Eight new arp pids automated through APVTS: `arpPattern`,
  `arpRate`, `arpOctaves`, `arpStepRepeats`, `arpGate`,
  `arpVariation`, `arpLatch`, `arpSwing`. (Swing is the only
  groove-layer parameter that is a single scalar; per-step
  accent / slide go through ValueTree storage — see next item.)
- The 16-step accent and slide patterns are **not** APVTS
  parameters (host automation of 32 individual step values is
  user-hostile and pollutes the host's parameter list). Instead
  they live as a sibling ValueTree child node on the APVTS root
  named `arpGroovePattern`, with two child arrays: `accent` (16
  ints, 0..127) and `slide` (16 bools). Round-trip through
  `getStateInformation` / `setStateInformation` covers both
  arrays alongside the standard APVTS state. This matches how
  hardware-style step sequencers conventionally store their
  patterns (one block of state, not one automation lane per
  cell).
- `kStateVersion` bumps to **3**. A v2 state tree is recognised and
  discarded (no migrator); the new default state takes over. The
  `kRemovedV1Pids` array grows by one entry (`harmonyVoices`,
  alongside the existing v1 entries) so v2 state detection
  remains unambiguous. v3 state missing `arpGroovePattern` (e.g.
  a partial-v3 preset) loads the default all-`100` accent / all-
  `off` slide pattern.

**m4l (live.\*)**: parallel changes — `harmonyVoices` `live.*`
objects removed; new `chordShape` `live.menu` added with the same
20-preset choices; `mode` `live.menu` extended with `"arp"`;
existing `scale` `live.menu` extended with `"phrygian-dominant"`;
eight new `live.*` objects for arp params (including `arpSwing`).
parameter_longname matches the vst pids 1:1. The 16-step accent and
slide patterns are stored in the existing hidden persistence array
(ADR 006 §Hidden persistence) as a packed `accent` / `slide` block
in the program string — not surfaced as `live.*` parameters
(parallel rationale to vst: 32 `live.numbox` rows would saturate
Live's parameter inspector). Pattern editing happens in the
floating pattern-editor window (see §UI).

Preset save/load coverage extends ADR 002 §Phase 0 manual-Live
verification (mode-contextual visibility, chord-shape preset round-
trip, arp param round-trip, accent / slide pattern round-trip,
scale enum extension round-trip).

## UI

Both targets use **mode-contextual visibility**: groups are shown
only when their mode is active. CHORD SHAPE is visible in `chord`
and `arp` modes; ARP params + ARP PATTERN are visible only in
`arp` mode. The per-step accent / slide pattern editor is an
**advanced surface** — escalated to a floating window on m4l (per
design.md §"When to escalate to a floating window") and presented
as a horizontal strip in the keyboard column on vst.

vst gets a **layout redesign** for v0.2: the v0.1 "right rail of
stacked groups + centred keyboard with vertical breathing room"
arrangement leaves ~460 px of dead space around the keyboard in
the natural-size editor, which a new ARP PATTERN strip would only
worsen if appended to the rail. v0.2 instead uses **horizontal
bands** with the keyboard as the elastic visual hero — header /
pitch input band / keyboard (elastic) / arp band (mode-conditional)
/ bottom band. The right rail is dissolved. Editor natural size
shrinks from 892×602 to **892×540**; the keyboard absorbs
whatever vertical space the mode-conditional band does not use, so
every mode has zero dead zones.

m4l keeps its v0.1 layout (3 columns at 176 px host cap, saturated)
and adds the groove-pattern surface in a floating window — m4l does
not have the vertical real estate to fold the strip into the strip
inline.

### m4l layout

The left column's lower area (y ~ 88..176, ~88 px tall, previously
occupied by 3 rows of VOICES selectors) becomes a mode-switched
slot:

| `mode` value | Lower-left content                                                                       |
|--------------|-------------------------------------------------------------------------------------------|
| `scale`      | Empty (no extra controls).                                                                |
| `chord`      | CHORD SHAPE dropdown (1 row, `live.menu` over 20 presets).                                 |
| `arp`        | CHORD SHAPE dropdown + ARP params (7 widgets) in a compact 5-row layout, plus an "Open pattern editor" button. |

`chordShape` collapsing from VOICES' 3 rows to a single dropdown
frees ~56 px in the lower-left for ARP params under `mode == arp`.
Other columns (SCALE / ROOT / MODE on top-left, keyboard centre,
right column IN-CH / FEEL / DRIFT / SEED) are unchanged across
modes.

Candidate arp-mode layout (6 rows × 16 px + gaps ≈ 100 px — pushes
slightly past the 88 px budget; recovered by compacting the
`Oct/Repeat/Latch` row to share a line with `Open editor`):

```
┌─ lower-left ───────────────────────────┐
│ Chord    [ maj      v ]                │
│ Pattern  [ up       v ]                │
│ Rate     [ 1/16     v ]    Swing [.50] │
│ Oct [1]  Repeat [1]  Latch [×]  [Edit] │
│ Gate [0.50]    Variation [0.00]        │
└────────────────────────────────────────┘
```

`[Edit]` is a `live.button` that scripts `[thispatcher]` to open
the **Pattern Editor** floating window. Numboxes (16 px tall) are
used throughout to fit the m4l 176 px ceiling; the vst target
uses dials in the arp band, where vertical budget is generous.

#### m4l Pattern Editor (floating window)

Opened via the in-strip `[Edit]` button. Floating-window dimensions
~480 × 160 px (sized to fit two 16-cell strips with comfortable
touch targets). Stays on top of Live with a `[pcontrol]` parent —
closing the device closes the window. The in-strip surface remains
fully functional standalone (accent + slide patterns default to
"flat" — all 100, all off — which is musically identical to v0.1
behaviour); the window is auxiliary per design.md §"Rules when a
floating window is added".

Window contents:

```
┌─ Pointsman — Arp Pattern Editor ───────────────────────────────┐
│                                                                │
│  ACCENT   1 2 3 4 | 5 6 7 8 | 9 . . . | . . . . | (16 verts)  │
│           ▌ ▌ ▌ ▌ | ▌ ▌ ▌ ▌ | ▌ ▌ ▌ ▌ | ▌ ▌ ▌ ▌               │
│           drag-to-set 0..127 per cell                          │
│                                                                │
│  SLIDE    □ □ □ □ | □ □ □ □ | □ □ □ □ | □ □ □ □               │
│           click-to-toggle per cell                             │
│                                                                │
│              [Clear accent]  [Clear slide]  [Random]  [Close]  │
└────────────────────────────────────────────────────────────────┘
```

Accent strip uses `live.slider` (or vertical bar in `jsui`) per
cell — 16 sliders × 24 px wide ≈ 384 px wide, fits the 480 px
budget. Slide strip uses `live.toggle` per cell.

The window state persists with the device via the existing hidden
persistence array (ADR 006) — the floating window reads from /
writes to the same backing state as the program string.

### vst layout

**Editor**: 892 wide × **540** tall (down from 892×602 in v0.1).
Width unchanged; height shrinks because the redesign removes the
dead vertical breathing room around the v0.1 keyboard. Resize
range: `setResizeLimits(892, 540, 892*3, 540*3)`, non-aspect-
locked, matching v0.1's policy.

**Bands** (top → bottom):

| Band              | Height          | Visibility               | Content                                                    |
|-------------------|-----------------|--------------------------|------------------------------------------------------------|
| Header            | **32**          | always                   | "Pointsman" title left, version right, divider below.      |
| Pitch input band  | **40**          | always                   | `SCALE` / `ROOT` / `MODE` / `CHORD SHAPE` dropdowns inline. `CHORD SHAPE` collapses in `mode == scale`. |
| Keyboard          | **elastic**     | always                   | `KeyboardView` — full editor width minus edge padding, fills the vertical real estate that the mode-conditional band does not consume. |
| Mode-conditional band | **0 / 0 / 145** | `mode == arp` only   | Empty in `scale` and `chord` (keyboard absorbs the height); in `arp`, contains ARP params (2 rows) + ARP PATTERN strip (2 rows). |
| Bottom band       | **60**          | always                   | HUMANIZE row + ROUTING / DISPLAY row, both horizontally laid out. |

**Keyboard heights by mode** (with editor at natural 540 px):

```
header 32 + pitch 40 + keyboard + arp_band + bottom 60 = 540
```

- `scale`: keyboard = 540 - 32 - 40 - 0 - 60 = **408 px**
- `chord`: same as scale (CHORD SHAPE lives in the pitch input band, not the arp band) = **408 px**
- `arp`:   keyboard = 540 - 132 - 145 = **263 px**

All three are well above the design.md jsui-equivalent
touch-target floor (~50 px white-key tappable height); JUCE
KeyboardView accepts any height ≥ 60 px and renders white keys
proportionally taller as height grows. The 263 → 408 px range
gives a visibly different keyboard feel per mode (scale = tall
melodic keyboard; arp = compact "this is the input source for
the arp pool" keyboard) without ever shrinking below comfort.

**Pitch input band** (40 px):

```
┌─ PITCH ──────────────────────────────────────────────────────┐
│ SCALE [ major v ]  ROOT [ C v ]  MODE [ arp v ]  CHORD [ maj7 v ] │
└──────────────────────────────────────────────────────────────┘
                                                     ^ chord+arp only
```

Each dropdown is ~150 px wide (legend above, control below), four
across at 868 px / 4 ≈ 217 px per slot with gaps. CHORD SHAPE
visibility toggles on `mode != scale` (the slot collapses,
remaining three centre).

**Bottom band** (60 px):

```
┌─ HUMANIZE / ROUTING ─────────────────────────────────────────┐
│ HUMANIZE  Seed [12345]  Feel ●─0.30  Drift ●─0.20  [Rst][Rnd]│
│ ROUTING   In [1]  Out [Src]  MPE [×]    DISPLAY [open jsui]  │
└──────────────────────────────────────────────────────────────┘
```

Two rows of 22 px + gap, condensing the v0.1 HUMANIZE 149 px /
ROUTING 123 px / DISPLAY 37 px stack (=309 px) into ~60 px by
laying out horizontally rather than stacking. The five HUMANIZE
controls (Seed / Feel / Drift / Reset / Randomize) fit one row at
868 px; ROUTING + DISPLAY share the second.

**Arp band** (145 px, `mode == arp` only):

```
┌─ ARP ────────────────────────────────────────────────────────┐
│ Pat [up v]  Rate [1/16 v]  Oct [1]  Rep [1]  Latch [×]       │
│ Gate ●─0.5   Var ●─0.0    Swing ●─0.0                        │
├──────────────────────────────────────────────────────────────┤
│ ACCENT  ▌▌▌▌│▌▌▌▌│▌▌▌▌│▌▌▌▌                                  │
│ SLIDE   ☐☐☐☐│☐☐☐☐│☐☐☐☐│☐☐☐☐                                  │
└──────────────────────────────────────────────────────────────┘
```

Sub-section breakdown:

```
legend                                       = 11
row 1: 5 controls horizontal                 = 22
gap                                          =  4
row 2: 3 controls horizontal                 = 22
groupGap                                     =  8
divider                                      =  2
legend                                       = 11
row 3: ACCENT 16-cell bar strip              = 22
gap                                          =  4
row 4: SLIDE  16-cell toggle strip           = 22
groupGap                                     =  8
padding                                      = 13
                                              ───
                                              149 px (target ~145)
```

ACCENT / SLIDE cell width benefits from the full editor width:
868 px / 16 cells ≈ **54 px per cell**. Touch-friendly without
compromise. Beat-group dividers (every 4 cells) painted in the
renderer.

**Layout adapts on mode change** in a single direction: the
`KeyboardView::resized()` is driven by the parent `PluginEditor`
which routes `mode` changes through a `juce::ParameterListener`
that re-runs `resized()`. The zero-size-children guard layout
sanity test covers all three mode states (verifying no band
collapses unexpectedly and the keyboard receives a non-zero
height in every mode).

The breakdown comment at
[PluginEditor.cpp:34-51](../../vst/Source/Editor/PluginEditor.cpp#L34-L51)
is rewritten end-to-end to document the new band model: total
height = 540 (header 32 + pitch 40 + keyboard elastic + arp_band
{0|145} + bottom 60).

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
- `applyArpGroove(emission, tickIndex, accentTable, slideTable, swing, sixteenthDurationSamples) → { velocity, tieToNext, swingOffsetSamples }`
  — pure groove cascade. Inputs: the post-variation emission, the
  global tick index, the 16-int accent table, the 16-bool slide
  table, the swing amount, and the duration of one 16th note in
  samples (the swing offset is a fraction of half a 16th).
  Outputs: the absolute velocity for noteOn, a `tieToNext` flag
  controlling noteOff scheduling, and the timing offset (positive
  samples) for the noteOn. Tests cover: default (flat) tables
  produce velocity 100 / tieToNext false / offset 0; accent step 0
  set to 127 yields velocity 127 at `tickIndex == 0` and is
  back-to-100 at `tickIndex == 1`; slide step on yields
  `tieToNext == true`; swing 0.5 with even tickIndex yields zero
  offset and with odd tickIndex yields half-of-half-16th offset;
  rest emissions short-circuit (no groove applied).
- `scheduleArpNoteOff(currentEmission, nextTickEmission, gateSamples, slideOnCurrent) → noteOffSampleOffset`
  — pure scheduling helper. When `slideOnCurrent == true`, the
  noteOff offset equals the next tick's noteOn offset (sample-
  tight overlap). When `slideOnCurrent == false`, the noteOff
  offset equals `gateSamples`. Tested with synthetic next-tick
  emissions including rest (noteOff falls back to next tick
  boundary, not infinite hold).

### Renderer (manual)

vst: the new `PitchInputBand`, `ArpBand` (containing ACCENT /
SLIDE strips), and `BottomBand` components in
`Source/Editor/`, plus the rewritten `PluginEditor::resized()`
band layout and the `mode`-driven keyboard re-layout. ACCENT
cell drag-to-set rendering, SLIDE cell toggle rendering, and
beat-group divider painting are renderer-only. Mode-contextual
visibility implemented via JUCE `Component::setVisible` on the
arp band (collapse → keyboard expands to fill).

m4l: mode-switched regions in `Pointsman.maxpat` plus `host/ui/`
wiring. Mode-contextual visibility implemented via
`[thispatcher]`/scripting visibility messages. The Pattern
Editor floating sub-patcher (16 sliders + 16 toggles + control
buttons) is a renderer surface opened by `[Edit]`.

Manual checks per CLAUDE.md "GUI / UI components" — visual
quality, mode-switch UX (vst: keyboard smoothly resizes between
modes, no jarring jump, no zombie widgets; m4l: pool flush works
on switch), host load behaviour, interaction feel, pattern-
editor open / close behaviour and round-trip through DAW save /
load.

## Scope

**In scope**:

- Replacing `harmonyVoices` with `chordShape` (intervallic, 20
  presets, default `maj`).
- Extending `mode` enum from 2 to 3 values (append `arp`),
  exclusive semantics.
- Adding `phrygian-dominant` to the scale enum (16 presets total,
  append-only).
- Ten new arp parameters effective in `mode == arp`: the seven
  original (pattern / rate / octaves / step-repeats / gate /
  variation / latch) plus three groove parameters (`arpSwing`
  scalar; `arpAccent` 16-int pattern; `arpSlide` 16-bool pattern).
- Engine: chord-shape lookup, arp pool maintenance (chord-expanded
  voices), pattern indexing with step-repeat sub-counter, clock
  tick scheduling, `strike` simultaneous emission, variation
  cascade, groove cascade (accent velocity replacement, slide
  noteOff suppression with sample-tight overlap, swing tick
  offset).
- UI: mode-contextual visibility — CHORD SHAPE in chord+arp, ARP
  params + ARP PATTERN in arp. m4l keyboard stays at full 176 px
  with floating Pattern Editor escalation. vst editor is
  redesigned from "right rail + centred keyboard with vertical
  breathing room" to horizontal bands with an elastic-height
  keyboard (no dead space in any mode); editor natural size
  shrinks from 892×602 to 892×540.
- m4l Pattern Editor floating window (`[thispatcher]`-opened) for
  accent / slide per-step editing, per design.md §"When to escalate
  to a floating window".
- Persistence: v2 → v3 hard break (`harmonyVoices` removed, all
  new params added). v2 state recognised and discarded. 16-step
  accent / slide patterns stored as ValueTree child node (vst) /
  hidden persistence array block (m4l), not as automatable params.
- Composition with existing humanize (`feel` / `drift`) and shared
  RNG seed for reproducibility — groove is deterministic, layered
  before humanize.
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
- **User-defined arp patterns (step seq for the harmonic
  cursor)**: parametrised patterns (up / down / up-down / random /
  as-played / strike) cover the canonical hardware-arp vocabulary
  for *pitch* traversal. The accent / slide patterns added by this
  amendment are *rhythm* surfaces, not pitch — they do not satisfy
  the deferred pitch-step-seq item, which remains future work.
- **Pattern length other than 16**: the 16-step grid matches
  hardware-acid convention (TB-303, TR-series) and aligns with one
  bar at 1/16. A configurable length (8 / 32 / arbitrary) is a
  separate design call; revisit only on user request.
- **Per-step rest pattern (deterministic)**: variation's `Rest`
  cascade already produces stochastic rests. A deterministic
  per-step rest table would duplicate the surface; if it lands,
  it lands as a third strip alongside accent / slide.
- **Per-step octave pattern**: same logic as per-step rest —
  variation's octave-shift cascade handles the stochastic case;
  deterministic adds a fourth strip without clear v0.2 demand.
- **Per-voice velocity for `strike`**: chord pulses share one
  velocity per tick. Per-voice control would require either an
  extra per-voice accent table or a chord-shape extension carrying
  per-interval velocity — both are speculative.
- **Cross-octave pattern flavours** (`converge`, `diverge`,
  `key-sync` random): each adds an enum entry + state; none is
  load-bearing in v0.2.
- **Microtonal / Scala-imported chord shapes**: 12-TET intervallic
  presets cover the v0.2 audience; microtonal tuning is a deeper
  data-model question.
- **Microtonal / custom scales (Scala import, user-defined
  intervals)**: `phrygian-dominant` is the only scale this ADR
  adds. Broader custom-scale support remains the next opportunistic
  pointsman ADR.

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
    `applyArpVariation`, `applyArpGroove`, `scheduleArpNoteOff`
    per §Logic layer.
  - Extend `SCALE_INTERVALS` / equivalent vst table with
    `phrygian-dominant` (`[0, 1, 4, 5, 7, 8, 10]`), appended
    after `chromatic-half`.
  - Extend `docs/ai/quantizer-test-vectors.json`: chord-shape
    cases (20 presets × multiple root pitches, including MIDI-127
    overflow); arp cases (pattern × pool size × octaves × repeats
    × variation seeded RNG); groove cases (flat accent / per-step
    accent / slide-on / swing per 16th-grid position); scale cases
    for `phrygian-dominant` at several roots.
  - Existing scale-snap / `buildScalePitches` tests continue to
    pass. `diatonicShift` and harmony-voice helpers are removed
    (no callers in the v3 design).

- [ ] **Phase 2 — vst APVTS + processor wiring (v2 → v3 break)**
  - In `vst/Source/Plugin/Parameters.{h,cpp}`: remove
    `harmonyVoices` ValueTree child; add `chordShape` Choice pid
    (20 presets); extend `mode` choices to add `"Arp"`; extend
    `scale` choices to add `"Phrygian Dominant"`; append eight
    arp pids with §Arpeggiator parameters defaults (including
    `arpSwing`). Add `"harmonyVoices"` to `kRemovedV1Pids`
    (renamed in spirit to `kRemovedLegacyPids`) so v2 state
    detection remains unambiguous.
  - Add `arpGroovePattern` ValueTree child node on the APVTS root
    holding `accent` (16 ints) and `slide` (16 bools).
    `getStateInformation` / `setStateInformation` cover both.
  - Bump `kStateVersion` to 3 in `Engine/State.h`. v2 tree is
    recognised and discarded; new defaults take over.
  - Extend `PluginProcessor::processBlock`: in `mode == chord`,
    apply `chordShape` to snapped root for vertical expansion; in
    `mode == arp`, build/maintain pool via `applyChordShape`,
    schedule arp ticks via the existing `pending_` queue, apply
    variation cascade then groove cascade
    (`applyArpGroove` + `scheduleArpNoteOff`). Mode-switch
    triggers `panic` + pool flush. Chord-shape change mid-hold
    rebuilds pool.
  - APVTS round-trip test: v3 round-trips chord-shape, arp state,
    and `arpGroovePattern` (accent + slide arrays). Loading a v2
    tree resets to v3 defaults (verifiable by checking
    `chordShape == maj` and groove pattern at defaults).
  - Build all targets (VST3 / AU / CLAP) — `make build` succeeds.

- [ ] **Phase 3 — m4l host wiring**
  - In `Pointsman.maxpat`: remove `harmonyVoices` `live.*`
    objects; add `chordShape` `live.menu` (20 choices); extend
    `mode` `live.menu` with `"arp"`; extend `scale` `live.menu`
    with `"phrygian-dominant"`; add eight arp `live.*` objects
    (including `arpSwing`). parameter_longname matches vst pids.
  - In `m4l/host/bridge.ts`: relay `chordShape` and arp params
    (including `arpSwing`) to host state. Add bridge messages
    for accent / slide pattern read / write (whole-pattern set
    and per-cell set). Remove `harmonyVoices` plumbing.
  - In `m4l/host/host.ts`: implement chord-shape expansion in
    `mode == chord` and `mode == arp`; arp clock ticks on
    `transport.position` / BPM (only when `mode == arp`); apply
    variation cascade then groove cascade with shared humanize
    RNG; mode-switch handler flushes pool + emits panic.
    Persist accent / slide patterns through the hidden-persistence
    block in the program string (ADR 006). New `host.test.ts`
    cases (groove + persistence round-trip).
  - `pnpm -r test`, `pnpm -r build`, `pnpm bake` all succeed;
    baked `.amxd` loads in Live (manual; n4m process behaviour
    per CLAUDE.md "Live runtime gotchas").

- [ ] **Phase 4 — UI (vst layout redesign + m4l mode-contextual visibility)**
  - vst layout redesign (per §UI vst layout): rewrite
    `PluginEditor::resized()` to lay out as five bands (header /
    pitch input / keyboard elastic / arp band conditional /
    bottom band). Remove the v0.1 `RightRailView` group stack.
    Set `setSize(892, 540)` and `setResizeLimits(892, 540,
    892*3, 540*3)`. The keyboard column gains an explicit height
    callback driven by the `mode` parameter listener so it
    re-`resized()` on mode change.
  - vst new components: `PitchInputBand` (4 dropdowns row),
    `ArpBand` (2 control rows + ARP PATTERN strip), `BottomBand`
    (2 horizontally-condensed rows for HUMANIZE + ROUTING +
    DISPLAY). Each is a `juce::Component` subclass with its own
    `resized()`. The v0.1 SCALE / MODE / HARMONY / HUMANIZE /
    ROUTING / DISPLAY group components are deleted (their
    widgets are re-instantiated inside the new band components).
  - vst ACCENT / SLIDE strips: live inside `ArpBand`. Custom
    `juce::Component` for each, 16 child cells, drag-to-set
    0..127 (ACCENT) / click-to-toggle (SLIDE). State sourced
    from `arpGroovePattern` ValueTree node via a custom
    `ValueTreeListener` (not APVTS). Beat-group dividers (every
    4 cells) painted in renderer. Touch-target: ~54 px wide ×
    22 px tall per cell (from full editor width / 16).
  - vst breakdown comment at
    [PluginEditor.cpp:34-51](../../vst/Source/Editor/PluginEditor.cpp#L34-L51)
    is rewritten to document the band model (replacing the
    `rightRailContentHeight` derivation). Layout sanity test
    (zero-size-children guard) covers all three mode states,
    including the keyboard's adapted height in each mode.
  - m4l: in `Pointsman.maxpat`, replace 3-row VOICES with
    `chordShape` `live.menu` (visible in chord+arp); add ARP
    region (7 widgets including `arpSwing` numbox + `[Edit]`
    `live.button`) visible in arp via patcher visibility /
    scripting. Bridge wiring routes `mode` changes to visibility
    toggles. Logic layer pure-TS tests for the mode-driven
    visibility helper.
  - m4l Pattern Editor floating window: new sub-patcher containing
    16 `live.slider` (ACCENT) and 16 `live.toggle` (SLIDE) plus
    Clear / Random / Close buttons. Opened by `[Edit]` button via
    `[thispatcher]` scripting. State synced bidirectionally with
    the hidden-persistence block. Closing the device closes the
    window (`[pcontrol]`). Documented in design.md alongside the
    strip layout per the §"Rules when a floating window is added"
    requirement.
  - Manual visual / interaction check in Live (m4l) and Logic +
    Bitwig (vst). Verify mode-switch UX: no flicker, keyboard
    smoothly resizes between modes (no jarring jump), no zombie
    widgets; pool flush works on switch. Floating window opens /
    closes cleanly; pattern edits persist across DAW save / load.

- [ ] **Phase 5 — Documentation + release checklist update**
  - concept.md major revision:
    - §Scales: clarify scale-snap applies to input only when
      chord shape is engaged; update preset count from 15 to 16
      and add `phrygian-dominant` to the list with its use-case
      (acid / Spanish / klezmer).
    - **New §Chord shape**: intervallic semantics, 20-preset
      table, default `maj`, out-of-scale chord voices are
      deliberate.
    - §Scale and chord modes: replace `harmonyVoices` references
      with `chordShape`; add the `arp` mode description; describe
      the groove layer (accent / slide / swing) as the rhythm
      character axis distinct from humanize's stochastic
      perturbation.
    - §What Pointsman is not: amend "Not a sequencer" to clarify
      `mode == arp` is rate-driven iteration over held notes with
      deterministic per-step velocity / tie / swing — *that*
      makes it character-shaped, not autonomous-generation-shaped.
    - §Parameter surface (canonical): remove `harmonyVoices` row;
      add `chordShape` row; update `mode` row to 3 values; add
      ten arp rows (seven traversal + three groove).
    - §Future extensions: add "User-defined chord shapes",
      "Custom scales (Scala import)", "Per-step rest / octave
      pattern", and "User-defined harmonic arp patterns (step
      seq for the pitch cursor)".
  - design.md: document the m4l Pattern Editor floating window
    alongside the strip layout per the §"Rules when a floating
    window is added" requirement (in-strip standalone, "Open
    editor" affordance, state persists via shared backing).
  - ADR 002 §Phase 0 manual-Live checklist: chord-shape preset
    round-trip, mode-switch UX, ARP group coverage, ARP PATTERN
    floating window open / edit / close cycle, accent / slide
    pattern round-trip through Live save / load, pool flush on
    switch.
  - ADR 003 release checklist: chord shape + arp + groove
    coverage across Logic / Bitwig, including ARP PATTERN strip
    interaction.

## Per-target notes

- **m4l**: arp clock driven by `transport.position` polling at
  the n4m host layer. Existing host.ts scheduler already handles
  pending event queues for humanize timing offset; arp ticks
  (with swing offset and slide-deferred noteOff) fold into the
  same queue. Slide-deferred noteOff is tracked by holding a
  reference to the pending noteOff event in the per-voice state
  and rewriting its scheduled sample at the next tick's noteOn.
- **vst**: arp clock derived from
  `PlayHead::getPosition().ppqPosition` + `bpm`, projected to
  sample offset per block. Existing `pending_` `PendingMidi`
  queue carries scheduled events; arp tick scheduling reuses it.
  Slide handling on the realtime path requires a single extra
  scalar of state per held arp voice (the deferred-noteOff sample
  offset); no allocation, no I/O, fits within the audio-thread
  discipline (CLAUDE.md "Audio plugin discipline").
- **Shared engine**: chord-shape expansion, arp index advancement,
  step resolution, rate parsing, variation cascade, and groove
  cascade are pure functions exercised by the shared JSON vectors
  at `docs/ai/quantizer-test-vectors.json`. Both targets' test
  suites must conform.
