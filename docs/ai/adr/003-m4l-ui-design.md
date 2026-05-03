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

The following carry over from inboil and apply to both devices:

- **Color palette**, named tokens (exact hex sampled from inboil at
  patcher build time):
  - `color.bg` — cream / oat background
  - `color.text` — near-black, primary text
  - `color.textMuted` — olive-gray, captions and inactive labels
  - `color.outline` — pale taupe, panel borders and inactive bit dots
  - `color.activeFill` — olive / sage, filled bits and slider thumbs
  - `color.activeHighlight` — warm peach / coral, current read-head /
    just-played key (the eye-catcher accent)
- **Typography** — monospace font, uppercase parameter labels. Set via
  Max patcher's `fontname` / `fontsize` properties on `live.*` and
  text objects. inboil's exact font is geometric mono (resembles IBM
  Plex Mono); patcher build picks the closest Max-available equivalent.
- **Panel pattern** — thin-bordered groups with a corner label tab
  (matches inboil's fieldset-style). Implemented in Max via `panel` +
  short `comment` object, or `live.banner` where suitable.
- **Header band** — top of device: device name (`STENCIL TM` /
  `STENCIL QT`) left, author (`im9`) right, brand accent line below.
  Same treatment on both devices for family consistency.

Reference screenshots of inboil TM and QT will be embedded under
`docs/ai/ui/` when the patcher work begins (captured fresh at that time;
not included in the ADR draft commit).

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
│ │ SCL  [major   ] │ │ ┌─┐┌─┐  ┌─┐┌─┐┌─┐         │ │ VEL  ●━─ │ │
│ │ ROOT [C       ] │ │ │ ││ │  │ ││ ││ │         │ │ GATE ●━─ │ │
│ │ MODE [scale   ] │ │ ├─┴┴─┴┬─┴─┴┴─┴┴─┴─┴─┐    │ │ TIME ●─  │ │
│ │ LVL  ●━━━       │ │ │•│◌│•│◌│•│•│◌│•│◌│•│   │ │ DRIFT ●─ │ │
│ │ TRG  [psthru  ] │ │ │C│D│E│F│G│A│B│ │ │ │   │ │           │ │
│ │ IN   [0       ] │ │ └─┴─┴─┴─┴─┴─┴─┴─┴─┴─┘   │ │ SEED [42] │ │
│ │ CTL  [16      ] │ │                          │ │           │ │
│ └─────────────────┘ └──────────────────────────┘ └──────────┘ │
└────────────────────────────────────────────────────────────────┘
  ~280w                ~440w                       ~240w
  7 live.* widgets     1 jsui (scaleKeyboard)      5 live.* widgets
```

Column allocation:
- **SCALE / I/O** (left, ~280w, 7 items): scale, root, mode, outputLevel,
  triggerMode, inputChannel, controlChannel.
- **KEYBOARD** (center, ~440w, jsui): one-octave (12-key) piano with
  in-scale dots and pulse animation. Wider than TM's ring because the
  keyboard layout is inherently horizontal.
- **HUMAN** (right, ~240w, 5 items): humanizeVelocity, humanizeGate,
  humanizeTiming, humanizeDrift, seed.

In-scale dot = `•`, out-of-scale = `◌`. Active key during pulse glows
in `color.activeHighlight`.

Both layouts are sketches — exact pixel widths, label sizes, and the
precise vertical placement of each `live.*` are decided at patcher build
time against Live's actual rendering. The sketches commit the *column
structure, grouping, and ordering*, not pixel precision.

## Logic-layer-vs-renderer compliance

Per CLAUDE.md §GUI components, both jsui widgets follow the split:

- **Logic layer**: pure TypeScript, exported, runs in Node, tested via
  `node:test`. Lives at:
  - `m4l/host-tm/ui/registerRing.logic.ts`
  - `m4l/host-tm/ui/registerRing.logic.test.ts`
  - `m4l/host-qt/ui/scaleKeyboard.logic.ts`
  - `m4l/host-qt/ui/scaleKeyboard.logic.test.ts`
- **Renderer**: jsui-specific drawing + event glue. Lives at:
  - `m4l/host-tm/ui/registerRing.jsui.js` (loaded by `[jsui]` in patcher)
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
- [x] `host-tm/ui/registerRing.jsui.js` — renderer + Max event glue:
      `register` / `position` inlets, `setBit` outlet on click

### QT scale keyboard

- [x] `host-qt/ui/scaleKeyboard.logic.ts` — `KeyboardModel`, `Pulse`,
      `updatePulses`, `addPulse`, `recomputeInScale`
- [x] `host-qt/ui/scaleKeyboard.logic.test.ts` — pulse decay math,
      in-scale recompute for all 15 scales, multi-pulse stacking
- [x] `host-qt/ui/scaleKeyboard.jsui.js` — renderer:
      `scaleChanged` / `notePulse` inlets

### Stencil-TM patcher (`Stencil-TM.maxpat`)

- [ ] `devicewidth = 1000`, presentation height ~180 (oedipa-matched)
- [ ] Header band: `STENCIL TM` + `im9` + brand accent line
- [ ] `[jsui]` instance loading `host-tm/ui/registerRing.jsui.js`
- [ ] All 12 `live.*` widgets per ADR 002 §live.* parameter surface (TM)
- [ ] `live.*` long-name / short-name set; range / increment per ADR 002
- [ ] `live.*` initial values match defaults
- [ ] `[node.script host-tm/index.js]` instance present
- [ ] `[transport]` driving `step` messages
- [ ] `[midiin]` → channel filter → `noteIn` / `noteOff` routing
- [ ] `Max.outlet` → `[noteout]` for outgoing notes
- [ ] Each `live.*` change fires `setParam` to the host
- [ ] `register` / `position` outlets routed from `[node.script]` to
      `[jsui]` for ring updates
- [ ] `[jsui]` `setBit` outlet routed to `[node.script]` setBit handler
- [ ] Palette tokens applied to all panel objects, comments, and live.*
      widgets
- [ ] Monospace font + uppercase labels

### Stencil-QT patcher (`Stencil-QT.maxpat`)

- [ ] `devicewidth = 1000`, presentation height ~180 (oedipa-matched)
- [ ] Header band: `STENCIL QT` + `im9` + brand accent
- [ ] `[jsui]` instance loading `host-qt/ui/scaleKeyboard.jsui.js`
- [ ] All 12 `live.*` widgets per ADR 002 §live.* parameter surface (QT)
- [ ] `live.*` long-name / short-name; range / increment / defaults
- [ ] `[node.script host-qt/index.js]` instance
- [ ] `[midiin]` → input/control channel split → `noteIn` (quantize path)
      and `setParam root` (control path) per `triggerMode`
- [ ] `Max.outlet` → `[noteout]`
- [ ] `scaleChanged` / `notePulse` outlets routed to `[jsui]`
- [ ] Palette + typography applied

### Visual identity

- [ ] Sample exact hex values from inboil reference (TM + QT screenshots);
      record in `docs/ai/ui/palette.md` (or inline in this ADR's
      §Visual identity once values are picked)
- [ ] Pick monospace font available in Max; record choice
- [ ] Brand accent color (single hex) chosen and applied identically on
      both devices
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
