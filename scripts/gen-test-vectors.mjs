// scripts/gen-test-vectors.mjs
//
// Generates docs/ai/turing-test-vectors.json and
// docs/ai/quantizer-test-vectors.json per ADR 001.
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
const OUT_TM = join(REPO, "docs/ai/turing-test-vectors.json");
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

// Seeding convention (CANONICAL — see meta in turing-test-vectors.json):
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
// TM ops mirroring ADR 001
// ============================================================

function maskBits(length) {
  if (length >= 32) return 0xffffffff;
  return ((1 << length) - 1) >>> 0;
}

// Threshold for u32-space probability comparison.
//   rawU32 < threshold  ⇔  (rawU32 / 2^32) < probability
// Boundary: probability=0 → threshold=0 (no rawU32 satisfies, never)
//           probability=1 → threshold=2^32 (every rawU32 satisfies, always)
function probabilityThreshold(p) {
  if (p <= 0) return 0;
  if (p >= 1) return 0x100000000;
  return Math.floor(p * 0x100000000);
}

// One xoshiro draw, low `length` bits → register. Documented convention.
function createRegister(length, s) {
  const r = xoshiroNext(s);
  return { register: (r.value & maskBits(length)) >>> 0, state: r.state };
}

function shiftAndFlip(register, length, lock, s) {
  const tail = register & 1;
  const draw = xoshiroNext(s);
  const threshold = probabilityThreshold(1 - lock);
  const flip = draw.value < threshold;
  const writeBit = flip ? (tail ^ 1) : tail;
  const shifted = register >>> 1;
  const result = (shifted | (writeBit << (length - 1))) & maskBits(length);
  return {
    register: result >>> 0,
    state: draw.state,
    rng_draw_u32: draw.value,
    flipped: flip,
  };
}

function shiftAndForce(register, length, forceBit) {
  const shifted = register >>> 1;
  const result = (shifted | ((forceBit & 1) << (length - 1))) & maskBits(length);
  return result >>> 0;
}

function registerToFraction(register, length) {
  const den = length >= 32 ? 0xffffffff : (((1 << length) - 1) >>> 0);
  return { num: register, den };
}

function mapToNote(num, den, lo, hi) {
  // floor(lo + (num/den) × (hi - lo + 1)), clamped to hi
  const span = hi - lo + 1;
  const offset = Math.floor((num * span) / den);
  return Math.min(lo + offset, hi);
}

function tmStep(state, params) {
  // state: { register, rng }
  // params: { length, lock, density, range: [lo, hi] }
  const f = registerToFraction(state.register, params.length);
  const note = mapToNote(f.num, f.den, params.range[0], params.range[1]);
  const dDraw = xoshiroNext(state.rng);
  const dThreshold = probabilityThreshold(params.density);
  const active = dDraw.value < dThreshold;
  const sf = shiftAndFlip(state.register, params.length, params.lock, dDraw.state);
  return {
    state: { register: sf.register, rng: sf.state },
    output: { note, active },
  };
}

// ============================================================
// QT ops mirroring ADR 001
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

// Reference impl of stencil's chord-mode helper. Mirrors inboil
// generative.ts:286-338 quantizeChordMode logic (snap-within-tolerance,
// scale fallback) but expands chord PCs across the full 0..127 MIDI
// range — Stencil drops inboil's octaveRange clipping per ADR 003
// §QT scale keyboard ("Stencil QT does not constrain output to a 3-5
// oct band the way inboil's reference UI did").
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

// Reference impl of stencil's harmony-mode helper. Mirrors inboil
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
// TM cases
// ============================================================

const TM_SEEDS = [0n, 1n, 0xdeadbeefn, 0x123456789abcdef0n];

function genSplitMix64InitCases() {
  return TM_SEEDS.map((seed) => {
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
  return TM_SEEDS.map((seed) => {
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

function genRegisterInitCases() {
  // Cover length boundaries: 2 (min), 8 (typical), 16, 31, 32 (max)
  const cases = [];
  for (const seed of TM_SEEDS) {
    for (const length of [2, 8, 16, 31, 32]) {
      const s = xoshiroSeed(seed);
      const r = createRegister(length, s);
      cases.push({
        seed: seedField(seed),
        length,
        register: r.register,
        register_hex: hexU32(r.register),
      });
    }
  }
  return cases;
}

function genRegisterToFractionCases() {
  // Exact rational form num/den. Edge cases: zero, all-ones, alternating.
  const cases = [];
  const samples = [
    [2, 0], [2, 1], [2, 3],
    [8, 0], [8, 1], [8, 0xaa], [8, 0x55], [8, 0xff],
    [16, 0], [16, 0xffff],
    [32, 0], [32, 0xffffffff],
  ];
  for (const [length, register] of samples) {
    const f = registerToFraction(register, length);
    cases.push({
      register,
      register_hex: hexU32(register),
      length,
      fraction: { num: f.num, den: f.den },
    });
  }
  return cases;
}

function genMapToNoteCases() {
  // The fraction is (num/den) ∈ [0, 1]. Cases drive boundary + clamp +
  // single-note range (lo == hi).
  const cases = [
    // fraction = 0 → lo
    { num: 0, den: 1, range: [60, 72], note: 60 },
    // fraction = 1 → hi (clamp)
    { num: 1, den: 1, range: [60, 72], note: 72 },
    // fraction = 1/2 → midpoint (60 + floor(0.5 × 13) = 60 + 6 = 66)
    { num: 1, den: 2, range: [60, 72], note: 66 },
    // fraction = 1/3 → 60 + floor(13/3) = 60 + 4 = 64
    { num: 1, den: 3, range: [60, 72], note: 64 },
    // fraction = 2/3 → 60 + floor(26/3) = 60 + 8 = 68
    { num: 2, den: 3, range: [60, 72], note: 68 },
    // single-note range: lo == hi → always that note
    { num: 0, den: 1, range: [60, 60], note: 60 },
    { num: 1, den: 1, range: [60, 60], note: 60 },
    { num: 7, den: 9, range: [60, 60], note: 60 },
    // full MIDI range
    { num: 0, den: 1, range: [0, 127], note: 0 },
    { num: 1, den: 1, range: [0, 127], note: 127 },
    { num: 1, den: 2, range: [0, 127], note: 64 }, // 0 + floor(128/2) = 64
    // 8-bit register all-ones: num=255, den=255 → fraction=1.0, clamp to hi
    { num: 255, den: 255, range: [60, 72], note: 72 },
    // 8-bit alternating bits: num=170 (0xAA), den=255 → 60 + floor(170*13/255) = 60 + 8 = 68
    { num: 170, den: 255, range: [60, 72], note: 68 },
  ];
  return cases;
}

function genShiftAndFlipCases() {
  // Two regimes:
  //   (A) lock ∈ {0.0, 1.0} — deterministic regardless of draw value
  //   (B) lock ∈ (0,1) — outcome depends on the seeded first draw; we
  //       compute and record the actual draw + outcome
  const cases = [];
  // Regime A: lock = 1.0 (never flip — write tail unchanged)
  for (const [register, length] of [[0xb3, 8], [0x55, 8], [0x00, 8], [0xff, 8], [0x3, 2]]) {
    const r = shiftAndFlip(register, length, 1.0, xoshiroSeed(1n));
    cases.push({
      label: `lock=1.0 register=${hexU32(register)} length=${length} (never flip)`,
      seed: seedField(1n),
      register,
      register_hex: hexU32(register),
      length,
      lock: 1.0,
      register_after: r.register,
      register_after_hex: hexU32(r.register),
      rng_draw_u32: r.rng_draw_u32,
      rng_draw_hex: hexU32(r.rng_draw_u32),
      flipped: r.flipped,
    });
  }
  // Regime A: lock = 0.0 (always flip — write tail XOR 1)
  for (const [register, length] of [[0xb3, 8], [0x55, 8], [0x00, 8], [0xff, 8], [0x3, 2]]) {
    const r = shiftAndFlip(register, length, 0.0, xoshiroSeed(1n));
    cases.push({
      label: `lock=0.0 register=${hexU32(register)} length=${length} (always flip)`,
      seed: seedField(1n),
      register,
      register_hex: hexU32(register),
      length,
      lock: 0.0,
      register_after: r.register,
      register_after_hex: hexU32(r.register),
      rng_draw_u32: r.rng_draw_u32,
      rng_draw_hex: hexU32(r.rng_draw_u32),
      flipped: r.flipped,
    });
  }
  // Regime B: intermediate lock — draw-dependent. Exercises the comparison.
  for (const seed of [1n, 0xdeadbeefn]) {
    for (const lock of [0.25, 0.5, 0.75]) {
      const r = shiftAndFlip(0xb3, 8, lock, xoshiroSeed(seed));
      cases.push({
        label: `lock=${lock} register=0xb3 length=8 seed=${hexU64(seed)}`,
        seed: seedField(seed),
        register: 0xb3,
        register_hex: hexU32(0xb3),
        length: 8,
        lock,
        register_after: r.register,
        register_after_hex: hexU32(r.register),
        rng_draw_u32: r.rng_draw_u32,
        rng_draw_hex: hexU32(r.rng_draw_u32),
        flipped: r.flipped,
      });
    }
  }
  // length=32 boundary case under lock=0
  {
    const reg = 0xdeadbeef >>> 0;
    const r = shiftAndFlip(reg, 32, 0.0, xoshiroSeed(1n));
    cases.push({
      label: `lock=0.0 register=0xdeadbeef length=32 (mask boundary)`,
      seed: seedField(1n),
      register: reg,
      register_hex: hexU32(reg),
      length: 32,
      lock: 0.0,
      register_after: r.register,
      register_after_hex: hexU32(r.register),
      rng_draw_u32: r.rng_draw_u32,
      rng_draw_hex: hexU32(r.rng_draw_u32),
      flipped: r.flipped,
    });
  }
  return cases;
}

function genShiftAndForceCases() {
  const cases = [];
  // length=8: noteOn (force=1) and noteOff (force=0) on assorted registers
  for (const register of [0x00, 0xff, 0xb3, 0x55, 0xaa]) {
    for (const forceBit of [0, 1]) {
      const r = shiftAndForce(register, 8, forceBit);
      cases.push({
        label: `register=${hexU32(register)} length=8 force=${forceBit}`,
        register,
        register_hex: hexU32(register),
        length: 8,
        force_bit: forceBit,
        register_after: r,
        register_after_hex: hexU32(r),
      });
    }
  }
  // length=2 boundary
  for (const register of [0b00, 0b01, 0b10, 0b11]) {
    for (const forceBit of [0, 1]) {
      const r = shiftAndForce(register, 2, forceBit);
      cases.push({
        label: `register=${register} length=2 force=${forceBit}`,
        register,
        register_hex: hexU32(register),
        length: 2,
        force_bit: forceBit,
        register_after: r,
        register_after_hex: hexU32(r),
      });
    }
  }
  // length=32 boundary
  {
    const r = shiftAndForce(0xffffffff, 32, 0);
    cases.push({
      label: `register=0xffffffff length=32 force=0`,
      register: 0xffffffff,
      register_hex: hexU32(0xffffffff),
      length: 32,
      force_bit: 0,
      register_after: r,
      register_after_hex: hexU32(r),
    });
  }
  return cases;
}

function genTmStepCases() {
  const cases = [];
  const scenarios = [
    {
      name: "perfect loop (lock=1.0, density=1.0)",
      seed: 1n, length: 8, lock: 1.0, density: 1.0, range: [60, 72], n_steps: 16,
    },
    {
      name: "no lock (lock=0.0) — pure walker",
      seed: 1n, length: 8, lock: 0.0, density: 1.0, range: [60, 72], n_steps: 16,
    },
    {
      name: "intermediate lock (0.5)",
      seed: 1n, length: 8, lock: 0.5, density: 1.0, range: [60, 72], n_steps: 16,
    },
    {
      name: "density=0 — every step inactive, register still evolves",
      seed: 1n, length: 8, lock: 0.5, density: 0.0, range: [60, 72], n_steps: 8,
    },
    {
      name: "density=0.5 — half of steps active (probabilistically)",
      seed: 0xdeadbeefn, length: 8, lock: 0.95, density: 0.5, range: [60, 72], n_steps: 16,
    },
    {
      name: "single-note range — note always == lo (= hi)",
      seed: 1n, length: 8, lock: 0.5, density: 1.0, range: [60, 60], n_steps: 8,
    },
    {
      name: "length=2 minimum",
      seed: 1n, length: 2, lock: 0.5, density: 1.0, range: [60, 67], n_steps: 8,
    },
    {
      name: "length=32 maximum",
      seed: 1n, length: 32, lock: 0.95, density: 1.0, range: [0, 127], n_steps: 8,
    },
  ];
  for (const sc of scenarios) {
    const initialRng = xoshiroSeed(sc.seed);
    const init = createRegister(sc.length, initialRng);
    let state = { register: init.register, rng: init.state };
    const params = { length: sc.length, lock: sc.lock, density: sc.density, range: sc.range };
    const trace = [];
    for (let i = 0; i < sc.n_steps; i++) {
      const before = state;
      const r = tmStep(state, params);
      trace.push({
        step: i,
        register_in: before.register,
        register_in_hex: hexU32(before.register),
        note: r.output.note,
        active: r.output.active,
        register_out: r.state.register,
        register_out_hex: hexU32(r.state.register),
      });
      state = r.state;
    }
    cases.push({
      name: sc.name,
      seed: seedField(sc.seed),
      length: sc.length,
      lock: sc.lock,
      density: sc.density,
      range: sc.range,
      n_steps: sc.n_steps,
      initial_register: init.register,
      initial_register_hex: hexU32(init.register),
      trace,
    });
  }
  return cases;
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
  // C major: 63 (D#) → distance to D=62 is 1, to E=64 is 1 → tie → lower=62
  // To avoid tie, pick a note where distance is asymmetric.
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
  // C pentatonic: 5.5 isn't integer, but 11 — distance to 9 is 2, to 12 is 1 → 12 (no tie)
  // For pentatonic tie: pitches 0,2,4,7,9 — pick midpoint of (4,7) = 5.5; integer 5 is closer to 4 (dist 1 vs 2). Try (9,12) midpoint = 10.5; integer 10 has dist 1 to 9, dist 2 to 12 → 9. Pentatonic doesn't yield clean integer ties between adjacent pitches at distance 3 (gap 0,2,4,7,9 has gaps of 3 only between 4↔7). 4 and 7: midpoint 5.5, no integer tie.
  // Use C major: 70 (Bb) → dist to 69 is 1, to 71 is 1 → 69
  cases.push({
    label: "C major: 70 (Bb) tie between 69/71 → 69 (round down)",
    note: 70, scale: "major", root: 0,
    expected: snapToScale(70, cMajor),
  });

  // ---- below all pitches ----
  // B major (root=11): pitches start at note 1 (pitch class B not in root=11... wait pitch classes are {11,1,3,4,6,8,10}, so 0 is NOT in scale, pitches[0] = 1).
  cases.push({
    label: "B major: 0 below pitches[0]=1 → 1",
    note: 0, scale: "major", root: 11,
    expected: snapToScale(0, bMajor),
  });

  // ---- above all pitches ----
  // C# major (root=1): pitch classes {1,3,5,6,8,10,0}, so 7 (G) not in scale.
  // 127 % 12 = 7 → not in scale; max pitch is the largest n ≤ 127 with n%12 ∈ scale set.
  // Compute and assert.
  cases.push({
    label: "C# major: 127 above max → snaps to max",
    note: 127, scale: "major", root: 1,
    expected: snapToScale(127, cSharpMajor),
    max_pitch: cSharpMajor[cSharpMajor.length - 1],
  });

  // ---- edge: 0 and 127 inputs against C major (which contains 0 and 127? 127%12=7, G is in C major; 0%12=0, C is in C major) ----
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
  //       This is the "14 scale × inboil-reference output" matrix per
  //       ADR 003 §Implementation checklist: QT quantize mode + chord/harmony.
  //   (b) Empty-chord PCs at root=0 / major scale: the falls-back-to-scale
  //       degenerate case explicitly exercised.
  //   (c) Tolerance-boundary cases: input at exactly tolerance distance,
  //       at tolerance+1, with the default tolerance=2.
  //   (d) Custom tolerance: same input, widened tolerance pulls the
  //       chord branch in instead of falling through.
  //
  // Each case carries a `label` (human reason) and the chord-tones
  // selected. `expected` is computed by the reference snapToChordTones
  // above, which mirrors inboil generative.ts:286-338 with stencil's
  // documented full-range semantics.
  const cases = [];

  for (const scale of Object.keys(SCALE_INTERVALS)) {
    if (scale === "chromatic-half") continue; // handled separately
    const intervals = SCALE_INTERVALS[scale];
    // "I chord" = first three scale degrees as PCs (root, 3rd, 5th of
    // the diatonic stack). For pentatonic / blues / whole-tone, this
    // still yields a triad even if it's not a tertian one — the point
    // is to exercise the algorithm with a chord PC set drawn from the
    // scale itself.
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
    // (a2) input one semitone above the root chord-PC: within tolerance,
    //      snaps to the chord tone.
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
    // (a3) input far from any chord tone: with a 1-PC chord (just the
    //      root) and an input 5 semitones up, no chord tone is within 2;
    //      falls back to scale-snap. Use a single-PC chord for this case
    //      so the gap is large enough to force the fallback regardless
    //      of which 3-PC chord shape the scale has.
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
  // C major triad C-E-G = PCs [0,4,7]. Input 62 is dist 2 from C(60) and
  // dist 2 from E(64). Both within tolerance; snapToScale tie picks
  // lower → 60.
  cases.push({
    label: "C major triad [0,4,7]: input=62 (dist 2 to C and 2 to E) → tie → 60 (lower)",
    note: 62,
    scale: "major",
    root: 0,
    chord_pcs: [0, 4, 7],
    tolerance: 2,
    expected: snapToChordTones(62, [0, 4, 7], cMajor),
  });
  // Same chord, input 70 — distance to nearest chord tone (72) is 2,
  // exactly at tolerance. snaps in.
  cases.push({
    label: "C major triad [0,4,7]: input=70 (dist 2 to C8=72) → at tolerance → snap to 72",
    note: 70,
    scale: "major",
    root: 0,
    chord_pcs: [0, 4, 7],
    tolerance: 2,
    expected: snapToChordTones(70, [0, 4, 7], cMajor),
  });
  // Single-PC chord [0] with input 63: distance 3 to nearest chord tone (60),
  // beyond tolerance=2, falls back to scale-snap. snapToScale(63, cMajor) →
  // tie 62/64 → 62.
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

  // (e) Non-zero root: D major (root=2) triad D-F#-A → PCs [2,6,9].
  //     Input 64 (E) is dist 2 from D(62) and dist 2 from F#(66) — tie → 62.
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
  //       below. Exercises the full 4×2 × 14 scales matrix at one root
  //       (~112 cases) — the per-scale ladder is the key regression
  //       discipline (interval semantics depend on scale shape).
  //   (b) Out-of-scale input (snapped to nearest scale degree first).
  //   (c) Top-of-scale clamp: input at the highest scale pitch shifted
  //       up clamps at scalePitches[length-1], does not wrap.
  //   (d) Bottom-of-scale clamp: shift below scalePitches[0] clamps at
  //       scalePitches[0].
  //   (e) Non-zero root: D major shift to verify root-relative behavior.
  const cases = [];

  for (const scale of Object.keys(SCALE_INTERVALS)) {
    if (scale === "chromatic-half") continue; // identity passthrough
    const scalePitches = buildScalePitches(scale, 0);
    // Pick an input near MIDI middle that's guaranteed in-scale: the
    // scale's lowest pitch class at MIDI octave 5. For every scale at
    // root=0, scalePitches always contains 60 (PC 0 ⇔ root) since
    // every interval list starts with 0.
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

  // (b) Out-of-scale input. C major scale (C D E F G A B) doesn't
  // contain D# (63). diatonicShift snaps 63 to nearest scale pitch
  // first: tie 62/64 → 62 (D); then 3rd above D = F (65).
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

  // (c) Top-of-scale clamp. C major's last pitch is 127 (G8). 6th above
  // 127 wants index +5 past the array end; clamps at scalePitches[last].
  cases.push({
    label: "C major: 6th↑ from MIDI 127 (top of scale) → clamps at top",
    note: 127,
    scale: "major",
    root: 0,
    interval: 6,
    direction: "above",
    expected: diatonicShift(127, 6, "above", cMajor),
  });

  // (d) Bottom-of-scale clamp. C major's first pitch is 0 (C-1).
  // 6th below 0 wants index -5 (negative); clamps at scalePitches[0].
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
  // Input 62 (D) is in scale; 5th above D (4 scale steps) = A = MIDI 69.
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

const tmJson = {
  spec: "ADR 001 Turing Machine engine conformance vectors",
  generated_by: "scripts/gen-test-vectors.mjs",
  generator_note:
    "Re-run scripts/gen-test-vectors.mjs to regenerate. Do not hand-edit. " +
    "This file is the cross-target spec — both m4l/engine and vst/Source " +
    "engines must produce values that match these cases bit-for-bit.",
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
    create_register: {
      convention:
        "One xoshiro128++ draw; the low `length` bits of the resulting u32 " +
        "form the initial register. Bits at positions ≥ length are masked " +
        "to zero. This consumes a single PRNG step regardless of length.",
    },
    flip_decision: {
      rule:
        "Draw u32 from xoshiro128++. flip ⇔ rawU32 < threshold where " +
        "threshold = floor((1 - lock) × 2^32). lock=1 → threshold=0 (never " +
        "flip); lock=0 → threshold=2^32 (always flip). Comparison done in " +
        "u32 space to avoid float-rounding divergence between targets.",
    },
    density_decision: {
      rule:
        "Draw u32 from xoshiro128++ before the flip draw. active ⇔ rawU32 < " +
        "threshold where threshold = floor(density × 2^32). density=0 → " +
        "threshold=0 (never active); density=1 → threshold=2^32 (always " +
        "active).",
    },
    tm_step: {
      draw_order: "density_draw_first, then flip_draw",
      output_ordering:
        "register is read for the output note BEFORE shiftAndFlip mutates " +
        "it. Step n's emitted note reflects register state at the start " +
        "of step n.",
    },
  },
  splitmix64_init: genSplitMix64InitCases(),
  prng: genPrngCases(),
  register_init: genRegisterInitCases(),
  register_to_fraction: genRegisterToFractionCases(),
  map_to_note: genMapToNoteCases(),
  shift_and_flip: genShiftAndFlipCases(),
  shift_and_force: genShiftAndForceCases(),
  tm_step: genTmStepCases(),
};

const qtJson = {
  spec: "ADR 001 Quantizer engine conformance vectors",
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
        "across the full 0..127 MIDI range — Stencil drops inboil's " +
        "octaveRange clipping per ADR 003 §QT scale keyboard); if the " +
        "distance to that nearest chord tone is <= tolerance, return " +
        "it; otherwise fall back to snapToScale(note, scalePitches). " +
        "Empty chord PCs degenerate to plain scale-snap. Mirrors inboil " +
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

writeFileSync(OUT_TM, JSON.stringify(tmJson, null, 2) + "\n");
writeFileSync(OUT_QT, JSON.stringify(qtJson, null, 2) + "\n");

console.log(`wrote ${OUT_TM}`);
console.log(`wrote ${OUT_QT}`);
console.log(`tm sections: prng=${tmJson.prng.length}, splitmix=${tmJson.splitmix64_init.length}, ` +
  `register_init=${tmJson.register_init.length}, fraction=${tmJson.register_to_fraction.length}, ` +
  `map=${tmJson.map_to_note.length}, flip=${tmJson.shift_and_flip.length}, ` +
  `force=${tmJson.shift_and_force.length}, step=${tmJson.tm_step.length}`);
console.log(`qt sections: build=${qtJson.build_scale_pitches.length}, snap=${qtJson.snap_to_scale.length}, chord=${qtJson.snap_to_chord_tones.length}, harmony=${qtJson.diatonic_shift.length}`);
