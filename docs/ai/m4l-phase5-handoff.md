# m4l Phase 5 — handoff (2026-05-17, amended same day)

vst Phase 5 (parameter surface redesign + chord/harmony merge) shipped on
the vst target this session. m4l Phase 5 is the parallel implementation
on the m4l target; the engine is unchanged (shared test vectors at
[docs/ai/quantizer-test-vectors.json](quantizer-test-vectors.json) still
pass m4l/engine/* as-is), but the host TS layer, Max patch, jsui, and
tests all need the v2 surface and the merged chord-mode semantic.

This doc is the resume point. Read it cold; it does not assume any
prior session context.

## Scope confirmed at handoff time

User has explicitly asked for:
1. **vst-parity Chord mode** (1-in-N-out diatonic expansion) — the
   primary Phase 5 work below.
2. **UI 調整** — additional UI polish beyond the strict Phase 5 deltas
   listed in this doc. Specifics are unscoped at handoff time; the
   first move in the resume session should be to ask the user what
   "UI 調整" covers concretely (e.g., layout tweaks, jsui keyboard
   refinements, visual identity polish, parameter widget changes
   not mentioned below). Add a small TODO list with the user before
   touching `.maxpat` or `scaleKeyboard.jsui.js`.

User also surfaced during the audit-fix session (out of scope for
Phase 5 itself, mention as workaround if it comes up again):
- Stencil → Pointsman on the same Live track sends MIDI as ch=0
  (Live track-internal normalisation). `IN CH = OMNI (0)` is the
  intended use for that routing. CLAUDE.md "Live runtime gotchas"
  has the full note.

## What shipped on vst (anchors)

| commit | scope |
|---|---|
| `fb5e56e` | ADR 003 Phase 5 spec (originally planned chord-from-input direction) |
| `40daa46` | Phase 5 implementation + mid-session course-correction to merged chord/harmony |
| `03603cd` | HARMONY UI disable on scale mode + visual fixes + IN CH filter (drop) |
| `f58484d` | revert IN CH back to pass-through (MPE per-note channel carry) |
| `75b0e66` | ADR 003 §Status note flagging body paragraphs as superseded by the course correction |

Net shipped behaviour on vst:

- `ModeChoice = {Scale=0, Chord=1}` — Harmony removed
- Chord mode = 1-in-N-out chord expansion: input → scale-snap → emit
  base + `harmonyVoices` voices via `diatonicShift`
- `harmonyVoices` default on new instance = `[{3 above}, {5 above}]`
  (= 1-3-5 triad)
- v2 parameter surface: removed `humanizeVelocity` / `humanizeGate` /
  `humanizeTiming` / `humanizeDrift` / `outputLevel` / `triggerMode` /
  `controlChannel`. Added `feel` / `drift` (single sliders driving
  three humanize axes inside `composeHumanize`)
- Random seed per instance: `juce::Random::getSystemRandom().nextInt({0,
  0x1000000})` at construction, set as the APVTS default for `pid::seed`
- v1 state discard on `setStateInformation`: any removed pid present in
  loaded XML, or `PointsmanState.version != "2"` → log
  `"Pointsman: discarding pre-v2 state"` and keep live defaults
- `kStateVersion = 2`
- IN CH pass-through retained (MPE per-note channels carry; see
  concept.md §"Input handling")
- HARMONY group disabled (parent-disable propagates to badge combos +
  add btn) when `mode == Scale`
- Mode pill description text: `Scale` = "snap to nearest scale degree";
  `Chord` = "expand to a diatonic chord (1 in, N out)"
- HarmonyBadge: no outer olive border (the combo's own outline
  suffices); 6 px gap between combo and x button

Spec source of truth: [concept.md](concept.md) §"Scale and chord modes"
and §"Parameter surface (canonical)".

## Audit-fix delta (amended 2026-05-17, after original handoff)

A separate audit-fix session ran on top of the original handoff and
landed 7 commits across both targets. Most are isolated from Phase 5
work, but two m4l commits extend the very code Phase 5 removes — drop
them along with the rest of the chord-from-context machinery.

vst-side audit fixes (no impact on Phase 5 m4l work):

| commit | scope |
|---|---|
| `b6189dc` | SpinLock around `harmonyVoices` read in `syncHarmonyVoicesToTree` |
| `201b6f9` | Alloc-free scale-pitch cache rebuild (`buildScalePitchesInto`) |
| `18772bb` | 8-slot pulse ring for chord-mode glow |
| `55a86ba` | `kMaxPending`/`kMaxSounding` caps on processBlock buffers |

m4l-side audit fixes:

| commit | scope | Phase 5 disposition |
|---|---|---|
| `76d1599` | host: clear `controlHeldPitches` on `setParam("controlChannel")` | **DELETE** — Phase 5 removes `controlChannel` and the entire `controlHeldPitches` machinery (Chord mode no longer reads held context) |
| `4abdb6b` | bridge: emit `chordChanged` outlet after `controlChannel` switch | **DELETE** — same reason, the `chordChanged` outlet itself goes away |
| `cdf1a02` | bridge: cancel scheduled noteOns on panic / transportStop / flush via `pendingNoteOns` map + `flushInFlight()` rename | **KEEP** — scheduler safety fix, applies regardless of mode semantics. Carry forward as-is through the Phase 5 refactor. |

Associated tests to remove alongside the deleted commits:
- `m4l/host/host.test.ts`: `setParam controlChannel — clears stale chord context from old channel`
- `m4l/host/bridge.test.ts`: `setParam controlChannel — emits chordChanged [] so the jsui dots clear`

Tests to **preserve** through the refactor (rename if call sites
change but the assertion still belongs):
- `panic — cancels scheduled noteOn so it never fires after the panic`
- `panic — emits immediate noteOff for sounding pitches with scheduled noteOff`

Also note: the audit-fix session added `dispatchEventForTest` and
`getPendingCountsForTest` test-only exports to `bridge.ts`. These pin
the scheduler contract; keep them and update if the dispatch surface
moves during Phase 5.

## What m4l Phase 5 needs

### Engine (m4l/engine/)

No changes expected. The shared test vectors only cover
`buildScalePitches` / `snapToScale` / `snapToChordTones` /
`diatonicShift`, which m4l/engine implements already. Verify by running
`cd m4l && pnpm -r test` after the host-layer changes settle — if
engine tests still pass, no engine work.

### Host TS (m4l/host/)

| file | change |
|---|---|
| `host.ts` | `PointsmanMode = "scale" \| "chord"` (drop `"harmony"`). `PointsmanParams`: drop `humanizeVelocity` / `humanizeGate` / `humanizeTiming` / `humanizeDrift` / `outputLevel` / `triggerMode` / `controlChannel`; add `feel: number` / `drift: number`. `DEFAULT_PARAMS.harmonyVoices = [{interval:3, direction:"above"},{interval:5, direction:"above"}]`. Constructor: draw random seed in `[0, 0xffffff]` and put into params. Drop chord-context maintenance code (no longer driven by held controlChannel notes). Chord mode = 1-in-N-out expansion: snap input to scale, then for each harmonyVoice emit `diatonicShift(snapped, v.interval, v.direction, scalePitches)`. Output = `[snapped, ...voices]`. |
| `bridge.ts` | Drop setParam cases for removed pids. Add setParam cases for `feel` / `drift`. Drop `controlChannel`-held chord-context maintenance (the `maybeEmitChordChanged` / `chordContext` paths). v1 → v2 state discard logic (mirror vst's: incoming setParam for a removed pid → log + default). `mode` enum drops the `"harmony"` value. |
| `humanize.ts` | If currently splits humanize axes into separate amps, collapse to one `feel` amp driving three independent draws (matches vst's `composeHumanize` semantic). |
| `*.test.ts` | TDD: write new Phase 5 spec tests first, observe failure, then implement. Mirror the vst test catalogue: chord-mode single noteOn → triad (`60` C major → `{60,64,67}`); default voices on new instance; v1 → v2 discard; random seed divergence across 16 fresh constructs; non-tonic input → its diatonic triad; out-of-scale input snaps first then expands; scale mode counter-test (1-in-1-out); `inputChannel` non-matching pass-through (MPE). |

### Max patch (m4l/Pointsman.maxpat)

| change | objects |
|---|---|
| Remove 5 v1 live.dial / live.menu / live.numbox | `obj-w-humanizeVelocity` / `obj-w-humanizeGate` / `obj-w-humanizeTiming` / `obj-w-humanizeDrift` / `obj-w-outputLevel` / `obj-w-triggerMode` / `obj-w-controlChannel` (+ their `prepend setParam` / `sel` / `msg` siblings, + the `patchline`s wiring them to `obj-nodescript`). |
| Add 2 new live.dial | `feel` and `drift` (0..1, default 0). Use `parameter_longname = PointsmanFeel` / `PointsmanDrift`. Wire `prepend setParam feel` / `prepend setParam drift` → `obj-nodescript`. |
| Mode menu 3 → 2 | `obj-w-mode` `parameter_enum = ["scale", "chord"]`. Drop the third entry. |
| Presentation layout | The 5 removed dials freed presentation real estate; relayout so the patch's presentation rect doesn't have empty gaps. The freeze tooling (`pnpm bake`) reads positions verbatim, so adjust in Max GUI not by hand for anything visible. |

### jsui (m4l/scaleKeyboard.jsui.js)

| change |
|---|
| Mode pill count 3 → 2 (Scale / Chord) |
| When `mode == "scale"`, dim the HARMONY group (badges + add button). jsui has no parent-disable propagation, so dim manually: alpha 0.4-0.5 on harmony components + ignore mouse hits. |
| Pill description text: same as vst |
| Chord-tier highlight (if any) — remove. The vst version dropped chord-tier highlight because chord mode no longer derives from held context; same logic applies here. |

### Bake / verify

```bash
cd m4l
pnpm -r typecheck && pnpm -r test
pnpm bake
# open Pointsman.amxd in Live, verify chord-mode single-note → triad
# AND mode pill + HARMONY UI behaviour matches vst
```

### Release

ADR 002 §Phase 0 procedure: open the dev `.amxd`, click the
**snowflake** (Freeze) button, *File → Save As* `dist/Pointsman.amxd`.

## Watch-outs from this session

1. **Read concept.md before treating documented behaviour as a bug.**
   IN CH pass-through is explicit in concept.md §"Input handling"
   precisely so MPE per-note channels carry. When the user said "IN CH
   を変えると chord にならない", the right move was to verify against
   the doc, not to immediately agree the doc was wrong and rewrite the
   behaviour. The drop-then-revert cycle (`03603cd` → `f58484d`) was
   the result of skipping the doc check.

2. **TDD is the safety net, not a rubber stamp.** Tests that match
   the implementation aren't tests, they're co-conspirators. The
   chord-mode-1-in-1-out tests I wrote at first all passed because
   they encoded the wrong spec. The user caught it at manual gate.

3. **Manual gate is part of the loop, not the end.** `make test` and
   `make build` going green is necessary but not sufficient. The
   chord-clip "単音 only" failure, the IN CH pass-through failure,
   and the chord/harmony semantic confusion were all caught by user
   listening in Logic — none by automated tests.

4. **m4l v1.0.0 / v1.0.1 was a canary release.** A hard break with
   no preset migration is acceptable per concept.md + ADR 003; do
   not bend backwards trying to preserve v1 state. Just discard and
   default-construct.

5. **`.maxpat` is JSON but not safe to hand-edit blind.** The bake
   guard (`pnpm bake:check`) catches abs-path and sibling-file
   resolution bugs but not arbitrary layout corruption. Layout
   changes happen in Max GUI; param removals can be done in JSON
   but verify by re-baking and loading in Live before committing.
