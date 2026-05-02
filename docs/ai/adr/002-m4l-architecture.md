# ADR 002: M4L Architecture — Stencil TM + Stencil QT

## Status: Proposed

**Created**: 2026-04-30

This ADR specifies the m4l target's architecture: device topology (two
devices), per-device host/patcher/engine layering, the host↔engine and
Max↔host protocols, the canonical `live.*` parameter list, MIDI I/O
including `triggerMode`, the QT humanize layer, and state ownership.

## Context

[concept.md](../concept.md) defines two musical units (TM and QT) and notes
m4l ships them as separate devices. [ADR 001](001-engine-interface.md)
specifies the pure-function engines. Neither defines:

- How the engines are loaded into Max
- How transport, MIDI input, and live.* parameter changes flow into the
  engines
- What the canonical live.* parameter set looks like
- Where humanize / drift / outputLevel live in the runtime
- How state is persisted in Live sessions

This ADR fills those gaps for the m4l target. VST and other future targets
get their own architecture ADRs.

## Decision

Ship m4l as **two separate devices**, each with the same internal layering:

```
.amxd device (loaded by Live)
  └─ Max patch (UI, transport, MIDI I/O, live.* parameters)
       └─ [node.script] running Node.js
            └─ host package (TS, Max protocol bridge + state)
                 └─ engine package (TS, pure functions per ADR 001)
```

The two devices share the engine package (`m4l/engine/`) and have separate
host packages (`m4l/host-tm/`, `m4l/host-qt/`). Each `.amxd` loads its
own host's `index.js` via `[node.script]` and exposes its own live.*
parameter surface. The devices do not share runtime state — they
communicate via standard Live MIDI routing only.

## Topology — two devices, not one

This is the authoritative record of the topology decision documented in
[concept.md §Topology](../concept.md#topology--two-devices-not-one).

**Decision:** ship m4l as `Stencil TM` and `Stencil QT`, two independent
`.amxd` devices.

**Why over one combined device:**

- m4l UI canvas is small (≈ 320×130 typical). Fitting both TM and QT
  parameter groups into one device crowds the layout; two focused devices
  are more readable.
- Each device is musically useful standalone (TM as a chromatic random-pitch
  generator; QT as a scale snapper for any upstream MIDI source). Combining
  them into one device foregoes the standalone use cases or requires
  bypass-style sub-mode UI.
- Live's MIDI effects rack already makes chaining trivial. The "drag two
  devices, chain them" workflow is the m4l idiom, not friction.
- It mirrors inboil's mental model (two independent generative nodes) — the
  source of the design.

**Costs accepted:**

- Two `.amxd` files to maintain, two patcher edits per UI change in shared
  surface (e.g., common branding, global theme)
- Brand "Stencil" splits into a family ("Stencil TM", "Stencil QT")
- Users discover the chain pattern from documentation, not from the device
  shipping pre-chained

The VST target will revisit this — combining into one plugin is a
reasonable choice when chaining friction is higher (separate plugin
windows, separate parameter automation lanes). VST's architecture lives in
its own ADR.

## File layout

```
m4l/
  package.json            # pnpm workspace root
  pnpm-workspace.yaml     # packages: engine, host-tm, host-qt
  engine/                 # shared TS engine
    turing.ts
    turing.test.ts
    quantizer.ts
    quantizer.test.ts
    package.json
    tsconfig.json
    dist/                 # built; tracked in repo for [node.script] consumption
  host-tm/                # Stencil TM host
    index.js              # n4m entry, loaded by [node.script]
    host.ts               # main TM host class
    bridge.ts             # Max message protocol
    *.test.ts
    package.json
    tsconfig.json
    dist/
  host-qt/                # Stencil QT host
    index.js
    host.ts
    bridge.ts
    humanize.ts           # per-event humanize draws + drift EMA (see §Humanize)
    *.test.ts
    package.json
    tsconfig.json
    dist/
  Stencil-TM.maxpat       # patcher source, tracked in git
  Stencil-TM.amxd         # built device artifact (frozen .maxpat)
  Stencil-QT.maxpat
  Stencil-QT.amxd
  scripts/
    maxpat-to-amxd.mjs    # bake .maxpat → .amxd, ported from oedipa
                          # (argv: device name, "TM" | "QT")
```

`dist/` is committed (not in `.gitignore`) because Max's `[node.script]`
loads it directly — there is no install step on the user's machine.

The current scaffold has a single `m4l/host/` package; restructuring to
`host-tm/` and `host-qt/` is part of this ADR's implementation checklist.

## Stencil TM — device architecture

### Patcher (`Stencil-TM.maxpat`)

- **Live UI controls** — `live.dial`, `live.numbox`, `live.menu` for each
  parameter; bound to `live.*` parameter objects so Live sees them in the
  parameter list and they persist with the session.
- **Transport** — `[transport]` object emits a tick on each subdivision step;
  routed to a `[node.script host-tm/index.js]` instance via a `step` message.
- **MIDI input** — `[midiin]` → filter by `inputChannel` → forward `noteOn` /
  `noteOff` to the host as `noteIn` / `noteOff` messages.
- **MIDI output** — host emits `note <pitch> <velocity> <channel>` messages
  back through `Max.outlet`; routed to `[noteout]`.
- **State refresh** — on patcher load and on every parameter change, the
  current `live.*` value is sent to the host as a `setParam <key> <value>`
  message. The host is the source of truth for runtime state; the patcher
  is the source of truth for *persisted* state (Live preset chunks via
  `live.*` objects).

### Host (`m4l/host-tm/host.ts`)

State held by the TM host:

```
TmHostState {
  register: RegisterBits      // current shift register
  rng:      RngState           // xoshiro128++ state, advanced per step
  position: int                // monotonic step index since transport start
  params:   TmParams           // last-known parameter values
  notesOn:  Set<{pitch, ch}>   // currently-sounding notes for note-off discipline
}
```

Per-step flow (driven by Max `step` message):

1. Compute output via `tmStep(state, params, rng)` (ADR 001).
2. If `output.active`:
   a. For every entry in `notesOn`, emit `noteOff`.
   b. Emit `noteOn pitch=output.note velocity=outputVelocity ch=outputChannel`.
   c. Schedule `noteOff` at `gate × stepDuration` from now (host-side timer).
3. Update `state.register` and `state.rng` from `output`.
4. Increment `state.position`.

`triggerMode` modulates the entry to step 1:

- `auto` — every Max `step` triggers `tmStep`.
- `gate` — `tmStep` only fires when at least one input note is currently
  held. Released → step is silent and register frozen.
- `seed` — incoming `noteOn` invokes `shiftAndForce(register, length, 1)`
  immediately, then on the next host `step` the standard read-output path
  fires (without an additional `shiftAndFlip` — the seed write *is* the
  shift). Likewise `noteOff` → `shiftAndForce(..., 0)`. The seed path
  bypasses `lock` entirely while active; if no input has arrived since
  transport start, fall back to `auto`-style behavior.

### Engine wiring

The host imports the engine via TS source (`../engine/turing.ts`). Each
host's `tsconfig.json` sets `rootDir: "../"` and lists the engine source
in `include`, so `tsc` compiles host + engine into `dist/host-tm/host.js`
+ `dist/engine/turing.js` together — `[node.script]` loads the host bundle
without needing a separate engine package resolution. Test code follows
the same import path; `node --test` TS-strips at runtime. (Pattern ported
from oedipa's `m4l/host/tsconfig.json`.)

## Stencil QT — device architecture

### Patcher (`Stencil-QT.maxpat`)

Symmetric to TM. Differences:

- **No transport input** — QT is event-driven on incoming MIDI, not
  step-driven. (Transport is needed only for humanize draws to align with
  the bar grid; see Humanize below.)
- **MIDI input is mandatory** — without input, QT has nothing to do. The UI
  surfaces this with a "no input" indicator state.
- **Live preset chunks** persist scale, root, humanize amounts, etc.

### Host (`m4l/host-qt/host.ts`)

State:

```
QtHostState {
  scalePitches: ScalePitches  // cached from buildScalePitches(scale, root)
  humanizeRng: RngState        // separate RNG so humanize is independent of any TM
  driftState:  { vel, gate, time }  // EMA values for drift smoothing
  params:      QtParams
  notesOn:     Set<{pitch, ch}>
}
```

Per-input-event flow (driven by `noteIn pitch velocity` from Max):

1. If `triggerMode == 'root'` and the note arrives on `qt.controlChannel`,
   update `params.root` (set to `pitch % 12`), rebuild `scalePitches`, and
   return — control-channel events are consumed and not forwarded to the
   quantize path. (When `controlChannel == inputChannel`, this means the
   same note feeds the root path only; configure separate channels to
   quantize and root-control simultaneously.)
2. Snap: `out = snapToScale(pitch, scalePitches)`.
3. Apply humanize (see §Humanize) to derive `(velocityFinal, gateFinal,
   timingOffset)`.
4. Schedule `noteOn out velocityFinal ch` at `now + timingOffset`.
5. Schedule `noteOff out 0 ch` at `now + timingOffset + gateFinal × source_step_duration`.

The "source step duration" is the canonical step length the host uses for
gate scaling. Since QT has no transport-driven step of its own, it derives
this from the input note's gap to the previous note (or from a host
parameter `gateReference`). v1 uses input-derived: track the last input
`noteOn` time and use the delta to the current event as the reference. This
is approximate but aligns gate behavior with the input rhythm.

### Engine wiring

Same pattern as TM: host imports `../engine/dist/quantizer.js`; tests
import TS directly.

## Host ↔ Max protocol

Symmetric for both devices, with device-specific message names where the
semantics differ.

### Max → host (incoming messages)

Common:

```
setParam <key> <value>          // scalar parameter update
setRange <lo> <hi>              // tuple parameter (TM range)
panic                           // all-notes-off, reset state
noteIn <pitch> <velocity> <ch>  // incoming MIDI note-on
noteOff <pitch> <ch>            // incoming MIDI note-off
transportStart                  // pre-roll snapshot at transport 0→1
transportStop                   // reset host state, emit panic
```

Stencil TM only:

```
step <position>                 // advance to host step index `position`
```

(QT has no `step`; it processes `noteIn` events as they arrive.)

### Host → Max (outgoing messages, via `Max.outlet`)

Common:

```
note <pitch> <velocity> <ch>    // velocity=0 means note-off
ready                           // emitted once after host construction
```

Stencil TM only:

```
register <bit0> <bit1> ... <bitN>   // current register state for UI display
position <n>                         // current step position for UI
```

Stencil QT only:

```
scaleChanged <scale-name> <root>     // emitted on scale/root changes for UI
```

## live.* parameter surface

### Stencil TM

| `live.*` name             | Type               | Range / values                         | Default | Notes                                  |
|---------------------------|--------------------|----------------------------------------|---------|----------------------------------------|
| `tm.length`               | live.numbox int    | `2..32`                                | `8`     | shift register length in bits          |
| `tm.lock`                 | live.dial float    | `0..1`                                 | `0.5`   | bit-flip probability inverse           |
| `tm.range.lo`             | live.numbox int    | `0..127`                               | `48`    | output range floor; clamped `≤ hi`     |
| `tm.range.hi`             | live.numbox int    | `0..127`                               | `72`    | output range ceil; clamped `≥ lo`      |
| `tm.density`              | live.dial float    | `0..1`                                 | `1.0`   | active-step probability                |
| `tm.subdivision`          | live.menu          | `8th \| 16th \| 32nd \| 8T \| 16T`     | `16th`  | step rate                              |
| `tm.seed`                 | live.numbox int    | `0..2^31-1`                            | `42`    | xoshiro128++ seed                      |
| `tm.triggerMode`          | live.menu          | `auto \| gate \| seed`                 | `auto`  | input handling                         |
| `tm.inputChannel`         | live.numbox int    | `0..16` (`0` = omni)                   | `0`     | MIDI input channel                     |
| `tm.outputVelocity`       | live.numbox int    | `1..127`                               | `100`   | static output velocity                 |
| `tm.outputGate`           | live.dial float    | `0..1`                                 | `0.5`   | gate length as step fraction           |
| `tm.outputChannel`        | live.numbox int    | `1..16`                                | `1`     | MIDI output channel                    |

### Stencil QT

| `live.*` name             | Type               | Range / values                         | Default        | Notes                                  |
|---------------------------|--------------------|----------------------------------------|----------------|----------------------------------------|
| `qt.scale`                | live.menu          | 15 names                               | `major`        | scale preset                           |
| `qt.root`                 | live.numbox int    | `0..11`                                | `0` (C)        | root pitch class                       |
| `qt.mode`                 | live.menu          | `scale` (v1)                           | `scale`        | snap strategy; `chord`/`harmony` v2    |
| `qt.humanizeVelocity`     | live.dial float    | `0..1`                                 | `0`            | signed-noise amplitude                 |
| `qt.humanizeGate`         | live.dial float    | `0..1`                                 | `0`            | signed-noise amplitude                 |
| `qt.humanizeTiming`       | live.dial float    | `0..1`                                 | `0`            | signed-noise amplitude                 |
| `qt.humanizeDrift`        | live.dial float    | `0..1`                                 | `0`            | EMA smoothing across humanize axes     |
| `qt.outputLevel`          | live.dial float    | `0..1`                                 | `1.0`          | global output velocity multiplier      |
| `qt.triggerMode`          | live.menu          | `passthrough \| root`                  | `passthrough`  | input handling                         |
| `qt.inputChannel`         | live.numbox int    | `0..16` (`0` = omni)                   | `0`            | MIDI input channel (quantize path)     |
| `qt.controlChannel`       | live.numbox int    | `1..16`                                | `16`           | root-update channel; used when `triggerMode = root` |
| `qt.seed`                 | live.numbox int    | `0..2^31-1`                            | `42`           | humanize PRNG seed                     |

All `live.*` parameters are exposed for host automation. Range and timing
parameters are linear in their displayed unit (the dial reads `0.50`,
internal value is `0.5`).

## MIDI I/O details

### Note-off discipline

Required behavior on every device:

- On `transportStop`, emit `noteOff` for every note in `notesOn`, clear set,
  reset host state (register stays; position resets to 0).
- On any `setParam` that affects active output (in TM: `length`, `seed`,
  `range`, `subdivision`; in QT: `scale`, `root`), flush all `notesOn` with
  `noteOff` before applying.
- On `panic`, send all-notes-off across all channels (`CC 123`) regardless
  of `notesOn` state.
- On Live preset change, the patcher's `freebang` fires panic before the
  new preset's parameters are applied.

### Input channel and omni

`inputChannel = 0` means "any channel" (omni). Patcher-side filter compares
`channel >= inputChannel` and `channel <= inputChannel || inputChannel == 0`.

### Output channel

TM: `tm.outputChannel` selects emit channel.
QT: emit on the **same channel as the input event** (preserves multi-channel
routing). This means `qt.outputChannel` is *not* a parameter.

## QT humanize layer

Lives in `m4l/host-qt/humanize.ts`. Pure functions:

```
draw(rng: RngState, amplitude: float in [0,1]) -> float in [-amplitude, +amplitude]
```
Uniform signed noise.

```
drift(prev: float, raw: float, factor: float in [0,1]) -> float
```
EMA: `result = factor × prev + (1 - factor) × raw`.

Per-event composition for QT output:

```
rawVel  = draw(rng, humanizeVelocity)
rawGate = draw(rng, humanizeGate)
rawTime = draw(rng, humanizeTiming) × 0.5   // timing range is ±0.5 step
```

If `humanizeDrift > 0`, smooth each axis through its drift state:

```
smoothedVel  = drift(driftState.vel,  rawVel,  humanizeDrift)
driftState.vel = smoothedVel
// (same for gate and time)
```

Output composition:

```
velocityFinal = clamp1to127(round(inputVelocity × (1 + smoothedVel) × outputLevel))
gateFinal     = clamp01(outputGateBase × (1 + smoothedGate))    // outputGateBase = 1.0 for v1
timingOffset  = smoothedTime × sourceStepDuration
```

where `inputVelocity` is the incoming `noteIn` velocity, `outputLevel` is
the `qt.outputLevel` parameter, and `sourceStepDuration` is the
input-derived step reference.

The draws share the same `humanizeRng` (seeded by `qt.seed`). Draw order
per event: velocity → gate → timing. This is binding for cross-target
reproducibility (when QT eventually exists on VST) and for test vectors.

`humanizeDrift = 0`: drift state is bypassed, draws are independent. State
*still updates* (so toggling drift mid-session doesn't desync) — but the
output uses the raw value.

## State persistence

Live preset chunks persist `live.*` parameter values automatically. The
host treats these as the source of truth on load:

- On `[node.script]` startup, the patcher fires every `setParam` for the
  current `live.*` values to seed the host state.
- The host does NOT serialize its own state (register, RNG, drift). On
  preset load, register is rebuilt via `createRegister(length, rng)` from
  the persisted seed; drift state resets to neutral (`vel = gate = time = 0`).
- Trade-off: loading a preset mid-song restarts the TM loop from a fresh
  register draw rather than resuming an in-flight evolution. Acceptable —
  presets are loaded between sections, not during them.

For Live `Save Set`: the live.* values are sufficient for full restore. The
register and humanize drift are intentionally non-persisted (deterministic
from `(seed, length)` for register; ephemeral for drift).

## Open questions

These are flagged for follow-up rather than blocking:

- **Distribution form** — conditional on the chosen distribution
  channel's upload policy. If maxforlive.com (or whichever channel)
  accepts a zip containing both `.amxd` files, ship as a single bundle
  under one product identity (`Stencil`). Otherwise, ship as two separate
  listings (`Stencil TM` and `Stencil QT`). Resolves once the channel's
  upload form is verified; not implementation-blocking. Topology revisit
  (2 vs 1 device) was considered 2026-05-02 and 2 devices was reaffirmed:
  QT-alone (snap arbitrary upstream MIDI to scale) is a real standalone
  use case worth preserving, and brand fragmentation is mitigated by
  single-bundle distribution if available. Filename / package-name
  punctuation is hyphen (`Stencil-TM.amxd`, `@stencil/host-tm`); the
  user-facing display name keeps the space (`Stencil TM`).

Resolved:

- **QT root-mode control range** — separate `qt.controlChannel` parameter
  (`live.numbox int`, `1..16`, default `16`). When `qt.triggerMode = root`,
  events on `controlChannel` update `params.root` and are consumed by the
  root path; events on `inputChannel` follow the quantize path. Rationale:
  a note-range split on a single channel imposes a hidden boundary that
  breaks low-pitched input to the quantizer (bass / pad use); channel
  separation is explicit, matches Live's per-clip MIDI channel routing,
  and costs one numbox. Default `16` is chosen as a sentinel that pushes
  the user to set it deliberately when switching into root mode (rather
  than colliding with the typical melody track on ch1).
- **TM seed-mode interaction with `lock`** — full bypass (matches the
  current draft). When `triggerMode = seed`, MIDI input drives the
  register shift via `shiftAndForce` and `lock` is ignored; transport
  `step` becomes read-only (no additional shift, no flip). Rationale: the
  mode contract is "input is the shift driver, lock is irrelevant," which
  is testable as a function from input-event-stream to register state.
  The alternative (write-then-flip) makes the user's seed input subject to
  the same probabilistic flip `lock` controls — a `lock = 0.5` would
  scramble half of the seeded bits, defeating the point of seeding. Users
  who want `lock` to participate switch back to `auto`.
- **Patcher freeze pipeline** — port oedipa's
  `m4l/scripts/maxpat-to-amxd.mjs` with one change: parameterize the device
  name via argv (`node maxpat-to-amxd.mjs TM` / `... QT`) so each device
  bakes independently. Core logic (AMPF header splicing, JSON validation,
  `--check` mode) carries over verbatim. Rationale: `--check` should be
  able to fail per-device in CI, and a single device can be re-baked
  without touching the other.

## Scope

**In scope for this ADR:**
- Two-device topology decision and rationale
- File layout (engine + two host packages)
- Per-device patcher / host / engine layering
- Host ↔ Max protocol (incoming + outgoing messages)
- Canonical `live.*` parameter list with types, ranges, defaults
- MIDI I/O including `triggerMode` semantics
- QT humanize layer (in-host, post-snap)
- State persistence via Live preset chunks

**Out of scope (separate ADRs or deferred):**
- Engine semantics — see [ADR 001](001-engine-interface.md)
- VST architecture — separate ADR when target is picked up
- Preset / slot system (oedipa-style 4-slot bank with MIDI recall) — future
  ADR if/when implemented
- TM register-bit visualization GUI — separate ADR; will need its own logic-
  layer-vs-renderer split per CLAUDE.md §GUI components
- TM `gate` / `velocity` output modes, QT `chord` / `harmony` modes — see
  [concept.md §Future extensions](../concept.md#future-extensions)

## Reference implementation (TBD)

This ADR flips to *Implemented* once both devices ship as `.amxd` files
loadable in Live, all live.* parameters round-trip through preset chunks,
the MIDI I/O paths are tested manually in Live, and engine test vectors
(ADR 001) all pass via the host packages' test suites.

## Implementation checklist

### Scaffold restructure

- [ ] Rename `m4l/host/` → `m4l/host-tm/`; update `package.json` name to
      `@stencil/host-tm`
- [ ] Create `m4l/host-qt/` (copy structure from `host-tm/`); name
      `@stencil/host-qt`
- [ ] Update `m4l/pnpm-workspace.yaml` packages list
- [ ] `pnpm install` to refresh lockfile

### Build tooling

- [ ] Port `m4l/scripts/maxpat-to-amxd.mjs` from oedipa; replace hardcoded
      `Oedipa.*` paths with `Stencil-${argv[2]}.*` and validate `argv[2] ∈
      {TM, QT}`
- [ ] Wire `pnpm bake:tm` / `pnpm bake:qt` (and `bake:check:*`) at the
      workspace root

### Engine

- [ ] ADR 001 implementation checklist completes (turing.ts, quantizer.ts,
      test vectors)

### Stencil TM

- [x] `host-tm/host.ts` — `TmHostState`, step loop, `triggerMode` branches
- [ ] `host-tm/bridge.ts` — Max protocol parser, message dispatcher
- [ ] `host-tm/index.js` — n4m entry, dependency-injects `Max.outlet` into
      `Bridge`
- [x] `host-tm/*.test.ts` — host state machine tests (no `max-api`),
      including `triggerMode` matrix (20/20 pass under `pnpm -r test`)
- [ ] `Stencil-TM.maxpat` — UI, `live.*` objects, `[node.script]` wiring,
      MIDI in/out routing
- [ ] Bake `Stencil-TM.amxd`; load in Live; verify all `live.*` parameters
      visible and persistent

### Stencil QT

- [ ] `host-qt/host.ts` — `QtHostState`, event loop, `triggerMode` branches
- [ ] `host-qt/humanize.ts` — `draw`, `drift`, composition helpers; pure
      and tested
- [ ] `host-qt/bridge.ts`, `host-qt/index.js` — analogous to TM
- [ ] `host-qt/*.test.ts` — host + humanize tests; humanize draw order is
      asserted against fixed seed
- [ ] `Stencil-QT.maxpat` — UI, `live.*` objects, MIDI in/out
- [ ] Bake `Stencil-QT.amxd`; load in Live; chain `Stencil TM → Stencil QT`
      on a track and verify the canonical sound

### Verification

- [ ] All engine test vectors passing in both host packages
- [ ] Manual: TM standalone in Live, mode coverage (`auto`, `gate`, `seed`)
- [ ] Manual: QT standalone in Live, scale + humanize coverage
- [ ] Manual: TM → QT chain produces musically coherent scale-locked melody
- [ ] Manual: Live preset save/load round-trips all `live.*` parameters
- [ ] Manual: transport stop / start / scrub leaves no hung notes
- [ ] Flip ADR status to *Implemented*
