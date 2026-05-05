# ADR 003: m4l UI Design — Stencil TM / Stencil QT

## Status: Proposed

**Created**: 2026-05-02

This ADR specifies the UI for both m4l devices: device canvas size,
the boundary between live.* widgets and custom drawing (jsui), the two
custom widgets (TM register-bit ring, QT scale keyboard), the visual
identity carried over from inboil, the QT quantize-mode surface
(scale / chord / harmony) and how chord context is absorbed from MIDI
input, and the logic-layer / renderer split each jsui widget follows.

**Scope rule** (2026-05-04): Stencil tracks inboil-equivalent core
functionality. Extensions beyond inboil are allowed when they fit a DAW
MIDI-effect context (humanize layer, MIDI-driven root, input-channel
routing) but are gated by flags so the inboil baseline still works. No
"v1 / v2" phasing — anything inboil's Quantizer or TuringMachine does
that the user can name as a core musical capability ships, period. Items
that are deferred carry an explicit, defensible reason (e.g. requires
another device, see chord-source coupling via oedipa).

## Context

[ADR 002](002-m4l-architecture.md) defines the canonical `live.*` parameter
surface (12 controls for TM, 12 for QT) but leaves visual layout, custom
drawing, and visual identity unspecified. The shared origin
[inboil](https://github.com/im9/inboil) has a rich custom UI for both
units:

- `inboil/src/lib/components/TuringSheet.svelte` (508 lines) — radial bit
  ring, output history bar chart, revolver rotation animation,
  FREEZE / ROLL / TOGGLE controls, scale-snap preview, large value
  readout (current register fraction + pitch).
- `inboil/src/lib/components/QuantizerSheet.svelte` (569 lines) — scale
  preset selector, root + octave picker, mode toggle (scale / chord /
  harmony), one-octave piano keyboard with dot markers under in-scale
  notes, target / merge controls.

Visual identity (palette, typography, panel pattern) is recognizable and
load-bearing — it is the inboil family signature, not incidental skin.
Shipping Stencil m4l as twelve generic `live.*` widgets in rows would
not read as part of the family and would not communicate the iconic
register-as-ring metaphor. An earlier draft of this ADR proposed
`live.*`-only and was rejected on quality grounds (2026-05-02): the
register ring and scale keyboard are central enough to inboil's identity
that v1 must include them.

m4l constraints that still apply:

- Standard m4l canvas is one device-row tall (~130 px). Custom widgets
  fit, but layouts feel cramped. Doubled-height canvas (~260 px) is
  allowed and is what this ADR adopts.
- `live.*` widgets give automation, MIDI map, preset chunks, theming for
  free; jsui does not. Parameter controls remain `live.*`; jsui is
  reserved for visualization and direct-manipulation widgets.
- jsui is a non-trivial dev surface (separate event loop, state sync
  with the host, pixel rendering). The CLAUDE.md §GUI components rule
  applies: split each jsui widget into a pure logic layer (TS, tested
  via `node:test`) and a renderer (jsui glue, manually verified).

## Decision

### Canvas — wide format, oedipa-matched

Both devices use a wide-format m4l canvas: `devicewidth = 1000`,
presentation height ~180 px. This matches oedipa's empirically-vetted
m4l strip dimensions (max widget bottom = 180 in oedipa's
`Oedipa.maxpat`). 180 is at the ceiling of what Live renders cleanly —
treat it as a hard upper bound, not a target to grow into.

A square or near-square canvas (e.g. 320 × 260) was considered and
rejected: it wastes horizontal space, makes parameter columns cramped,
and breaks the m4l idiom (devices are wide strips, not panels).

### Widget mix

- **`live.*` widgets** for all parameter controls (the 12 entries per
  device per ADR 002). Layout in 1–2 parameter rows below the central
  custom widget.
- **One jsui widget per device** for visualization + direct manipulation:
  - **TM**: register-bit ring (clickable, see §TM register ring)
  - **QT**: scale keyboard (pulse-animated, see §QT scale keyboard)

### Visual identity (inboil-derived)

The following carry over from inboil and apply to both devices.

**Color palette** — sampled directly from
[inboil's `src/app.css`](~/src/front/inboil/src/app.css):

| Token              | Hex       | RGB           | Role                               |
|--------------------|-----------|---------------|------------------------------------|
| `color.bg`         | `#EDE8DC` | 237, 232, 220 | warm cream — device background     |
| `color.fg`         | `#1E2028` | 30, 32, 40    | dark navy — primary text           |
| `color.olive`      | `#787845` | 120, 120, 69  | olive — active fill, group legends |
| `color.salmon`     | `#E8A090` | 232, 160, 144 | salmon — read-head, key pulse      |
| `color.borderFaint`| navy@10%  | 30,32,40 / .10| panel borders                      |
| `color.outline`    | olive@35% | 120,120,69/.35| inactive bit-dot stroke            |

(Inboil uses `--color-blue` `#4472B4` for its global playhead. Stencil
deliberately omits blue: the m4l device has no separate playhead concept
— transport sync is implicit from Live's clock — so the salmon read-head
on the bit ring is the single eye-catcher accent.)

**Typography** — monospace, uppercase parameter labels. Inboil ships
JetBrains Mono / Fira Code as `--font-data`; Max ships `Andale Mono`
which is the closest pre-installed equivalent and what we use as the
patcher's `default_fontname`. Sizes mirror inboil's `--fs-*` scale:
`fs-sm 9px` for parameter labels, `fs-min 8px` for group legends.

**Panel pattern** — thin-bordered groups (`color.borderFaint`) with a
corner label tab matching inboil's fieldset-with-legend pattern.
Implemented in Max as a `panel` (border) + small `comment` (label) +
a same-`color.bg` panel cap behind the label so the label punches a
gap in the border (the visual fieldset effect).

**Device chrome** — the device name (`Stencil-TM` / `Stencil-QT`) is
shown by Live's own device-strip header. We do NOT add a duplicate
`STENCIL TM`-style banner inside the presentation strip, and no `im9`
byline — Live shows both the device name and author in its own
metadata; in-strip duplicates clutter at small sizes. The three
column-group legends (`GENERATE` / `REGISTER` / `I/O`) are sufficient
in-strip identification of which Stencil device this is.

**Per-control idiom** — per-device, not per-param:
- **TM** uses `live.slider` horizontal for floats (lock, density, gate)
  — matches inboil's `.ctl-slider` row layout (label · slider · value)
  and TM's params each occupy a dedicated row.
- **QT** uses `live.dial` knobs for ALL floats (humanize vel/gate/time/
  drift + outputLevel) — sliders eat too much vertical space when
  stacked, and a horizontal slider's `parameter_shortname` rendering
  overlays the value digits in the narrow strip width Stencil ships
  (observed 2026-05-04 in Live: "Lvl" text covered the value display).
  Knob row is also the conventional idiom for humanize / randomize
  parameter clusters in DAW devices. The dial's built-in shortname
  overlay (above the arc) doubles as the user-facing label, so
  knob params do NOT carry an adjacent comment-label box (one label
  per value, not two).
- ints use `live.numbox`
- enums use `live.menu`

(ADR 002's parameter table says `live.dial float` for floats — that
spec captures *parameter type*, not the visual widget. Both `live.dial`
and `live.slider` expose the same float parameter to Live; the choice
is presentational. Stencil picks `live.slider` for inboil parity. See
ADR 002 §live.* parameter surface.)

### TM register ring (jsui)

`m4l/host-tm/ui/registerRing.{logic,jsui}.ts/.js`.

**Visual:** ring of `length` dots arranged radially around the device's
vertical centerline. Active bits filled with `color.activeFill`. The
current read-head dot drawn in `color.activeHighlight` (one dot ahead of
the dot whose bit was last read out as note-output). Inactive dots are
outlined in `color.outline`.

**Animation:** on each step, the read-head highlight advances by one
position. v1 advances **discretely** (snap to the next dot per step).
The full *revolver rotation* (continuous spin of the whole ring across
multiple steps, as in inboil) is **out of v1** — it costs animation
plumbing for marginal musical value.

**Interaction (clickable):** clicking a bit dot toggles that bit's
value at that index in the host's register and re-emits any note-output
that depends on the bit. This requires a new Max → host protocol
message (`setBit <index> <value>`), specified in ADR 002.

The click does NOT route through `triggerMode = seed`. `seed` mode is
about MIDI-driven shift-and-force at the head; click is direct random
access at any index. Both can coexist (a user in `auto` or `gate`
triggerMode can still click bits to nudge the loop).

**Logic layer (pure TS, tested):**
```
type RingModel = {
  bits: number[]      // 0/1, length = ADR 002 tm.length
  readHead: int       // 0..length-1
  hovered: int | -1   // mouse hover, for UI feedback
}
hitTest(x, y, geometry: RingGeometry): int | -1
toggleBitAt(model, index): RingModel
advanceReadHead(model): RingModel
```

**Renderer (jsui glue):**
- Reads `RingModel` + `RingGeometry`.
- Listens for Max messages: `register <bits...>`, `position <n>`.
- Emits Max messages on click: `setBit <index> <value>`.
- Drawing only — no business logic. Manually verified.

### QT scale keyboard (jsui)

`m4l/host-qt/ui/scaleKeyboard.{logic,jsui}.ts/.js`.

**Visual:** one-octave (12-key) piano keyboard, layout matches inboil
(black keys raised, white keys flat). Each in-scale key carries a small
dot drawn **inside** the key near its bottom edge — `color.activeFill`
on white keys, `color.bg` (cream) on black keys for legibility against
the near-black fill. Out-of-scale keys carry no dot. Because black keys
are shorter (`BLACK_KEY_HEIGHT_RATIO`), black-key dots automatically
sit higher on the canvas than white-key dots, giving a two-row visual
that separates black-vs-white in-scale membership without an explicit
divider. (Reference: inboil `QuantizerSheet.svelte` — same in-key-dot
+ no-out-of-scale-dot pattern, ported by visual rule rather than code.)

**Pulse animation:** when the host emits a `noteOut` event (a quantized
note leaving the device), the corresponding key glows briefly in
`color.activeHighlight` and decays back over ~250 ms. Pulses stack
visually (the most recent dominates).

**Interaction (click-to-set-root):** clicking any key on the keyboard
sets `qt.root` to that key's pitch class. The jsui hit-tests the click
against current key bounds and emits `setRoot <pc>` on its outlet; the
patcher routes that into the `qt.root` `live.menu` so Live's parameter
state stays the single source of truth (the live.menu's `parameter`
change fires the existing `[prepend setParam root] -> [node.script]`
chain, which updates the host and re-emits `scaleChanged` for the
keyboard). This matches inboil's `tapKey` UX
([QuantizerSheet.svelte:165-167](../../front/inboil/src/lib/components/QuantizerSheet.svelte#L165-L167)):
the keyboard isn't decoration, it's a root selector.

ROOT can also be set by:
- The `qt.root` `live.menu` directly (note-name dropdown C..B, see
  §SCALE / I/O column).
- MIDI on `qt.controlChannel` when `qt.triggerMode = root`
  (single-note → root). All three paths converge on `setParam root <pc>`
  through the same bridge handler, so the keyboard, the menu, and the
  MIDI control stay in sync via the existing `scaleChanged` re-emit.

Click-to-edit-**scale** (selecting which pitch classes are in the
scale by toggling individual key dots, like inboil's chord-mode chord
edit) is **out of scope**: scale is a preset name (`qt.scale` enum),
not a free-form pitch-class set, so per-key toggling has no parameter
to land in.

**Logic layer (pure TS, tested):**
```
type KeyboardModel = {
  inScale: boolean[12]    // pitch class -> in scale
  pulses: Pulse[]         // active glows, decaying
}
type Pulse = { pitchClass: int, intensity: float, ageMs: float }
updatePulses(model, dtMs): KeyboardModel    // decay all pulses
addPulse(model, pitchClass, velocity): KeyboardModel
recomputeInScale(scale, root): boolean[12]
```

**Renderer (jsui glue):**
- Reads `KeyboardModel` + key geometry.
- Listens for Max messages: `scaleChanged <name> <root>`,
  `notePulse <pitch> <velocity>` (added in ADR 002).
- Drawing only — no business logic.

### QT quantize mode (scale / chord / harmony)

Inboil's quantizer has 3 substantively different modes
([generative.ts:257-360](../../front/inboil/src/lib/generative.ts#L257-L360)):

- **scale** — snap each input note to nearest scale degree.
- **chord** — snap to chord-tone within 2 semitones, scale fallback
  outside that. Chord context comes from a step-indexed `chords[]`
  array OR from a referenced Tonnetz node's chord walk
  (`chordSource: { nodeId }`).
- **harmony** — input 1 note → output 1 input + N parallel diatonic
  voices (`harmonyVoices[]`, max 3, each `interval + 'above' | 'below'`).

Stencil-QT ships all three. Mode is exposed as `qt.mode`
(`live.menu`, 3-enum: `scale | chord | harmony`).

**Chord context — system-level absorption from MIDI:**

inboil's offline `chords[]` (step-indexed manual progression) and
`chordSource` (Tonnetz coupling) are both replaced by a single
real-time mechanism: when `qt.mode = chord`, the held notes on
`qt.controlChannel` form the **current chord context**. Each `noteIn`
on controlChannel adds the pitch class to the held set; each `noteOff`
removes it. Both inboil paths land naturally on this:

- inboil's manual `chords[]` ↔ playing the chord progression on a Live
  MIDI clip routed to controlChannel.
- inboil's `chordSource` (Tonnetz coupling) ↔ routing oedipa's MIDI
  output to controlChannel — oedipa is the m4l-equivalent of inboil's
  Tonnetz node, so cross-device chord coupling falls out of the
  generic "any chord on controlChannel" route. No special data field
  in `QtParams`, no per-step assignment UI.

This collapses the two inboil chord-context sources into one MIDI
input contract that any chord generator (clip, oedipa, manually
played) can drive.

**Interaction with `triggerMode = root`:** `qt.triggerMode` and
`qt.mode` together decide what controlChannel input means.

| `qt.mode` | `qt.triggerMode` | controlChannel behaviour |
|-----------|------------------|--------------------------|
| `scale`   | `passthrough`    | ignored (channel filter passes only) |
| `scale`   | `root`           | single note → set `qt.root` (legacy) |
| `harmony` | `passthrough`    | ignored |
| `harmony` | `root`           | single note → set `qt.root` |
| `chord`   | any              | held notes → chord context (overrides root behaviour) |

When `mode = chord`, controlChannel is dedicated to chord context;
`triggerMode = root` is suppressed for that channel because the same
notes can't be both "single = root" and "held = chord context"
unambiguously. The user sets root via the menu or keyboard click in
chord mode.

**Engine logic spec:**

```
type QuantizeMode = 'scale' | 'chord' | 'harmony'

type HarmonyVoice = {
  interval: 3 | 4 | 5 | 6  // diatonic 3rd/4th/5th/6th
  direction: 'above' | 'below'
}

interface QtParams {
  // ... existing ...
  mode: QuantizeMode
  harmonyVoices: HarmonyVoice[]   // length 0..3
}

interface QtHostState {
  // ... existing ...
  chordContext: number[]  // pitch classes currently held on controlChannel
}

quantizeIn(pitch, velocity, channel, mode, scalePcs, chordContext, voices):
  if mode === 'chord' && chordContext.length > 0:
    snapped = snapToChordTones(pitch, chordContext) within 2 semitones,
                else scale fallback
  else:
    snapped = snapToNearest(pitch, scalePcs)

  outputs = [snapped]

  if mode === 'harmony':
    for v in voices:
      outputs.push(diatonicShift(snapped, v.interval, v.direction, scalePcs))

  return outputs
```

The engine helpers `snapToNearest`, `snapToChordTones`,
`diatonicShift` are pure functions, mirrored test-side from inboil's
`generative.ts`. Lives in `m4l/engine/quantizer.ts` (already exists for
scale; chord/harmony helpers added).

**Out of scope (with reason):**

- **Step-indexed chord progression** (`chords[]` in inboil) — replaced
  by real-time controlChannel input (clips or live playing).
- **Tonnetz chord coupling field** (`chordSource` in inboil) — replaced
  by routing oedipa's output to controlChannel; no in-device field
  needed.

### What is intentionally out of scope

Each item below names the inboil feature being skipped and the
defensible reason. "User hasn't asked yet" is **not** acceptable; this
list is small on purpose.

- **Output history bar chart** (TM bottom histogram in inboil) —
  informative but takes vertical space; the m4l strip is 180 px max
  and the bit ring already occupies the central column. Reason:
  spatial budget.
- **Revolver continuous rotation animation** — bit ring snaps to the
  next dot per step rather than spinning. Reason: animation plumbing
  cost vs marginal musical value; revisit if a user complains about
  legibility at fast subdivisions.
- **Scale-snap preview overlay** (showing which scale degree TM's
  chromatic output will snap to when chained through QT) — requires
  cross-device awareness across two patchers. Reason: would need a
  TM↔QT shared-state channel that doesn't exist yet.
- **FREEZE / ROLL custom buttons** — `lock = 1` is a `live.dial` value
  the user can MIDI-map; `roll` (new seed) is a `live.numbox` increment.
  Reason: feature is reachable through existing widgets.
- **Per-bit drag-paint on the ring** — single-click toggle is the
  spec; hold-and-sweep is open in §Open questions (ships with v1 if
  trivially mergeable into the click handler).

### Layout sketch — Stencil TM (1000 × 180)

Three vertical columns, header band on top:

```
┌─── STENCIL TM ───────────────────────────────────────── im9 ───┐ ~16h
│ ┌─ GENERATE ────┐ ┌─ REGISTER ──────────┐ ┌─ I/O ───────────┐ │
│ │ LEN  [16] bit │ │                     │ │ TRG  [auto    ] │ │
│ │ LOCK ●━━─     │ │      ◌ ● ●          │ │ IN   [0       ] │ │
│ │ DENS ●━━━     │ │   ◌         ●       │ │ VEL  [100     ] │ │
│ │ LO   [48]     │ │  ●           ◌      │ │ GATE ●━━─       │ │
│ │ HI   [72]     │ │  ●           ●      │ │ OUT  [1       ] │ │
│ │ SUBD [16th]   │ │   ◌         ◌       │ │ SEED [42      ] │ │
│ │                │ │      ◌ ● ◌          │ │                  │ │
│ └───────────────┘ └─────────────────────┘ └─────────────────┘ │
└────────────────────────────────────────────────────────────────┘
  ~280w              ~280w                  ~280w
  6 live.* widgets   1 jsui (registerRing)  6 live.* widgets
```

Column allocation:
- **GENERATE** (left, ~280w): length, lock, density, range.lo, range.hi,
  subdivision — all parameters that shape *what* TM emits.
- **REGISTER** (center, ~280w, jsui): the bit ring. Diameter ~150 fits
  in available height ~140 (header subtracted) with padding.
- **I/O** (right, ~280w): triggerMode, inputChannel, outputVelocity,
  outputGate, outputChannel, seed — input handling + output shaping.

Active bit = `●` (`color.activeFill`), read-head = highlighted dot
(`color.activeHighlight`), inactive = `◌` (`color.outline`).

### Layout sketch — Stencil QT (1000 × 180)

Right column splits into two stacked panels (VOICES on top, HUMAN
below) so the harmony voicing configuration is visually separated
from humanize/seed parameters — they are different musical concepts.

```
┌─── STENCIL QT ──────────────────────────────────────────────────┐
│ ┌─ SCALE / I/O ─────┐ ┌─ KEYBOARD ────────────┐ ┌─ VOICES ─────┐│
│ │ SCL [major     ] │ │ ┌─┐┌─┐  ┌─┐┌─┐┌─┐       │ │[V1▼][V2▼][V3▼]│
│ │ ROOT [C ] IN[0] │ │ │ ││  │ ││ ││ │       │ └──────────────┘│
│ │ TRG [psthru ] CTL[16]│ │ ├─┴┴─┴┬─┴─┴┴─┴┴─┴─┴─┐  │ ┌─ HUMAN ──────┐│
│ │ MODE [scale   ] │ │ │•│ │•│ │•│•│ │•│ │•│   │ │ ◌  ◌  ◌  ◌   ││
│ │     ◌            │ │ │C│D│E│F│G│A│B│ │ │ │   │ │ V  G  T  D   ││
│ │     LVL          │ │ └─┴─┴─┴─┴─┴─┴─┴─┴─┴─┘   │ │ SEED [42]    ││
│ │                   │ │                          │ │              ││
│ └──────────────────┘ └─────────────────────────┘ └──────────────┘│
└────────────────────────────────────────────────────────────────┘
  ~280w                  ~440w                       ~248w
  7 live.* widgets       1 jsui (scaleKeyboard)      VOICES: 3 widgets
                                                     HUMAN: 5 widgets
```

Column allocation:
- **SCALE / I/O** (left, ~280w): scale, root, mode, triggerMode,
  inputChannel, controlChannel, outputLevel. ROOT (note-name menu)
  and IN share a row; MODE owns its row (3-enum, the row Max's
  enum-display rendering needs ≥ 2 enum elements to work — chord and
  harmony bring it to 3 so this is no longer a deferred slot). TRG +
  CTL share a row (TRG governs whether CTL routes to root, chord
  context, or is ignored — see §QT quantize mode table). LVL knob
  owns its own line at the bottom of the column.
- **KEYBOARD** (center, ~440w): the one-octave (12-key) piano with
  in-scale dots, pulse animation, and click-to-set-root hit-testing.
  The keyboard is **octave-invariant**: it draws a single octave
  (C–B) as the pitch-class legend; pulses fire by pitch class
  regardless of which MIDI octave the outgoing note lands in.
  Ableton/MIDI exposes the full 0..127 range — Stencil QT does not
  constrain output to a 3–5 oct band the way inboil's reference UI
  did. (inboil's `octaveRange[3..5]` was an inboil-specific display
  constraint, not a musical decision; not ported.)
- **Right column (split)** — two stacked panels with their own
  borders and legends:
  - **VOICES** (top, ~248w × 80h): the harmony voice cluster.
    **6 live.menu widgets** in 3 rows × 2 columns, matching inboil's
    QuantizerSheet two-select-per-voice badge
    ([QuantizerSheet.svelte:341-353](../../front/inboil/src/lib/components/QuantizerSheet.svelte#L341-L353)).
    Per row (one row per voice slot): an Interval menu
    (`["3rd", "4th", "5th", "6th"]`, inboil display strings) and
    a Direction menu (`["off", "above", "below"]`). inboil uses
    dynamic add/remove (`+` button + per-voice `×` button, max
    3 voices); m4l can't create widgets dynamically (live.* must
    be statically declared for preset round-trip), so the
    direction enum adds `"off"` as the disabled state — the
    static-3-slot translation of inboil's add/remove model.
    Bridge maps interval string → int 3..6 (`INTERVAL_FROM_STRING`)
    and validates direction against the 3-enum; slots set to "off"
    are filtered out of the projected `harmonyVoices` list.
  - **HUMAN** (bottom, ~248w × 100h): humanizeVelocity, humanizeGate,
    humanizeTiming, humanizeDrift, seed. Compressed (legend → dial
    gap = 6px, dial → SEED gap = 6px) to make room for VOICES above
    while keeping dial knob heights at 52px.
  Why split the right column instead of co-locating VOICES with the
  keyboard or scale config: harmony voicing has no musical relation
  to keyboard visualization, and SCALE / I/O is full. Two stacked
  panels in the right column give VOICES its own visual category
  separate from HUMAN — they should not read as a sub-section of
  humanize.

In-scale key carries a dot inside (`•`); out-of-scale keys carry no
dot. Active key during pulse glows in `color.activeHighlight`.

Both layouts are sketches — exact pixel widths, label sizes, and the
precise vertical placement of each `live.*` are decided at patcher build
time against Live's actual rendering. The sketches commit the *column
structure, grouping, and ordering*, not pixel precision.

### Ready handshake (TM and QT)

Both patchers need to push their initial `live.*` parameter values into
the host bridge on device load — but `[node.script]` boots
asynchronously and any `setParam` dispatched before its `addHandler`s
are registered drops silently with `Node script not ready`. The fix is
a one-shot handshake:

1. The entry script (`stencil-{tm,qt}.mjs`) emits
   `Max.outlet("ready", 1)` **after** every `Max.addHandler()` call.
   Emitting from the bridge constructor is wrong — handlers are added
   later in the same tick, and the patcher would race them.
2. The patcher routes that outlet via `[route … ready …]` into a
   `[t b]` that bangs each `live.*` widget. The bang causes the widget
   to re-emit its current value through outlet 0, and the existing
   `[prepend setParam <key>] → [node.script]` chain carries it.

Banging the widget directly is the alternative to the `getvalueof`
message: empirically `getvalueof` only works for `live.toggle` —
`live.numbox`, `live.slider`, and `live.menu` ignore it. Bang on the
inlet is the universal trigger that re-emits the current value across
all four widget types. (Pattern lifted from oedipa: see
`Oedipa.maxpat` `obj-trig-hostready` and `oedipa-host.entry.mjs`'s
`Max.outlet('hostReady', 1)` at end-of-script.)

Both `Stencil-TM.maxpat` and `Stencil-QT.maxpat` MUST follow this
pattern. `m4l/scripts/patcher.test.mjs` carries a `TM — node.script
"ready" outlet bangs each live.* widget` assertion that catches drift
at test time; the QT patcher work should add the analogous QT
assertion so a missing patchline fails the suite rather than dropping
silently in Live.

## Logic-layer-vs-renderer compliance

Per CLAUDE.md §GUI components, both jsui widgets follow the split:

- **Logic layer**: pure TypeScript, exported, runs in Node, tested via
  `node:test`. Lives at:
  - `m4l/host-tm/ui/registerRing.logic.ts`
  - `m4l/host-tm/ui/registerRing.logic.test.ts`
  - `m4l/host-qt/ui/scaleKeyboard.logic.ts`
  - `m4l/host-qt/ui/scaleKeyboard.logic.test.ts`
- **Renderer**: jsui-specific drawing + event glue. Lives at:
  - `m4l/registerRing.jsui.js` (loaded by `[jsui]` in patcher; flat path
    per ADR 004 §Patcher path conventions — Max [jsui] does not reliably
    resolve subdirectory paths in M4L presentation view)
  - `m4l/host-qt/ui/scaleKeyboard.jsui.js`
- Renderer reads logic state and draws. No business logic in renderer.
  Manually verified in Live; not unit-tested.

The logic layer also exposes geometry helpers (ring center / radius,
key-bounds rectangles) so hit-testing logic stays in TS and is tested.
The renderer queries geometry to decide where to draw.

## Implementation checklist

### TM register ring

- [x] `host-tm/ui/registerRing.logic.ts` — pure types and functions:
      `RingModel`, `RingGeometry`, `hitTest`, `toggleBitAt`,
      `advanceReadHead`
- [x] `host-tm/ui/registerRing.logic.test.ts` — `node:test`:
      hit-test boundary cases, toggle determinism, read-head advance
- [x] `registerRing.jsui.js` (m4l/ root, flat path) — renderer + Max event glue:
      `register` / `position` inlets, `setBit` outlet on click

### QT scale keyboard

- [x] `host-qt/ui/scaleKeyboard.logic.ts` — `KeyboardModel`, `Pulse`,
      `updatePulses`, `addPulse`, `recomputeInScale`
- [x] `host-qt/ui/scaleKeyboard.logic.test.ts` — pulse decay math,
      in-scale recompute for all 15 scales, multi-pulse stacking
- [x] `host-qt/ui/scaleKeyboard.jsui.js` — renderer:
      `scaleChanged` / `notePulse` inlets
- [x] `host-qt/ui/scaleKeyboard.logic.ts` — `hitTest(x, y, geometry)`
      returning the pitch class clicked or `-1`. Mirrors inboil
      `tapKey` semantics (any click anywhere on a key surface counts)
- [x] `host-qt/ui/scaleKeyboard.logic.test.ts` — `hitTest` boundary
      cases (between keys, on black-key overlap, outside canvas)
- [x] `host-qt/ui/scaleKeyboard.jsui.js` — `onclick` reads pointer,
      calls `hitTest`, emits `setRoot <pc>` outlet on hit

### QT quantize mode + chord/harmony engine

- [x] `m4l/engine/quantizer.ts` — chord/harmony helpers:
      `snapToChordTones(pitch, chordPcs, scalePcs, semitoneTolerance=2)`,
      `diatonicShift(pitch, interval, direction, scalePcs)`,
      mirroring inboil `generative.ts:200-254` semantics. Pure
      functions, ASCII-only.
- [ ] `m4l/engine/quantizer.test.ts` — vectors for each helper
      across the 14 scale/root combinations sourced from inboil's
      reference outputs (regression discipline)
- [x] `m4l/host-qt/host.ts` — extend `QtParams` with `mode`,
      `harmonyVoices`. Track `chordContext: number[]` (PCs) on
      controlChannel held notes. Route `noteIn(pitch, vel, channel)`
      through chord/harmony quantize when `mode != scale`. `noteOff`
      removes from chordContext. `panic` and `transportStop` clear
      it.
- [x] `m4l/host-qt/host.test.ts` — chord-mode in/out vectors,
      harmony-mode in/out vectors, controlChannel held-set
      build/release across `noteIn` / `noteOff` / `panic`
- [x] `m4l/host-qt/bridge.ts` — `setParam mode <name>` validates
      against the 3-enum, `setParam harmonyV{1,2,3} <symbol>` accepts
      the combined-string form `off | {3..6}{up|dn}` from the patcher
      menu, parses via `parseHarmonyVoiceValue`, and projects the
      3-slot state to host `harmonyVoices` (length-flattened).
      Emits `chordChanged <pcs...>` outlet so the keyboard can
      highlight held PCs (see §QT scale keyboard interaction).

### Stencil-TM patcher (`Stencil-TM.maxpat`)

- [x] `devicewidth = 1000`, presentation height ~180 (oedipa-matched)
- [x] No in-strip header banner (Live's device-strip already labels
      the device; no `im9` byline; no accent band)
- [x] Three column groups (`GENERATE` / `REGISTER` / `I/O`) with
      `color.borderFaint` panels and floating mono legends
- [x] `[jsui]` instance loading `registerRing.jsui.js` (flat path)
- [x] All 12 `live.*` widgets per ADR 002 §live.* parameter surface (TM)
- [x] `live.*` long-name / short-name set; range / increment per ADR 002
- [x] `live.*` initial values match defaults
- [x] `[node.script stencil-tm.mjs]` instance present (flat path; Max
      [node.script] does not reliably resolve subdirectory filenames in
      M4L — see ADR 004 §Patcher path conventions)
- [x] `[transport]` driving `step` messages
- [x] `[midiin]` → channel filter → `noteIn` / `noteOff` routing
- [x] `Max.outlet` → `[noteout]` for outgoing notes
- [x] Each `live.*` change fires `setParam` to the host
- [x] `register` / `position` outlets routed from `[node.script]` to
      `[jsui]` for ring updates
- [x] `[jsui]` `setBit` outlet routed to `[node.script]` setBit handler
- [x] Palette tokens applied to panel objects, comments, group legends
      (live.* widgets pick up Live's automation-track color theming;
      explicit per-widget palette overrides only where Max exposes them)
- [x] Monospace font (`Andale Mono`) + uppercase labels
- [x] Initial `live.*` parameter values reach the host bridge after
      `[node.script]` is ready (`stencil-tm.mjs` emits `Max.outlet('ready')`
      after all `addHandler` installs; patcher's `[route ... ready ...]`
      outlet 1 → `[t b]` → bangs each of the 12 live.* widgets so they
      re-emit current value through the existing prep → nodescript chain.
      Bang on widget inlet is the alternative to `getvalueof` for
      live.numbox / live.slider / live.menu — pattern lifted from oedipa)

### Stencil-QT patcher (`Stencil-QT.maxpat`)

- [x] `devicewidth = 1000`, presentation height ~180 (oedipa-matched)
- [x] No in-strip header banner (Live's device-strip already labels the
      device; no `im9` byline; no accent band — same rule as TM)
- [x] Three column groups (`SCALE / I/O` / `KEYBOARD` / `HUMAN`) with
      `color.borderFaint` panels and floating mono legends
- [x] `[jsui]` instance loading `scaleKeyboard.jsui.js` (m4l/ root,
      flat path; logic + tests stay under `host-qt/ui/`)
- [x] All `live.*` widgets per ADR 002 §live.* parameter surface (QT)
      — currently 11; 12th is `qt.mode` (3-enum scale/chord/harmony)
- [x] `qt.mode` `live.menu` (3-enum: scale | chord | harmony) wired to
      `setParam mode <name>` via the standard `[sel] -> [message]`
      fanout (same pattern as `qt.scale`)
- [x] `qt.root` is a `live.menu` (note-name enum: C, C#, D, D#, E, F,
      F#, G, G#, A, A#, B) emitting the int index 0..11 directly into
      `[prepend setParam root]`. Note: this is a `live.menu` whose
      bridge-side payload is the int index (no `[sel]` fanout
      needed — bridge accepts int for `root`), distinct from the
      string-emitting menus for `qt.scale` / `qt.triggerMode` /
      `qt.mode`.
- [x] Harmony voices widget cluster: **6 live.menu widgets** in a
      dedicated **VOICES panel** (own border + legend), placed above
      a compressed HUMAN panel in the right column. 3 rows × 2
      menus per row, matching inboil's QuantizerSheet
      two-select-per-voice badge. Per slot:
      `parameter_longname` = `StencilQtHarmonyV{1,2,3}{Interval,Direction}`,
      `parameter_shortname` = `V{1,2,3}{Iv,Dr}`. Interval enum =
      `["3rd","4th","5th","6th"]` (inboil display strings),
      Direction enum = `["off","above","below"]` ("off" added as
      m4l-only disabled state replacing inboil's add/remove model).
      Bridge maps interval string → int via `INTERVAL_FROM_STRING`,
      validates direction against the 3-enum; slots set to "off"
      are filtered out of the projected `harmonyVoices: HarmonyVoice[]`.
      VOICES has its own panel border (not nested inside HUMAN)
      because voicing and humanize are different musical categories
      — sharing a panel reads as "humanize's voices" sub-section,
      which is wrong.
- [x] `[jsui]` `setRoot` outlet routed into the `qt.root` `live.menu`
      inlet (so a keyboard click updates the menu, which then fires
      `setParam root` through the existing chain)
- [x] `chordChanged` outlet routed from `[node.script]` to `[jsui]`
      so the keyboard can highlight currently-held chord PCs (rendered
      with a third tier between in-scale dot and pulse glow)
- [x] `live.*` long-name / short-name; range / increment / defaults
- [x] `live.*` initial values match defaults
- [x] `[node.script stencil-qt.mjs]` instance (flat path, `.mjs` —
      same filename-resolution + ESM-tempdir constraints as TM; see
      ADR 004 §Patcher path conventions)
- [x] `[midiin]` → input/control channel split → `noteIn` (quantize path)
      and `setParam root` (control path) per `triggerMode` (patcher
      forwards every parsed note to `noteIn`; the channel split + root
      mode are decided in the bridge against `triggerMode` /
      `controlChannel` per ADR 002)
- [x] `Max.outlet` → `[noteout]` for outgoing notes
- [x] Each `live.*` change fires `setParam` to the host
- [x] `scaleChanged` / `notePulse` outlets routed to `[jsui]`
- [x] Palette tokens applied to panel objects, comments, group legends
- [x] Monospace font (`Andale Mono`) + uppercase labels
- [x] Initial `live.*` parameter values reach the host bridge after
      `[node.script]` is ready (`stencil-qt.mjs` emits `Max.outlet('ready')`
      after all `addHandler` installs; patcher's `[route ... ready ...]`
      outlet → `[t b]` → bangs each of the 12 live.* widgets so they
      re-emit current value through the existing prep → nodescript chain.
      Same handshake as TM; `QtBridge` constructor MUST NOT emit `ready`)

### Visual identity

- [x] Sample exact hex values from inboil reference; recorded inline in
      §Visual identity above (sourced from `inboil src/app.css`)
- [x] Pick monospace font available in Max; recorded as `Andale Mono`
- [x] Brand accent color: `color.salmon #E8A090` (used on TM read-head
      and QT key pulse — single accent, consistent across devices)
- [ ] Capture fresh screenshots of `Stencil-TM.amxd` and
      `Stencil-QT.amxd` in Live; commit to `docs/ai/ui/` and embed in
      this ADR's §Visual identity

### Verification (manual, in Live)

- [ ] Each `live.*` parameter visible in Live's Device parameter list
- [ ] Each `live.*` parameter responds to MIDI map (Cmd-M) and automation
- [ ] Saving a Live set, closing, reopening preserves every parameter
      value on both devices
- [ ] Right-click → "Show in Browser" / preset save round-trips values
- [ ] At Live 100% UI scale, both devices render within the 1000×180
      presentation strip without truncation or scrollbars
- [ ] At Live 150% UI scale, no widget label or jsui content is clipped
      (or document that 150% is out of v1 scope if Max can't handle it)
- [ ] In Live's Light theme, the inboil palette reads correctly
- [ ] In Live's Dark theme, the inboil palette remains readable (or
      decision recorded that v1 ships Light-theme-tuned and Dark is v2)
- [ ] TM bit ring: clickable interaction works, read-head advances on
      transport, register change reflects in jsui within one step
- [ ] QT scale keyboard: in-scale dots correct, pulse animation visible
      and decays, multi-pulse stacks readable
- [x] QT keyboard click: clicking any key sets `qt.root` to that PC,
      `qt.root` `live.menu` reflects the change, in-scale dot pattern
      shifts immediately
- [ ] QT mode = scale: input quantized to scale-snap (existing path),
      no chord context, no harmony voicing
- [ ] QT mode = chord: held notes on `qt.controlChannel` form chord
      context (visible on keyboard as a third highlight tier between
      in-scale and pulse), input notes snap to chord tones with scale
      fallback. Releasing all controlChannel notes clears context.
- [ ] QT mode = harmony: each input note produces input + N voiced
      notes per `harmonyVoices[]`. Empty `harmonyVoices` reverts to
      scale-snap behaviour.
- [ ] QT controlChannel: in `mode = chord`, controlChannel notes are
      consumed (do NOT appear in noteOut). In `mode = scale | harmony`
      with `triggerMode = root`, controlChannel single notes set root
      and are also consumed.

## Open questions

- **Light vs Dark theme tuning** — inboil's palette is light-theme
  native. Whether to (a) ship light-only v1 and document Dark as v2,
  (b) supply two palette variants tuned per theme, or (c) pick a
  theme-agnostic compromise. Resolve at patcher build time when the
  palette is sampled and tested in both themes.
- **jsui font availability** — Max's jsui has its own font stack;
  verify the chosen monospace renders identically in jsui (bit ring
  labels, key labels) and in `live.*` widgets. If divergence is
  unavoidable, document the per-region font choice.
- **Click-vs-drag on the bit ring** — v1 spec is single-click toggles
  one bit. Drag-to-paint (hold-and-sweep across multiple bits) is a
  natural extension. Resolve during jsui implementation; if drag is
  trivial to add it goes in v1, otherwise v2.
- **Pulse decay duration** — 250 ms is a placeholder. Pick by ear when
  the keyboard is implemented; record the chosen value here once
  picked.

## Out of scope

Each item carries an explicit reason. "Deferred" without justification
is not allowed (no v1/v2 phasing — see §Context Scope rule).

- **Output history bar chart (TM)** — eats vertical space, the strip
  is at the 180 px ceiling, the bit ring already occupies the central
  column. Spatial budget.
- **Revolver continuous rotation animation** — animation plumbing
  cost vs marginal musical value; the bit ring snaps to the next dot
  per step rather than spinning. Revisit only if a user complains
  about legibility at fast subdivisions.
- **Scale-snap preview overlay** — would need a TM↔QT shared-state
  channel that doesn't exist between two patchers. Architecturally
  blocked, not deferred.
- **FREEZE / ROLL custom buttons** — `lock = 1` and seed bump are
  reachable via existing `live.dial` / `live.numbox` widgets; custom
  buttons would be redundant.
- **Click-to-edit-scale on QT keyboard** — `qt.scale` is an enum of
  preset names, not a free pitch-class set; per-key toggling has no
  parameter to land in. (Click-to-set-**root** is in scope and ships
  per §QT scale keyboard.)
- **Drag-paint on the bit ring** — open in §Open questions; ships if
  trivially mergeable into the click handler.
- **Dual theme (light + dark) palette tuning** — see Open questions.
- **`chords[]` step-indexed chord progression UI (inboil)** —
  replaced by real-time controlChannel input; user plays the
  progression on a clip or via oedipa. No data structure to author
  in-device.
- **`chordSource: { nodeId }` Tonnetz coupling field (inboil)** —
  replaced by routing oedipa's MIDI output to controlChannel. oedipa
  is the m4l Tonnetz device; the cross-device chord progression
  flows through MIDI rather than a scene-graph reference.
- **vst UI** — separate target, separate ADR series.
