import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildScalePitches,
  diatonicShift,
  snapToChordTones,
  snapToScale,
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
// §QT scale keyboard ("Stencil QT does not constrain output to a 3-5
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
