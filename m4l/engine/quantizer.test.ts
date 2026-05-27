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
  INITIAL_ARP_STATE,
  nextArpIndex,
  parseArpRate,
  resolveArpStep,
  scheduleArpNoteOff,
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

// snapToChordTones + diatonicShift were the v0.1 chord/harmony helpers.
// ADR 004 Phase 3-C removes them from m4l (the chord/arp call site
// uses applyChordShape instead). The shared JSON vectors at
// docs/ai/quantizer-test-vectors.json retain the snap_to_chord_tones
// and diatonic_shift sections; the vst target's engine still exercises
// them via its own test suite (vst Phase 4 cleans those up alongside
// the HARMONY editor group deletion).

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
