import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  applyArpGroove,
  applyArpVariation,
  applyChordShape,
  buildScalePitches,
  diatonicShift,
  INITIAL_ARP_STATE,
  nextArpIndex,
  parseArpRate,
  resolveArpStep,
  scheduleArpNoteOff,
  snapToChordTones,
  snapToScale,
  type ArpEmission,
  type ArpPattern,
  type ArpRate,
  type ArpState,
  type ArpVariationResult,
  type ChordShape,
  type ScaleName,
} from "./quantizer.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = join(__dirname, "../../docs/ai/quantizer-test-vectors.json");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const V: any = JSON.parse(readFileSync(VECTORS_PATH, "utf8"));

test("buildScalePitches — full enumeration matches vectors", () => {
  for (const tc of V.build_scale_pitches) {
    const pitches = buildScalePitches(tc.scale as ScaleName, tc.root);
    if (tc.scale === "chromatic-half") {
      // chromatic-half stores spot-check fields, not full pitches array.
      assert.equal(pitches.length, tc.pitches_length, "chromatic-half length");
      assert.deepEqual(pitches.slice(0, 5), tc.pitches_first_5,
        "chromatic-half first 5");
      assert.deepEqual(pitches.slice(-5), tc.pitches_last_5,
        "chromatic-half last 5");
    } else {
      assert.deepEqual(pitches, tc.pitches,
        `scale=${tc.scale} root=${tc.root}`);
    }
  }
});

test("snapToScale — exact, nearest, ties, edges, identity", () => {
  for (const tc of V.snap_to_scale) {
    const pitches = buildScalePitches(tc.scale as ScaleName, tc.root);
    const out = snapToScale(tc.note, pitches);
    assert.equal(out, tc.expected, tc.label);
  }
});

// ---- snapToChordTones (chord-mode helper) -------------------------------
//
// Inboil reference (generative.ts:286-338, quantizeChordMode):
//   nearestChord = snapToNearest(note, expandPcsToRange(chord.notes))
//   if |nearestChord - note| <= tolerance: return nearestChord
//   else: return snapToNearest(note, scaleNotes)
//
// Stencil departs from inboil's `expandPcsToRange(pcs, octLo, octHi)` by
// expanding chord PCs across the full 0..127 MIDI range — see ADR 003
// §scale keyboard ("Pointsman does not constrain output to a 3-5
// oct band the way inboil's reference UI did") and the
// chord_mode_rule meta entry in quantizer-test-vectors.json. Default
// tolerance = 2 semitones (matches inboil's hardcoded value).

test("snapToChordTones — every JSON vector matches", () => {
  // The vectors cover 13 scales × {exact / within-tolerance / scale-fallback}
  // at root=0, plus tolerance-boundary cases, empty-chord degeneracy, a
  // widened-tolerance case, and a non-zero-root chord. See
  // scripts/gen-test-vectors.mjs `genSnapToChordTonesCases` for the
  // generation logic; the reference impl there mirrors inboil
  // generative.ts:286-338 with stencil's documented full-range semantics.
  for (const tc of V.snap_to_chord_tones) {
    const scalePitches = buildScalePitches(tc.scale as ScaleName, tc.root);
    const out = snapToChordTones(tc.note, tc.chord_pcs, scalePitches, tc.tolerance);
    assert.equal(out, tc.expected, tc.label);
  }
});

test("snapToChordTones — empty chord falls back to scale-snap (degenerate identity)", () => {
  // Sentinel covered by JSON vectors but worth a free-form assertion: the
  // empty-chord branch must be byte-equivalent to plain scale-snap so the
  // chord-mode call site doesn't need special-case logic when the
  // controlChannel held set is empty.
  const scalePitches = buildScalePitches("major", 0);
  for (const note of [55, 61, 63, 70, 88]) {
    assert.equal(
      snapToChordTones(note, [], scalePitches),
      snapToScale(note, scalePitches),
      `note=${note}`,
    );
  }
});

// ---- diatonicShift (harmony-mode helper) --------------------------------
//
// Inboil reference (generative.ts:235-254): interval=N is N-1 scale
// steps along scaleNotes; out-of-scale input snaps to nearest scale
// degree first (tie → lower per snap_rule); clamps at scale extremes
// rather than wrapping. interval ∈ {3,4,5,6}, direction ∈ {above, below}.

test("diatonicShift — every JSON vector matches", () => {
  // The vectors cover 13 scales × 4 intervals × 2 directions at root=0
  // (the per-scale ladder is the key regression discipline — interval
  // semantics depend on scale shape), plus out-of-scale input,
  // top/bottom clamping, and a non-zero-root case. See
  // scripts/gen-test-vectors.mjs `genDiatonicShiftCases`; reference
  // impl mirrors inboil generative.ts:235-254.
  for (const tc of V.diatonic_shift) {
    const scalePitches = buildScalePitches(tc.scale as ScaleName, tc.root);
    const out = diatonicShift(tc.note, tc.interval, tc.direction, scalePitches);
    assert.equal(out, tc.expected, tc.label);
  }
});

test("diatonicShift — empty scale returns input note unchanged", () => {
  // Defensive guard not generated into the vectors (buildScalePitches
  // never returns empty). Document the no-op contract here so a future
  // refactor can't silently change the empty-scale fallback.
  assert.equal(diatonicShift(60, 3, "above", []), 60);
});

// ============================================================================
// ADR 004 — chord shape primitive
// ============================================================================

test("applyChordShape — every JSON vector matches", () => {
  for (const tc of V.apply_chord_shape) {
    const out = applyChordShape(tc.root, tc.shape_name as ChordShape);
    assert.deepEqual(out, tc.expected, tc.label);
  }
});

// ============================================================================
// ADR 004 — arpeggiator: rate, pattern cursor, step resolution
// ============================================================================

test("parseArpRate — every JSON vector matches", () => {
  for (const tc of V.parse_arp_rate) {
    const byName = parseArpRate(tc.rate_name as ArpRate);
    const byIndex = parseArpRate(tc.rate_index as number);
    const expected = { num: tc.expected_quarters.num, den: tc.expected_quarters.den };
    assert.deepEqual(byName, expected, `${tc.label} (by name)`);
    assert.deepEqual(byIndex, expected, `${tc.label} (by index)`);
  }
});

test("nextArpIndex — every JSON vector matches", () => {
  for (const tc of V.next_arp_index) {
    const pattern = tc.pattern as ArpPattern;
    if (Array.isArray(tc.trace)) {
      // Walk from `initial`, advancing once per step in `trace[1..]`.
      let st: ArpState = { ...tc.initial };
      // trace[0] is the initial state; assert it matches before advancing.
      assert.deepEqual(st, tc.trace[0], `${tc.label} (initial)`);
      for (let t = 1; t < tc.trace.length; t++) {
        st = nextArpIndex(pattern, st, tc.poolSize, tc.octaves, tc.stepRepeats, 0);
        assert.deepEqual(st, tc.trace[t], `${tc.label} (tick ${t})`);
      }
    } else {
      // Single-step case (random + empty-pool).
      const out = nextArpIndex(
        pattern,
        tc.initial,
        tc.poolSize,
        tc.octaves,
        tc.stepRepeats,
        tc.rngDraw01 ?? 0,
      );
      assert.deepEqual(out, tc.expected, tc.label);
    }
  }
});

test("resolveArpStep — every JSON vector matches", () => {
  for (const tc of V.resolve_arp_step) {
    const out = resolveArpStep(tc.pool, tc.index, tc.octaveRound, tc.pattern as ArpPattern);
    assert.deepEqual(out, tc.expected, tc.label);
  }
});

test("INITIAL_ARP_STATE matches the first-tick state used across vectors", () => {
  // The `initial` field on every trace-style case is the canonical first-
  // tick state. Anchor it here so a future refactor of nextArpIndex's
  // default state surface fails loudly.
  assert.deepEqual(INITIAL_ARP_STATE, { index: 0, round: 0, repeatTick: 0, direction: 1 });
});

// ============================================================================
// ADR 004 — arpeggiator: variation cascade
// ============================================================================

test("applyArpVariation — every JSON vector matches", () => {
  for (const tc of V.apply_arp_variation) {
    const out = applyArpVariation(
      tc.emission as ArpEmission,
      tc.variation,
      tc.rngDraw01,
      tc.rngDraw02,
    );
    assert.deepEqual(out, tc.expected, tc.label);
  }
});

// ============================================================================
// ADR 004 — arpeggiator: groove cascade
// ============================================================================

test("applyArpGroove — every JSON vector matches", () => {
  for (const tc of V.apply_arp_groove) {
    const out = applyArpGroove(
      tc.emission as ArpVariationResult,
      tc.tickIndex,
      tc.accentTable,
      tc.slideTable,
      tc.swing,
      tc.sixteenthDurationSamples,
    );
    assert.deepEqual(out, tc.expected, tc.label);
  }
});

// ============================================================================
// ADR 004 — slide-aware noteOff scheduling
// ============================================================================

test("scheduleArpNoteOff — every JSON vector matches", () => {
  for (const tc of V.schedule_arp_note_off) {
    const out = scheduleArpNoteOff(
      tc.slideOnCurrent,
      tc.gateSamples,
      tc.nextTickSampleOffset,
    );
    assert.deepEqual(out, tc.expected, tc.label);
  }
});
