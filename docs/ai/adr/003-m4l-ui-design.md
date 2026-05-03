# ADR 003: m4l UI Design — Stencil TM / Stencil QT

## Status: Proposed

**Created**: 2026-05-02

This ADR specifies the v1 UI for both m4l devices: device canvas size,
the boundary between live.* widgets and custom drawing (jsui), the two
custom widgets that ship in v1 (TM register-bit ring, QT scale keyboard),
the visual identity carried over from inboil, and the logic-layer / renderer
split each jsui widget follows.

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
(black keys raised, white keys flat). Each key has a small dot below
indicating in-scale membership for the current `(scale, root)`. Dot
filled with `color.activeFill` if in-scale, hollow if out-of-scale.

**Pulse animation:** when the host emits a `noteOut` event (a quantized
note leaving the device), the corresponding key glows briefly in
`color.activeHighlight` and decays back over ~250 ms. Pulses stack
visually (the most recent dominates).

**Interaction:** keyboard is **display-only** in v1 (no click-to-snap,
no scale editing). Scale is set via `live.menu` for `qt.scale` and
`qt.root` per ADR 002. Click-to-edit-scale is a v2 candidate.

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

### What is intentionally out of v1

- **Output history bar chart** (TM bottom histogram in inboil) — informative
  but takes vertical space and is musically secondary.
- **Revolver continuous rotation animation** — the bit ring snaps; it
  does not spin. v2 candidate.
- **Scale-snap preview overlay** (showing which scale degree TM's chromatic
  output will snap to when chained through QT) — requires cross-device
  awareness, post-v1.
- **FREEZE / ROLL custom buttons** — `lock = 1` is a `live.dial` value;
  `roll` (new seed) is `live.numbox` increment. Custom buttons are a
  nice-to-have, defer.
- **Click-to-edit-scale on QT keyboard** — v2.
- **Per-bit hover preview / drag-write on the ring** — v2.

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

Three columns, same structure:

```
┌─── STENCIL QT ───────────────────────────────────────── im9 ───┐
│ ┌─ SCALE / I/O ────┐ ┌─ KEYBOARD ──────────────┐ ┌─ HUMAN ──┐ │
│ │ SCL [major    ] │ │ ┌─┐┌─┐  ┌─┐┌─┐┌─┐         │ │ ◌  ◌  ◌  ◌│ │
│ │ ROOT[ 0] IN[0] CTL[16]│ │ ││  │ ││ ││ │         │ │ V  G  T  D│ │
│ │ TRG [psthru   ] │ │ ├─┴┴─┴┬─┴─┴┴─┴┴─┴─┴─┐    │ │           │ │
│ │     ◌            │ │ │•│◌│•│◌│•│•│◌│•│◌│•│   │ │ SEED [42] │ │
│ │     LVL          │ │ │C│D│E│F│G│A│B│ │ │ │   │ │           │ │
│ │                  │ │ └─┴─┴─┴─┴─┴─┴─┴─┴─┴─┘   │ │           │ │
│ └─────────────────┘ └──────────────────────────┘ └──────────┘ │
└────────────────────────────────────────────────────────────────┘
  ~280w                ~440w                       ~248w
  6 live.* widgets     1 jsui (scaleKeyboard)      5 live.* widgets
  (qt.mode deferred to v2)
```

Column allocation:
- **SCALE / I/O** (left, ~280w, 6 items in v1): scale, root,
  triggerMode, inputChannel, controlChannel, outputLevel. ROOT/IN/CTL
  share one row (numeric trio); TRG / SCL / outputLevel knob own
  their rows. `qt.mode` is **deferred to v2** — Max's `live.menu`
  does not enter enum-display mode with a single-element
  `parameter_enum` (renders the raw int instead of the string), so
  the v1 menu would be a non-functional placeholder. The bridge
  silently no-ops `setParam mode <v>` until v2 brings chord / harmony
  to a 3-element enum.
- **KEYBOARD** (center, ~440w, jsui): one-octave (12-key) piano with
  in-scale dots and pulse animation. Wider than TM's ring because the
  keyboard layout is inherently horizontal. The keyboard is
  **octave-invariant**: it draws a single octave (C–B) as the pitch-class
  legend; pulses fire by pitch class regardless of which MIDI octave the
  outgoing note lands in. Ableton/MIDI exposes the full 0..127 range —
  Stencil QT does not constrain output to a 3–5 oct band the way inboil's
  reference UI did. (inboil's `octaveRange[3..5]` was an inboil-specific
  display constraint, not a musical decision; not ported.)
- **HUMAN** (right, ~240w, 5 items): humanizeVelocity, humanizeGate,
  humanizeTiming, humanizeDrift, seed.

In-scale dot = `•`, out-of-scale = `◌`. Active key during pulse glows
in `color.activeHighlight`.

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
      — v1 ships 11 of 12 (`qt.mode` deferred to v2; see
      §Layout sketch — Stencil QT for rationale)
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

## Out of scope (v2 or later)

- **Output history bar chart (TM)** — informative but eats vertical
  space; deferred.
- **Revolver continuous rotation animation** — bit ring snaps in v1;
  spinning is v2.
- **Scale-snap preview overlay** — cross-device awareness, post-v1.
- **FREEZE / ROLL custom buttons** — `lock = 1` and seed bump achievable
  via `live.*`; custom buttons are nice-to-have.
- **Click-to-edit-scale on QT keyboard** — v2.
- **Drag-paint on the bit ring** — see Open questions; if trivial, v1;
  else v2.
- **Dual theme (light + dark) palette tuning** — see Open questions.
- **vst UI** — separate target, separate ADR series.
