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
// Inboil reference (generative.ts:285-338, quantizeChordMode):
//   nearestChord = snapToNearest(note, expandPcsToRange(chord.notes))
//   if |nearestChord - note| <= tolerance: return nearestChord
//   else: return snapToNearest(note, scaleNotes)
//
// Tolerance default = 2 semitones (inboil hardcodes 2). Stencil follows
// the same default; tolerance is exposed as an arg so tests can pin it.

test("snapToChordTones — within 2-semitone tolerance snaps to chord tone", () => {
  // Input C#4 (61), C-major chord {C, E, G} = pcs [0, 4, 7].
  // Nearest chord tone in MIDI: C4 (60), distance 1.
  // 1 <= 2 → snap to 60.
  const scalePitches = buildScalePitches("major", 0);
  assert.equal(snapToChordTones(61, [0, 4, 7], scalePitches), 60);
});

test("snapToChordTones — beyond 2-semitone tolerance falls back to scale", () => {
  // Input F4 (65), single-note "chord" {C} = pcs [0].
  // Nearest chord tone: C4 (60), distance 5. 5 > 2 → fall back.
  // Scale-snap of 65 in C major: F (65) is in scale → returns 65.
  const scalePitches = buildScalePitches("major", 0);
  assert.equal(snapToChordTones(65, [0], scalePitches), 65);
});

test("snapToChordTones — empty chord falls back to scale-snap", () => {
  // No chord context (e.g., chord mode but no controlChannel notes held).
  // Behaviour is identical to plain scale-snap.
  const scalePitches = buildScalePitches("major", 0);
  assert.equal(snapToChordTones(61, [], scalePitches), snapToScale(61, scalePitches));
});

test("snapToChordTones — tie at chord boundary picks the lower MIDI", () => {
  // Input D#4 (63), chord {C, E} = pcs [0, 4].
  // Distances: C4(60)=3, E4(64)=1. 1 <= 2 → E4. (No tie here; documents
  // closest-wins.)
  const scalePitches = buildScalePitches("major", 0);
  assert.equal(snapToChordTones(63, [0, 4], scalePitches), 64);

  // Input D4 (62), chord {C, E} = pcs [0, 4].
  // Distances: C4=2, E4=2 — tie. snapToScale ties to lower → C4 (60).
  // Both are within tolerance, both equally near; tie goes to lower.
  assert.equal(snapToChordTones(62, [0, 4], scalePitches), 60);
});

test("snapToChordTones — explicit tolerance widens the chord window", () => {
  // Input F4 (65), chord {C} = pcs [0]. With tolerance=2, distance 5 → falls
  // back to scale (returns 65, F is in C major). With tolerance=6, 5 <= 6 →
  // snaps to nearest chord tone C4 (60). Tolerance is exposed for symmetry
  // with future modes that may want strict snap.
  const scalePitches = buildScalePitches("major", 0);
  assert.equal(snapToChordTones(65, [0], scalePitches, 6), 60);
});

// ---- diatonicShift (harmony-mode helper) --------------------------------
//
// Inboil reference (generative.ts:235-254). interval=N means a diatonic
// Nth, which is N-1 scale steps (root + 2 steps = 3rd, root + 4 steps =
// 5th, etc.). Direction 'above' adds steps, 'below' subtracts. Out of
// scale input snaps to nearest scale position first. Clamps at scale
// extremes.

test("diatonicShift — 3rd above C in C major = E", () => {
  // C major scale steps: C D E F G A B. 3rd above C = 2 steps up = E.
  const scalePitches = buildScalePitches("major", 0);
  assert.equal(diatonicShift(60, 3, "above", scalePitches), 64);
});

test("diatonicShift — 5th above C in C major = G", () => {
  const scalePitches = buildScalePitches("major", 0);
  assert.equal(diatonicShift(60, 5, "above", scalePitches), 67);
});

test("diatonicShift — 3rd below C in C major = A (one octave below)", () => {
  // C major scale below C4: ... A3(57) B3(59) C4(60). 3rd below = 2 steps
  // back from idx-of-60 in scale. C4 is at scale index 35 (5 octaves * 7
  // diatonic + 0 within); 2 steps back = A3 (57).
  const scalePitches = buildScalePitches("major", 0);
  assert.equal(diatonicShift(60, 3, "below", scalePitches), 57);
});

test("diatonicShift — 4th above E in C major = A", () => {
  // E (64) → diatonic 4th above = 3 steps up: E F G A = 69.
  const scalePitches = buildScalePitches("major", 0);
  assert.equal(diatonicShift(64, 4, "above", scalePitches), 69);
});

test("diatonicShift — out-of-scale input snaps to nearest scale degree first", () => {
  // C# (61) is not in C major. Inboil's algorithm picks the lower scale
  // degree on tie (matches snapToScale): C# is between C(60) and D(62),
  // d=1 each, tie → C. 3rd above C = E (64).
  const scalePitches = buildScalePitches("major", 0);
  assert.equal(diatonicShift(61, 3, "above", scalePitches), 64);
});

test("diatonicShift — clamps at top of scale range", () => {
  // Highest C major degree at the top of MIDI: B7 = 119 (last of C major
  // before chromatic 120). 3rd above B7 should clamp at the scale top
  // since there's no D8 in C major (D would be 122 > 127 — except actually
  // 127 is G8... wait scale-to-127 includes C8(120) D8(122) E8(124)
  // F8(125) G8(127) → not B (119) is not necessarily last).
  // Test: pick the actual last index and shift past it.
  const scalePitches = buildScalePitches("major", 0);
  const last = scalePitches[scalePitches.length - 1];
  assert.equal(diatonicShift(last, 3, "above", scalePitches), last);
});

test("diatonicShift — clamps at bottom of scale range", () => {
  const scalePitches = buildScalePitches("major", 0);
  const first = scalePitches[0];
  assert.equal(diatonicShift(first, 3, "below", scalePitches), first);
});

test("diatonicShift — empty scale returns input note unchanged", () => {
  // Defensive: chromatic-half-equivalent edge if a future caller passes []
  // — but buildScalePitches never returns empty. Keep a guard.
  assert.equal(diatonicShift(60, 3, "above", []), 60);
});
