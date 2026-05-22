# Design reference

Cross-target dimensional and visual reference for Pointsman. UI work
in either target must respect the constraints in this document **before**
sketching layouts in ADRs or implementation — Pointsman's two targets
have asymmetric layout budgets (m4l is host-bounded; vst is
self-determined), and a single ASCII mockup applied to both routinely
produces an unworkable m4l layout.

This file is a constraints-and-numbers reference, not a style guide.
Colour palette, typography, and visual language live in
[vst/Source/Editor/Theme.h](../../vst/Source/Editor/Theme.h) (the
inboil-derived palette is the canonical source; m4l mirrors it).

## m4l device strip

Ableton Live's device strip imposes a **hard height cap** on M4L
devices. There is no host-side toggle to lift it; exceeding it does
not scroll, it clips. Floating-window escalation (`[thispatcher]` /
`pcontrol`) is the only way to present more than the cap allows, and
costs ergonomics (the window detaches from the device chain).

Current Pointsman.amxd presentation bounds (measured from
[m4l/Pointsman.maxpat](../../m4l/Pointsman.maxpat)):

| Dimension       | Value         | Notes                                                          |
|-----------------|---------------|----------------------------------------------------------------|
| Strip height    | **176 px**    | Effective ceiling — top divider y=8, divider height 176, content reaches y=184. Any further descent clips against the Live chain. |
| Strip width     | ~758 px       | Current device width; M4L tolerates wider but the strip becomes the bottleneck in narrow Live windows. |
| Left column     | x = 20..176   | SCALE / ROOT / MODE / VOICES stack. Reaches y = 160 (VOICES row 3 ends at 144+16). |
| Keyboard column | x = 176..636  | scaleKeyboard jsui. Spans full strip height (~y=8..184). |
| Right column    | x = 636..758  | IN-CH / FEEL / DRIFT / SEED / RND. Reaches y = 176 (SEED row at 160+16). |
| Free headroom   | ~0 px         | All three columns saturated to the strip ceiling. |

**Layout implications for new features**:

- Adding a new group to either side column requires reclaiming space
  from existing controls (compaction, label drop, row height shrink).
- Adding a horizontal strip below the keyboard requires shortening
  `scaleKeyboard.jsui` height. The jsui renderer reads its bounding
  box at runtime, so shrinking the box width-or-height is just a
  presentation_rect edit on the jsui object.
- A floating window opened via `[thispatcher]` is reversible — the
  in-strip surface stays as the always-visible summary, the window
  carries detail editing. This was considered and rejected during
  the v0.2 arp ADR discussion for the **primary** UI but remains
  acceptable for **advanced / rarely-touched** sub-surfaces (e.g. a
  future arp pattern editor).

### When to escalate to a floating window

The strip is currently saturated. After the v0.2 arp addition lands
(keyboard shortened to ~120 px + ~44 px ARP strip below), the
remaining headroom is near zero. Future feature additions must trade
against existing surfaces or escalate to a floating window opened via
`[thispatcher]` / `pcontrol`.

**Triggers for escalation** (any one is sufficient):

- The new surface cannot fit without making touch targets too small.
  Floor values: `live.toggle` / `live.menu` ~16 px tall,
  `live.dial` ~24 px, white keys ~50 px tall (jsui hit testing).
- The new surface is **advanced / rarely-touched** (step-pattern
  editor, scale import dialog, MIDI-learn configurator). Keeping
  such a surface visible at all times steals eye-time from
  always-used controls; relegating it to a window is the right
  ergonomic call.
- Further shortening the keyboard or moving it off the centre
  column would cost it its role as the primary visual anchor.

**Rules when a floating window is added**:

- The in-strip surface MUST stay functional standalone. A user who
  never opens the floating window still gets a useful device. The
  window is auxiliary, not primary.
- State persists via the same `live.*` parameters in the floating
  patch — no extra serialisation work; the live.* parameter_longname
  is the persistence key whether the widget renders in the strip or
  the floating patch.
- Add an explicit "Open editor" affordance (`live.button` →
  `[thispatcher]` message) in the in-strip surface — surprise
  floating windows break user expectations.
- Document the new floating surface in this design.md alongside the
  existing strip layout — a target with both a strip and a window is
  a multi-surface design and the doc must keep both surfaces
  visible.

## vst editor window

The JUCE editor sets its own window size at construction, so the
constraint is **content budget** (right-rail group heights summing
correctly), not host-imposed pixel cap. Logic / Bitwig / Reaper all
honour the editor's setSize(); users can drag wider/taller within the
resize limits.

Current natural size (measured from
[vst/Source/Editor/PluginEditor.cpp:34-51](../../vst/Source/Editor/PluginEditor.cpp#L34-L51)):

| Dimension       | Value         | Tokens / derivation                                              |
|-----------------|---------------|------------------------------------------------------------------|
| Total width     | **892 px**    | `kbdContentWidth(588) + railPad*2(24) + railWidth(280)`          |
| Total height    | **602 px**    | `headerHeight(32) + rightRailContentHeight(570)`                 |
| Resize range    | 892..2676 × 602..1806 | `setResizeLimits(totalW, totalH, totalW*3, totalH*3)` — non-aspect-locked. |
| Header          | 32 px         | `headerHeight`. "Pointsman" title + version, divider below.      |
| Keyboard column | 588 px wide   | `kbdContentWidth = 21 white keys × 28 px`. Centres vertically.   |
| Right rail      | 280 px wide   | `railWidth`. Holds all parameter groups stacked vertically.      |

**Right-rail content stack** (from the verbatim comment in
PluginEditor.cpp:38-49, summing to `rightRailContentHeight = 570` with
~7 px headroom):

| Group     | Height | Composition                                                |
|-----------|--------|------------------------------------------------------------|
| (padding) | 24 px  | `railPad × 2`                                              |
| SCALE     | 71 px  | legend + 2 + 2 × row + gap + groupGap                      |
| MODE      | 62 px  | legend + 2 + row + gap + legendH + groupGap                |
| HARMONY   | 97 px  | legend + 2 + `kHarmonyVoicesMax(3)` × row + 2×gap + groupGap |
| HUMANIZE  | 149 px | legend + 2 + 5 × (row + gap) + (groupGap - gap)            |
| ROUTING   | 123 px | legend + 2 + 4 × row + 3 × gap + groupGap                  |
| DISPLAY   | 37 px  | legend + 2 + row                                           |
|           | **563**| sum                                                        |
|           | +7     | headroom                                                   |
|           | **570**| `rightRailContentHeight`                                   |

**Layout implications for new features**:

- Adding a group to the right rail: update both the
  `rightRailContentHeight` constant in
  [PluginEditor.cpp:49](../../vst/Source/Editor/PluginEditor.cpp#L49)
  **and** the breakdown comment above it (kept in sync deliberately
  so the constant is auditable, not magic).
- Rail width (`railWidth = 280`) is a tuned value — widening costs
  the keyboard column space at the natural size. Don't widen lightly.
- Header / footer chrome (32 px) is reserved for the title +
  version. Don't share that band with parameter controls.

## Layout tokens

Shared token reference for both targets (vst values from
[Theme.h](../../vst/Source/Editor/Theme.h#L66-L75), m4l values from
the jsui object grid):

| Token                     | vst   | m4l                       | Notes                                  |
|---------------------------|-------|---------------------------|----------------------------------------|
| Row height                | 22 px | ~16 px (live.* objects)   | m4l's smaller native widgets explain part of the height gap. |
| Row gap                   | 4 px  | 4 px                      |                                        |
| Group gap                 | 8 px  | ~8 px                     |                                        |
| Padding (group X)         | 8 px  | (no per-group frame)      | m4l groups separated by dividers, not boxed. |
| Padding (group Y)         | 6 px  | (no per-group frame)      |                                        |
| Outer pad                 | 12 px | 8 px                      | `railPad` / strip margin.              |

m4l's vertical density is roughly 70% of vst's because of the
native `live.*` widget metrics. Translating a vst group's pixel
height to m4l = multiply by ~0.7 as a first estimate, then check
against the strip ceiling.

## UI checklist for ADRs

Before publishing an ADR that contains a layout sketch:

- [ ] **m4l target**: confirm pixel budget against the 176 px ceiling.
  If the proposed layout adds vertical content to a saturated column,
  the ADR MUST name what's being shortened (keyboard / existing
  group compaction / floating window escalation).
- [ ] **vst target**: if adding a right-rail group, the ADR MUST
  state the group's pixel height under the current theme tokens AND
  the new `rightRailContentHeight` total. Update both the constant
  and the breakdown comment in the same diff during Phase 2.
- [ ] **ASCII mockups**: do not present a single mockup for both
  targets unless the proposal is layout-identical (rare — the
  asymmetric height budget usually forces divergence). Two mockups,
  or one mockup with explicit target labelling, is the default.
- [ ] **Floating windows**: opening a separate window for new
  features is a real option, but the ADR MUST state why the in-strip
  surface won't carry it (which existing surface would be displaced,
  why displacement is worse than escalation).

## Open future-work items tracked here

These are visual / layout concerns that don't belong in any single
ADR but should not be lost:

- **m4l keyboard height**: currently spans full strip height. A
  future arp / step-editor / additional group may need to shorten it.
  Acceptable so long as the keyboard remains tappable (jsui hit
  testing needs at least ~50 px of white-key height for reliable
  finger / mouse targeting).
- **vst keyboard-column padding**: at natural size the keyboard
  centres vertically with significant top/bottom padding (rail content
  is 570 px, keyboard is 104 px). This space is **not** parameter
  surface — it's deliberate breathing room mirroring inboil's flex
  centre layout. Don't fill it with controls.
