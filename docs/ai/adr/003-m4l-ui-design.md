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

**Per-control idiom**:
- floats (lock, density, gate) use `live.slider` horizontal — matches
  inboil's `.ctl-slider` row layout (label · slider · value)
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
