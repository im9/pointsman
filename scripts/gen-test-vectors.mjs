// scripts/gen-test-vectors.mjs
//
// Generates docs/ai/rng-test-vectors.json and
// docs/ai/quantizer-test-vectors.json (the cross-target engine spec
// for Pointsman).
//
// This is an INDEPENDENT reference implementation of the spec —
// deliberately separate from m4l/engine/ and vst/Source/, so the test
// vectors are not fitted to any single target's implementation. Each
// target's engine is the unit-under-test; this script's output is the spec.
//
// PRNG references:
//   xoshiro128++  https://prng.di.unimi.it/xoshiro128plusplus.c
//   SplitMix64    https://prng.di.unimi.it/splitmix64.c
//
// Run:  node scripts/gen-test-vectors.mjs
// Re-run any time vector cases change; do not hand-edit the JSONs.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");
const OUT_RNG = join(REPO, "docs/ai/rng-test-vectors.json");
const OUT_QT = join(REPO, "docs/ai/quantizer-test-vectors.json");

// ============================================================
// PRNG: SplitMix64 + xoshiro128++ (Vigna)
// ============================================================

const U64 = (1n << 64n) - 1n;
const U32_BIG = (1n << 32n) - 1n;

function splitMix64Next(state) {
  // state: bigint u64. Returns { value: u64, state: u64 } both as bigint.
  const newState = (state + 0x9e3779b97f4a7c15n) & U64;
  let z = newState;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & U64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & U64;
  z = (z ^ (z >> 31n)) & U64;
  return { value: z, state: newState };
}

// Seeding convention (CANONICAL — see meta in rng-test-vectors.json):
//   call SplitMix64 twice, splitting each u64 into [low32, high32]:
//     s = [low(z1), high(z1), low(z2), high(z2)]
function xoshiroSeed(seedU64) {
  let st = seedU64 & U64;
  const r1 = splitMix64Next(st);
  st = r1.state;
  const r2 = splitMix64Next(st);
  return [
    Number(r1.value & U32_BIG),
    Number((r1.value >> 32n) & U32_BIG),
    Number(r2.value & U32_BIG),
    Number((r2.value >> 32n) & U32_BIG),
  ];
}

function rotl32(x, k) {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

// Pure: takes state, returns new { value, state }. Does not mutate input.
function xoshiroNext(s) {
  const result = ((rotl32((s[0] + s[3]) >>> 0, 7) + s[0]) >>> 0);
  const t = (s[1] << 9) >>> 0;
  const ns = [s[0], s[1], s[2], s[3]];
  ns[2] = (ns[2] ^ ns[0]) >>> 0;
  ns[3] = (ns[3] ^ ns[1]) >>> 0;
  ns[1] = (ns[1] ^ ns[2]) >>> 0;
  ns[0] = (ns[0] ^ ns[3]) >>> 0;
  ns[2] = (ns[2] ^ t) >>> 0;
  ns[3] = rotl32(ns[3], 11);
  return { value: result, state: ns };
}

// ============================================================
// QT ops
// ============================================================

const SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  "minor-pentatonic": [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  melodic: [0, 2, 3, 5, 7, 9, 11],
  whole: [0, 2, 4, 6, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

function buildScalePitches(scale, root) {
  if (scale === "chromatic-half") {
    return Array.from({ length: 128 }, (_, i) => i);
  }
  const intervals = SCALE_INTERVALS[scale];
  if (!intervals) throw new Error(`unknown scale: ${scale}`);
  const pitchClasses = new Set(intervals.map((i) => (root + i) % 12));
  const out = [];
  for (let n = 0; n <= 127; n++) {
    if (pitchClasses.has(n % 12)) out.push(n);
  }
  return out;
}

function snapToScale(note, pitches) {
  if (pitches.length === 0) return note;
  if (note <= pitches[0]) return pitches[0];
  if (note >= pitches[pitches.length - 1]) return pitches[pitches.length - 1];
  let lo = 0, hi = pitches.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (pitches[mid] < note) lo = mid + 1;
    else hi = mid;
  }
  const upper = pitches[lo];
  const lower = pitches[lo - 1];
  if (upper === note) return upper;
  const dUp = upper - note;
  const dDn = note - lower;
  return dDn <= dUp ? lower : upper; // tie → lower
}

// Reference impl of Pointsman's chord-mode helper. Mirrors inboil
// generative.ts:286-338 quantizeChordMode logic (snap-within-tolerance,
// scale fallback) but expands chord PCs across the full 0..127 MIDI
// range.
//
// Default tolerance = 2 semitones (inboil hardcodes 2). Empty chordPcs
// → identical to plain scale-snap.
function snapToChordTones(note, chordPcs, scalePitches, tolerance = 2) {
  if (chordPcs.length === 0) return snapToScale(note, scalePitches);
  const pcSet = new Set(chordPcs.map((pc) => ((pc % 12) + 12) % 12));
  const chordMidi = [];
  for (let n = 0; n <= 127; n++) {
    if (pcSet.has(n % 12)) chordMidi.push(n);
  }
  const nearestChord = snapToScale(note, chordMidi);
  if (Math.abs(nearestChord - note) <= tolerance) return nearestChord;
  return snapToScale(note, scalePitches);
}

// Reference impl of Pointsman's harmony-mode helper. Mirrors inboil
// generative.ts:235-254: interval=N is N-1 scale steps along
// scalePitches; out-of-scale input snaps to nearest scale degree
// first; clamps at scale extremes rather than wrapping.
function diatonicShift(note, interval, direction, scalePitches) {
  if (scalePitches.length === 0) return note;
  const snapped = snapToScale(note, scalePitches);
  const idx = scalePitches.indexOf(snapped);
  const steps = interval - 1;
  const targetIdx = direction === "above" ? idx + steps : idx - steps;
  if (targetIdx < 0) return scalePitches[0];
  if (targetIdx >= scalePitches.length) return scalePitches[scalePitches.length - 1];
  return scalePitches[targetIdx];
}

// ============================================================
// Helpers for emission
// ============================================================

function hexU32(n) {
  return "0x" + (n >>> 0).toString(16).padStart(8, "0");
}
function hexU64(big) {
  return "0x" + (big & U64).toString(16).padStart(16, "0");
}
// JSON-friendly seed encoding: decimal string + hex form.
function seedField(big) {
  return { decimal: big.toString(), hex: hexU64(big) };
}

// ============================================================
// RNG cases
// ============================================================

const SEEDS = [0n, 1n, 0xdeadbeefn, 0x123456789abcdef0n];

function genSplitMix64InitCases() {
  return SEEDS.map((seed) => {
    const r1 = splitMix64Next(seed);
    const r2 = splitMix64Next(r1.state);
    const sm_outputs = [
      { value_hex: hexU64(r1.value), value_decimal: r1.value.toString() },
      { value_hex: hexU64(r2.value), value_decimal: r2.value.toString() },
    ];
    const s = xoshiroSeed(seed);
    return {
      seed: seedField(seed),
      splitmix64_outputs: sm_outputs,
      xoshiro_state_s: s.map((w) => ({ hex: hexU32(w), decimal: w })),
    };
  });
}

function genPrngCases() {
  const N_DRAWS = 8;
  return SEEDS.map((seed) => {
    let s = xoshiroSeed(seed);
    const draws = [];
    for (let i = 0; i < N_DRAWS; i++) {
      const r = xoshiroNext(s);
      s = r.state;
      draws.push({ hex: hexU32(r.value), decimal: r.value });
    }
    return { seed: seedField(seed), draws };
  });
}

// ============================================================
// QT cases
// ============================================================

function genBuildScalePitchesCases() {
  // (a) every scale at root=0
  // (b) major sweep across all 12 roots — covers the modular root shift
  // (c) chromatic-half sentinel
  const cases = [];
  for (const scale of Object.keys(SCALE_INTERVALS)) {
    cases.push({
      scale,
      root: 0,
      pitches: buildScalePitches(scale, 0),
    });
  }
  for (let root = 0; root < 12; root++) {
    cases.push({
      scale: "major",
      root,
      pitches: buildScalePitches("major", root),
    });
  }
  cases.push({
    scale: "chromatic-half",
    root: 0,
    pitches_length: 128,
    pitches_first_5: [0, 1, 2, 3, 4],
    pitches_last_5: [123, 124, 125, 126, 127],
    note: "chromatic-half is a 0..127 identity sentinel; full enumeration omitted for brevity",
  });
  return cases;
}

function genSnapToScaleCases() {
  const cMajor = buildScalePitches("major", 0);
  const cSharpMajor = buildScalePitches("major", 1);
  const bMajor = buildScalePitches("major", 11);
  const pent = buildScalePitches("pentatonic", 0); // C pentatonic: 0,2,4,7,9,12,14...
  const cases = [];

  // ---- exact-on-pitch (no movement) ----
  for (const note of [60, 62, 64, 65, 67, 69, 71]) {
    cases.push({
      label: `C major: ${note} on-scale → no change`,
      note,
      scale: "major",
      root: 0,
      expected: snapToScale(note, cMajor),
    });
  }

  // ---- nearest, no tie ----
  // C pentatonic: pitches 0,2,4,7,9; input 5 → distance to 4 is 1, to 7 is 2 → 4
  cases.push({
    label: "C pentatonic: 65 → 64 (nearest, no tie; F snaps down to E)",
    note: 65, scale: "pentatonic", root: 0,
    expected: snapToScale(65, pent),
  });
  // C pentatonic: 66 → distance to 64 is 2, to 67 is 1 → 67
  cases.push({
    label: "C pentatonic: 66 → 67 (nearest, no tie)",
    note: 66, scale: "pentatonic", root: 0,
    expected: snapToScale(66, pent),
  });

  // ---- exact tie → round down ----
  // C major: 63 (D#) — equidistant from 62 (D) and 64 (E) → 62
  cases.push({
    label: "C major: 63 (D#) tie between 62/64 → 62 (round down)",
    note: 63, scale: "major", root: 0,
    expected: snapToScale(63, cMajor),
  });
  // C major: 66 (F#) — equidistant from 65 (F) and 67 (G) → 65
  cases.push({
    label: "C major: 66 (F#) tie between 65/67 → 65 (round down)",
    note: 66, scale: "major", root: 0,
    expected: snapToScale(66, cMajor),
  });
  // C major: 70 (Bb) → dist to 69 is 1, to 71 is 1 → 69
  cases.push({
    label: "C major: 70 (Bb) tie between 69/71 → 69 (round down)",
    note: 70, scale: "major", root: 0,
    expected: snapToScale(70, cMajor),
  });

  // ---- below all pitches ----
  // B major (root=11): pitch classes {11,1,3,4,6,8,10}, so 0 is NOT in scale, pitches[0] = 1.
  cases.push({
    label: "B major: 0 below pitches[0]=1 → 1",
    note: 0, scale: "major", root: 11,
    expected: snapToScale(0, bMajor),
  });

  // ---- above all pitches ----
  // C# major (root=1): pitch classes {1,3,5,6,8,10,0}, so 7 (G) not in scale.
  cases.push({
    label: "C# major: 127 above max → snaps to max",
    note: 127, scale: "major", root: 1,
    expected: snapToScale(127, cSharpMajor),
    max_pitch: cSharpMajor[cSharpMajor.length - 1],
  });

  // ---- edge: 0 and 127 inputs against C major ----
  cases.push({
    label: "C major: 0 (on-scale C) → 0",
    note: 0, scale: "major", root: 0,
    expected: snapToScale(0, cMajor),
  });
  cases.push({
    label: "C major: 127 (on-scale G) → 127",
    note: 127, scale: "major", root: 0,
    expected: snapToScale(127, cMajor),
  });

  // ---- chromatic-half identity ----
  for (const note of [0, 50, 60, 100, 127]) {
    const pitches = buildScalePitches("chromatic-half", 0);
    cases.push({
      label: `chromatic-half: ${note} → ${note} (identity passthrough)`,
      note, scale: "chromatic-half", root: 0,
      expected: snapToScale(note, pitches),
    });
  }

  return cases;
}

function genSnapToChordTonesCases() {
  // Coverage strategy:
  //   (a) For every scale at root=0, exercise the "I chord" (scale degrees
  //       1-3-5 = first three pitch classes of the scale's interval list)
  //       against three input notes that probe distinct algorithm branches:
  //         - exact chord-tone (returns input)
  //         - within-tolerance non-chord (snaps to nearest chord tone)
  //         - beyond-tolerance non-chord (falls back to scale-snap)
  //   (b) Empty-chord PCs at root=0 / major scale: degenerate fallback.
  //   (c) Tolerance-boundary cases (default tolerance=2).
  //   (d) Custom tolerance widens the chord branch.
  //   (e) Non-zero root: D major triad.
  const cases = [];

  for (const scale of Object.keys(SCALE_INTERVALS)) {
    if (scale === "chromatic-half") continue;
    const intervals = SCALE_INTERVALS[scale];
    const chordPcs = intervals.slice(0, 3);
    const scalePitches = buildScalePitches(scale, 0);

    // (a1) input = chordPcs[0] in MIDI octave 5 (60..) → exact chord tone.
    const exactInput = 60 + chordPcs[0];
    cases.push({
      label: `${scale} root=0: input=${exactInput} (exact chord tone PC ${chordPcs[0]}) → unchanged`,
      note: exactInput,
      scale,
      root: 0,
      chord_pcs: chordPcs,
      tolerance: 2,
      expected: snapToChordTones(exactInput, chordPcs, scalePitches),
    });
    // (a2) input one semitone above the root chord-PC.
    const nearInput = exactInput + 1;
    cases.push({
      label: `${scale} root=0: input=${nearInput} (1st semitone above root chord-PC; within tolerance=2) → snap to chord`,
      note: nearInput,
      scale,
      root: 0,
      chord_pcs: chordPcs,
      tolerance: 2,
      expected: snapToChordTones(nearInput, chordPcs, scalePitches),
    });
    // (a3) input far from any chord tone, single-PC chord.
    const farInput = exactInput + 5;
    cases.push({
      label: `${scale} root=0: input=${farInput}, single-PC chord [${chordPcs[0]}], distance >2 → scale fallback`,
      note: farInput,
      scale,
      root: 0,
      chord_pcs: [chordPcs[0]],
      tolerance: 2,
      expected: snapToChordTones(farInput, [chordPcs[0]], scalePitches),
    });
  }

  // (b) Empty chord → behaves identically to scale-snap.
  const cMajor = buildScalePitches("major", 0);
  cases.push({
    label: "C major: empty chord PCs → identical to snapToScale (input 63 → tie 62/64 → 62)",
    note: 63,
    scale: "major",
    root: 0,
    chord_pcs: [],
    tolerance: 2,
    expected: snapToChordTones(63, [], cMajor),
  });

  // (c) Tolerance boundary at default tolerance=2.
  cases.push({
    label: "C major triad [0,4,7]: input=62 (dist 2 to C and 2 to E) → tie → 60 (lower)",
    note: 62,
    scale: "major",
    root: 0,
    chord_pcs: [0, 4, 7],
    tolerance: 2,
    expected: snapToChordTones(62, [0, 4, 7], cMajor),
  });
  cases.push({
    label: "C major triad [0,4,7]: input=70 (dist 2 to C8=72) → at tolerance → snap to 72",
    note: 70,
    scale: "major",
    root: 0,
    chord_pcs: [0, 4, 7],
    tolerance: 2,
    expected: snapToChordTones(70, [0, 4, 7], cMajor),
  });
  cases.push({
    label: "C major, chord=[0] only: input=63 (dist 3 from chord) → scale fallback → 62",
    note: 63,
    scale: "major",
    root: 0,
    chord_pcs: [0],
    tolerance: 2,
    expected: snapToChordTones(63, [0], cMajor),
  });

  // (d) Same input/chord with widened tolerance pulls into the chord branch.
  cases.push({
    label: "C major, chord=[0] only: input=63, tolerance=3 → within widened tolerance → snap to 60",
    note: 63,
    scale: "major",
    root: 0,
    chord_pcs: [0],
    tolerance: 3,
    expected: snapToChordTones(63, [0], cMajor, 3),
  });

  // (e) Non-zero root: D major triad D-F#-A → PCs [2,6,9].
  const dMajor = buildScalePitches("major", 2);
  cases.push({
    label: "D major triad [2,6,9]: input=64 (dist 2 to D and 2 to F#) → tie → 62 (lower)",
    note: 64,
    scale: "major",
    root: 2,
    chord_pcs: [2, 6, 9],
    tolerance: 2,
    expected: snapToChordTones(64, [2, 6, 9], dMajor),
  });

  return cases;
}

function genDiatonicShiftCases() {
  // Coverage strategy:
  //   (a) For every scale at root=0, take an in-scale input note and
  //       compute diatonicShift for each interval ∈ {3,4,5,6} above and
  //       below.
  //   (b) Out-of-scale input (snapped first).
  //   (c) Top-of-scale clamp.
  //   (d) Bottom-of-scale clamp.
  //   (e) Non-zero root: D major shift.
  const cases = [];

  for (const scale of Object.keys(SCALE_INTERVALS)) {
    if (scale === "chromatic-half") continue;
    const scalePitches = buildScalePitches(scale, 0);
    // For every scale at root=0, scalePitches always contains 60 (PC 0
    // ⇔ root) since every interval list starts with 0.
    const inputNote = 60;
    for (const interval of [3, 4, 5, 6]) {
      for (const direction of ["above", "below"]) {
        cases.push({
          label: `${scale} root=0: ${interval}${direction === "above" ? "↑" : "↓"} from MIDI 60`,
          note: inputNote,
          scale,
          root: 0,
          interval,
          direction,
          expected: diatonicShift(inputNote, interval, direction, scalePitches),
        });
      }
    }
  }

  // (b) Out-of-scale input. C major (C D E F G A B) doesn't contain D# (63).
  // diatonicShift snaps 63 to nearest scale pitch first: tie 62/64 → 62 (D);
  // then 3rd above D = F (65).
  const cMajor = buildScalePitches("major", 0);
  cases.push({
    label: "C major: out-of-scale input 63 (D#) → snaps to 62 (D) → 3rd↑ → 65 (F)",
    note: 63,
    scale: "major",
    root: 0,
    interval: 3,
    direction: "above",
    expected: diatonicShift(63, 3, "above", cMajor),
  });

  // (c) Top-of-scale clamp.
  cases.push({
    label: "C major: 6th↑ from MIDI 127 (top of scale) → clamps at top",
    note: 127,
    scale: "major",
    root: 0,
    interval: 6,
    direction: "above",
    expected: diatonicShift(127, 6, "above", cMajor),
  });

  // (d) Bottom-of-scale clamp.
  cases.push({
    label: "C major: 6th↓ from MIDI 0 (bottom of scale) → clamps at bottom",
    note: 0,
    scale: "major",
    root: 0,
    interval: 6,
    direction: "below",
    expected: diatonicShift(0, 6, "below", cMajor),
  });

  // (e) Non-zero root: D major scale = D E F# G A B C# (PCs 2,4,6,7,9,11,1).
  const dMajor = buildScalePitches("major", 2);
  cases.push({
    label: "D major: 5th↑ from MIDI 62 (D5) → 69 (A5)",
    note: 62,
    scale: "major",
    root: 2,
    interval: 5,
    direction: "above",
    expected: diatonicShift(62, 5, "above", dMajor),
  });
  cases.push({
    label: "D major: 3rd↓ from MIDI 62 (D5) → 57 (A4)",
    note: 62,
    scale: "major",
    root: 2,
    interval: 3,
    direction: "below",
    expected: diatonicShift(62, 3, "below", dMajor),
  });

  return cases;
}

// ============================================================
// Compose JSONs
// ============================================================

const rngJson = {
  spec: "Pointsman RNG conformance vectors (xoshiro128++ + SplitMix64)",
  generated_by: "scripts/gen-test-vectors.mjs",
  generator_note:
    "Re-run scripts/gen-test-vectors.mjs to regenerate. Do not hand-edit. " +
    "Cross-target spec: m4l/engine/rng.ts and vst/Source/<rng>.cpp must " +
    "produce values bit-for-bit equal to these cases.",
  meta: {
    prng: {
      algorithm: "xoshiro128++ (Vigna 2019)",
      reference: "https://prng.di.unimi.it/xoshiro128plusplus.c",
      state_words: 4,
      state_word_bits: 32,
      output_bits: 32,
    },
    seeding: {
      algorithm: "SplitMix64 (Vigna)",
      reference: "https://prng.di.unimi.it/splitmix64.c",
      convention:
        "From a u64 seed, call SplitMix64 twice. Split each output u64 " +
        "into [low32, high32]. The xoshiro128++ state is " +
        "[low(z1), high(z1), low(z2), high(z2)].",
    },
  },
  splitmix64_init: genSplitMix64InitCases(),
  prng: genPrngCases(),
};

const qtJson = {
  spec: "Pointsman Quantizer engine conformance vectors",
  generated_by: "scripts/gen-test-vectors.mjs",
  generator_note:
    "Re-run scripts/gen-test-vectors.mjs to regenerate. Do not hand-edit.",
  meta: {
    scale_intervals: SCALE_INTERVALS,
    chromatic_half: {
      note:
        "chromatic-half is the identity-passthrough sentinel. " +
        "buildScalePitches returns [0..127]; snapToScale is a no-op.",
    },
    snap_rule: {
      definition:
        "Returns the scale pitch nearest to note. Tie-breaking: when " +
        "abs(note - lower) == abs(upper - note), return the lower pitch " +
        "(round down).",
    },
    chord_mode_rule: {
      definition:
        "snapToChordTones(note, chordPcs, scalePitches, tolerance=2): " +
        "snap note to nearest chord-tone MIDI pitch (chord PCs expanded " +
        "across the full 0..127 MIDI range); if the distance to that " +
        "nearest chord tone is <= tolerance, return it; otherwise fall " +
        "back to snapToScale(note, scalePitches). Empty chord PCs " +
        "degenerate to plain scale-snap. Mirrors inboil " +
        "generative.ts:286-338.",
    },
    harmony_mode_rule: {
      definition:
        "diatonicShift(note, interval, direction, scalePitches): snap " +
        "note to nearest scale pitch (tie → lower per snap_rule), then " +
        "advance interval-1 scale steps in direction (above|below). " +
        "Clamps at scalePitches[0] / scalePitches[last] rather than " +
        "wrapping. interval=N is N-1 steps (3rd = 2 steps, 4th = 3, " +
        "5th = 4, 6th = 5). Mirrors inboil generative.ts:235-254.",
    },
  },
  build_scale_pitches: genBuildScalePitchesCases(),
  snap_to_scale: genSnapToScaleCases(),
  snap_to_chord_tones: genSnapToChordTonesCases(),
  diatonic_shift: genDiatonicShiftCases(),
};

writeFileSync(OUT_RNG, JSON.stringify(rngJson, null, 2) + "\n");
writeFileSync(OUT_QT, JSON.stringify(qtJson, null, 2) + "\n");

console.log(`wrote ${OUT_RNG}`);
console.log(`wrote ${OUT_QT}`);
console.log(`rng sections: prng=${rngJson.prng.length}, splitmix=${rngJson.splitmix64_init.length}`);
console.log(`qt sections: build=${qtJson.build_scale_pitches.length}, snap=${qtJson.snap_to_scale.length}, chord=${qtJson.snap_to_chord_tones.length}, harmony=${qtJson.diatonic_shift.length}`);
