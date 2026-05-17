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
- **controlChannel** — in `chord` mode, held MIDI notes on this
  channel form the current chord context (consumed, not output).
  In any mode with `triggerMode = root`, single notes on this
  channel set the root and are also consumed. In `harmony` mode
  (without `root` triggerMode) and `scale` mode, controlChannel
  notes pass straight through the quantize path.
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

`vst/` architecture is set by [ADR 003][adr3]; the cloned Stencil
scaffold has been removed and the project renamed to Pointsman.
Phase 0 ships VST3 + AU + CLAP bundles (Logic / Bitwig / Reaper as
named hosts, mirroring oedipa's DAW support stance). Engine, APVTS,
and editor land in ADR 003 phases 1 / 2 / 3.

[adr2]: docs/ai/adr/002-pointsman-release.md
[adr3]: docs/ai/adr/003-pointsman-vst-architecture.md

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
| [VST3](vst/) | Phase 0 | Scaffold removed, renamed Pointsman. Engine + UI in [ADR 003][adr3]. |
| [AU](vst/) | Phase 0 | Same codebase as the VST3. |
| [CLAP](vst/) | Phase 0 | Same codebase, wrapped via `clap-juce-extensions` (Bitwig's native format). |

Musical logic is shared as a specification, not as code. m4l and vst
are independent native implementations. Cross-target conformance is
verified against
[`docs/ai/quantizer-test-vectors.json`](docs/ai/quantizer-test-vectors.json).
RNG primitives are synchronized cross-repo with Stencil via
[`docs/ai/rng-test-vectors.json`](docs/ai/rng-test-vectors.json).

## DAW support

macOS only for v1. Windows / Linux distribution is deferred. The vst
target ships VST3 + AU + CLAP bundles together; per-host
compatibility on macOS:

| DAW | Format | Status | Notes |
|---|---|---|---|
| Logic Pro | AU | ✅ Primary | AU MIDI FX slot on a software-instrument track. (Logic does not host CLAP.) |
| Bitwig Studio | VST3 / CLAP | ✅ Primary | Note FX slot in front of an instrument. CLAP is Bitwig's native plug-in format. |
| Reaper | VST3 / CLAP | ⚠️ Best-effort | VST3 / CLAP in any FX chain. Not formally tested for v1. |
| Studio One | VST3 | ⚠️ Best-effort | VST3 in MIDI fx slot. Not formally tested for v1. CLAP build is also produced but has not been verified in Studio One. |
| Ableton Live | — | Use [m4l/](m4l/) | Live does not accept third-party VST3 / AU plug-ins in its MIDI Effect rack (host design, not a format limitation) and does not host CLAP. The Max for Live device is the supported path. |
| Cubase / Nuendo | — | ❌ Out of scope | The VST3 spec has no "MIDI Effect" sub-category and Cubase rejects third-party VST3 in its MIDI Inserts slot (Steinberg policy). Loading Pointsman as an Instrument with two-track MIDI-out routing works mechanically, but conflicts with the "MIDI fx, not synth" identity Pointsman is built on. The instrument-disguise topology was rejected for v1; revisit only if the Cubase ecosystem opens its MIDI Inserts to third-party VST3. |
| FL Studio | — | ❌ Out of scope | FL has no MIDI fx routing on any plug-in surface: VST3 is rejected categorically (channel slot accepts only instruments, mixer hosts only audio fx, no MIDI fx slot exists), and the CLAP host does not bridge `note-effect` plug-ins to FL's internal note bus. Reconsider only if FL adds a native MIDI fx track concept or CLAP `note-effect` routing in its host bridge. |

The matrix mirrors the one shipped on
[oedipa](https://github.com/im9/oedipa) — same author, same JUCE
conventions, same per-host stance.

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
| `vst/` (VST3 + AU + CLAP) | `git submodule update --init --recursive` | `cd vst && make build` | _(test infra rebuilt in [ADR 003][adr3] Phase 1)_ |

m4l rebake after source edits: `cd m4l && pnpm bake` (chains
`pnpm -r build` for engine/host TS → esbuild for the
`pointsman.mjs` bundle → `Pointsman.amxd` rewrite from
`Pointsman.maxpat`).

m4l distribution build: `make release` (from repo root) runs
build + bake and prepares `dist/`. The baked dev `.amxd`
references sibling JS on disk, so it only loads on the build
machine. To ship: open `m4l/Pointsman.amxd` in Max → click the
**snowflake (Freeze)** button in the patcher toolbar (inlines
every referenced JS) → *File → Save As* `dist/Pointsman.amxd`.
The frozen file is self-contained and works on any Live install.
See [ADR 002](docs/ai/adr/002-pointsman-release.md) §Phase 0.

## Design docs

The musical model lives at [`docs/ai/concept.md`](docs/ai/concept.md).
Architectural decisions live under [`docs/ai/adr/`](docs/ai/adr/) —
start with [`docs/ai/adr/INDEX.md`](docs/ai/adr/INDEX.md) and read
individual ADRs only when the relevant area is being touched.

## License

Licensed per target:

- `m4l/` — [MIT](m4l/LICENSE). Free to use, modify, and redistribute.
  Binary distribution via this repo's GitHub Releases under the
  `m4l-v*` tag namespace.
- `vst/` — [Proprietary, source-available](vst/LICENSE). Read, self-build,
  and personal non-commercial use are permitted. Redistribution and
  commercial use require permission from im9. Binaries are sold by im9.
- `docs/` — [MIT](docs/LICENSE). Shared design notes and ADRs.

Third-party components under `vst/JUCE/`, `vst/clap-juce-extensions/`, and
the CMake `_deps/` tree retain their own licenses.
