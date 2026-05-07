# Pointsman

Scale quantizer MIDI effect — snaps incoming notes to a chosen scale,
with optional chord-tone snap, diatonic harmony stack, and per-event
humanize.

Named after Edward Pointsman from Thomas Pynchon's *Gravity's Rainbow*
— the railway-pointsman metaphor (routing an incoming train onto a
discrete track) is exact for what a quantizer does: routing input
pitch to a discrete scale degree.

## What it does

On each incoming MIDI `noteOn`, Pointsman snaps the pitch to the
nearest pitch in the active scale, optionally perturbs the output's
velocity / gate / timing per the humanize layer, and emits the
quantized note. Snap is always nearest (ties round down).

User parameters:

- **scale** — 15 presets (major, minor, modes, pentatonic, blues,
  harmonic, melodic, whole, chromatic, chromatic-half)
- **root** — root pitch class for the scale
- **mode** — `scale` (snap to scale degree), `chord` (snap to
  chord-tone with scale fallback), `harmony` (input plus a diatonic
  voice stack of up to 3 voices)
- **controlChannel** — held MIDI notes on this channel form the
  current chord context for `chord` / `harmony` modes
- **humanizeVelocity / Gate / Timing / Drift** — signed-noise
  amplitudes per axis; `drift` smooths the draws over time
- **outputLevel** — global multiplier on output velocity
- **triggerMode** — `passthrough` (default) or `root` (an incoming
  control-channel note re-keys the device live)
- **seed** — RNG seed; humanize is reproducible from `(seed, input
  sequence, params)` bit-for-bit

Pointsman pairs naturally upstream with anything emitting unquantized
MIDI — most directly [Stencil][stencil], the Music Thing-style Turing
Machine sibling, for the canonical TM + Quantizer chain. It also locks
played input, arpeggiators, Tonnetz walks, or chord clips to a key.

Full musical model: [`docs/ai/concept.md`](docs/ai/concept.md).

[stencil]: https://github.com/im9/stencil

## Status

`m4l/` is feature-complete for v1 and in distribution prep; the
manual-Live verification gate is tracked by [ADR 002][adr2].

`vst/` is paused at scaffold. The plugin builds but is not
host-verified; the vst-internal architecture ADR is authored when vst
work resumes.

[adr2]: docs/ai/adr/002-pointsman-release.md

## Use (Max for Live)

Drop `m4l/Pointsman.amxd` onto a MIDI track in Ableton Live, place it
**after** any MIDI source (clip, arpeggiator, Stencil, played input),
and put an instrument after Pointsman. Press play. Pick a scale and
root; everything passing through is now scale-locked.

Building from source is only needed if you want to modify the device —
see [Build](#build) below.

## Targets

| Target | Status | Notes |
|---|---|---|
| [Max for Live](m4l/) | v1 prep | Ableton Live MIDI effect. Current primary target. |
| [VST3](vst/) | Scaffold | Paused; resumes per a future vst-architecture ADR. |
| [AU](vst/) | Scaffold | Same codebase as the VST3. Paused. |

Musical logic is shared as a specification, not as code. m4l and vst
are independent native implementations. Cross-target conformance is
verified against
[`docs/ai/quantizer-test-vectors.json`](docs/ai/quantizer-test-vectors.json).
RNG primitives are synchronized cross-repo with Stencil via
[`docs/ai/rng-test-vectors.json`](docs/ai/rng-test-vectors.json).

## Origin

The Quantizer generator is adapted from
[inboil](https://github.com/im9/inboil), a browser-based groove box
where it lives inside a scene graph as one generative node among many.
Pointsman lifts that node out into a standalone DAW-native MIDI
effect — the musical model (snap-to-nearest, chord-tone snap, diatonic
harmony) and parameter design carry over; the scene-graph architecture
does not.

Pointsman ships paired with [Stencil][stencil], the Turing Machine
counterpart. The two are independent products; the canonical chain is
`Stencil → Pointsman`.

## Build

Per-target build commands:

| Target | First time | Build | Test |
|---|---|---|---|
| `m4l/` (workspace) | `cd m4l && pnpm install` | `pnpm -r build` | `pnpm -r test` |
| `vst/` (VST3 + AU) | `git submodule update --init --recursive` | `cd vst && make build` | `cd vst && make test` |

m4l rebake after source edits: `cd m4l && pnpm bake` (refreshes
`Pointsman.amxd` from `Pointsman.maxpat`).

## Design docs

The musical model lives at [`docs/ai/concept.md`](docs/ai/concept.md).
Architectural decisions live under [`docs/ai/adr/`](docs/ai/adr/) —
start with [`docs/ai/adr/INDEX.md`](docs/ai/adr/INDEX.md) and read
individual ADRs only when the relevant area is being touched.

## License

[MIT](LICENSE). Free distribution under the `im9` label.
