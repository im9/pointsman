import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BLACK_KEY_HEIGHT_RATIO,
  BLACK_KEY_WIDTH_RATIO,
  DOT_INSET_RATIO,
  DOT_RADIUS_RATIO,
  NUM_PITCH_CLASSES,
  PULSE_DECAY_MS,
  WHITE_KEYS_PER_OCTAVE,
  addPulse,
  computeGeometry,
  createModel,
  dotCenterAt,
  hitTest,
  isBlackKey,
  keyBoundsAt,
  recomputeInScale,
  setScale,
  updatePulses,
} from "./scaleKeyboard.logic.ts";
import type { ScaleName } from "../../engine/quantizer.ts";

const ALL_SCALES: ScaleName[] = [
  "major",
  "minor",
  "dorian",
  "phrygian",
  "lydian",
  "mixolydian",
  "locrian",
  "pentatonic",
  "minor-pentatonic",
  "blues",
  "harmonic",
  "melodic",
  "whole",
  "chromatic",
  "chromatic-half",
  "phrygian-dominant",
];

// ---- recomputeInScale -----------------------------------------------------

test("recomputeInScale — C major picks 0,2,4,5,7,9,11", () => {
  // Major intervals from quantizer.ts SCALE_INTERVALS: [0,2,4,5,7,9,11].
  // Root=0 (C), so the in-scale set is exactly those pitch classes.
  const inScale = recomputeInScale("major", 0);
  const expected = [true, false, true, false, true, true, false, true, false, true, false, true];
  assert.deepEqual(inScale, expected);
});

test("recomputeInScale — G major picks 7,9,11,0,2,4,6", () => {
  // Major intervals shifted by root=7: {7,9,11,0,2,4,6} mod 12. Confirms
  // the modulo wrap when (root + interval) >= 12.
  const inScale = recomputeInScale("major", 7);
  const expected = [true, false, true, false, true, false, true, true, false, true, false, true];
  assert.deepEqual(inScale, expected);
});

test("recomputeInScale — C natural minor picks 0,2,3,5,7,8,10", () => {
  // Minor intervals: [0,2,3,5,7,8,10]. Different shape than major; verifies
  // the renderer reads the right scale name (not just root rotation of major).
  const inScale = recomputeInScale("minor", 0);
  const expected = [true, false, true, true, false, true, false, true, true, false, true, false];
  assert.deepEqual(inScale, expected);
});

test("recomputeInScale — chromatic returns all true", () => {
  // Chromatic = all 12 pitch classes. Renders every key with a filled dot.
  assert.deepEqual(recomputeInScale("chromatic", 0), new Array(12).fill(true));
});

test("recomputeInScale — chromatic-half returns all true", () => {
  // chromatic-half is the engine's "no quantization" mode (every MIDI note
  // is in-scale). Keyboard treats it identically to chromatic for display.
  assert.deepEqual(recomputeInScale("chromatic-half", 0), new Array(12).fill(true));
});

test("recomputeInScale — whole tone has 6 in-scale pitches at 0,2,4,6,8,10", () => {
  // Whole-tone scale: alternating semitones. Visual sanity check that
  // 6-pitch scales (whole, also blues/pentatonic) round-trip through the
  // boolean array correctly.
  const inScale = recomputeInScale("whole", 0);
  const expected = [true, false, true, false, true, false, true, false, true, false, true, false];
  assert.deepEqual(inScale, expected);
});

test("recomputeInScale — pentatonic at root 0 picks 0,2,4,7,9", () => {
  // Pentatonic intervals: [0,2,4,7,9] — 5 pitches. The visible "spread" on
  // the keyboard (not all consecutive) is the most informative pattern for
  // a player.
  const inScale = recomputeInScale("pentatonic", 0);
  const expected = [true, false, true, false, true, false, false, true, false, true, false, false];
  assert.deepEqual(inScale, expected);
});

test("recomputeInScale — every scale produces a length-12 boolean array", () => {
  // Crash-safety pass: any of the 15 ScaleName values must be accepted and
  // return a fixed-length array. If a scale is missed in the quantizer
  // engine's SCALE_INTERVALS table we want to fail fast here, not in jsui.
  for (const scale of ALL_SCALES) {
    const inScale = recomputeInScale(scale, 0);
    assert.equal(inScale.length, NUM_PITCH_CLASSES, `scale=${scale}`);
    for (const v of inScale) {
      assert.equal(typeof v, "boolean", `scale=${scale}`);
    }
  }
});

test("recomputeInScale — all 12 root values are accepted", () => {
  // Sanity: the bridge constrains root to 0..11, but the logic layer must
  // handle every value in that range without error.
  for (let root = 0; root < 12; root++) {
    const inScale = recomputeInScale("major", root);
    assert.equal(inScale.length, 12);
    // Major has 7 in-scale pitches regardless of root.
    const trueCount = inScale.filter(Boolean).length;
    assert.equal(trueCount, 7, `root=${root}`);
  }
});

// ---- createModel ----------------------------------------------------------

test("createModel — initializes inScale from the given scale/root", () => {
  // Constructor convenience: build the initial inScale once so the renderer
  // doesn't need to call recomputeInScale separately on first paint.
  const m = createModel("major", 0);
  assert.deepEqual(m.inScale, recomputeInScale("major", 0));
});

test("createModel — pulses starts empty", () => {
  // No initial pulse (the keyboard idles dark until the first noteOut).
  const m = createModel("major", 0);
  assert.deepEqual(m.pulses, []);
});

// ---- setScale -------------------------------------------------------------

test("setScale — updates inScale to match new scale/root", () => {
  // Bridge emits `scaleChanged` on scale or root change; the renderer calls
  // setScale, which must refresh the dot pattern.
  const m = createModel("major", 0);
  const next = setScale(m, "minor", 0);
  assert.deepEqual(next.inScale, recomputeInScale("minor", 0));
});

test("setScale — preserves active pulses", () => {
  // Changing scale mid-pulse shouldn't clobber the visual decay; pulses
  // continue glowing on whichever pitch class they targeted.
  const m0 = createModel("major", 0);
  const m1 = addPulse(m0, 5, 100);
  const m2 = setScale(m1, "minor", 0);
  assert.equal(m2.pulses.length, 1);
  assert.equal(m2.pulses[0].pitchClass, 5);
});

test("setScale — does not mutate input model", () => {
  // Immutability discipline: the renderer relies on it for
  // redraw-comparison and prior-frame safety.
  const m = createModel("major", 0);
  const before = m.inScale.slice();
  setScale(m, "minor", 0);
  assert.deepEqual(m.inScale, before);
});

// ---- addPulse -------------------------------------------------------------

test("addPulse — appends a pulse with pitchClass and intensity from velocity", () => {
  // Velocity 127 → max intensity 1.0. The /127 normalization happens in
  // logic so the renderer just maps intensity → alpha.
  const m = createModel("major", 0);
  const next = addPulse(m, 7, 127);
  assert.equal(next.pulses.length, 1);
  assert.equal(next.pulses[0].pitchClass, 7);
  assert.equal(next.pulses[0].intensity, 1);
  assert.equal(next.pulses[0].ageMs, 0);
});

test("addPulse — velocity 64 → intensity ~0.504 (64/127)", () => {
  // Mid-velocity sanity: linear normalization. 64/127 = 0.5039... — the
  // exact value matters because the renderer maps it to alpha and the eye
  // notices small bumps in glow brightness.
  const m = createModel("major", 0);
  const next = addPulse(m, 0, 64);
  assert.ok(Math.abs(next.pulses[0].intensity - 64 / 127) < 1e-9);
});

test("addPulse — velocity 0 is ignored (no pulse appended)", () => {
  // velocity=0 is a noteOff convention in MIDI. Emitting a 0-intensity
  // pulse would add work for the renderer to immediately decay — skip.
  const m = createModel("major", 0);
  const next = addPulse(m, 5, 0);
  assert.equal(next.pulses.length, 0);
});

test("addPulse — velocity above 127 clamps to intensity 1", () => {
  // Defensive: the bridge's velocity field comes from humanize, which is
  // clamped to 0..127, but a stray large value shouldn't make intensity > 1.
  const m = createModel("major", 0);
  const next = addPulse(m, 5, 255);
  assert.equal(next.pulses[0].intensity, 1);
});

test("addPulse — out-of-range pitchClass is ignored", () => {
  // Pitch class is 0..11 by definition. -1 / 12 / NaN should no-op rather
  // than corrupt the renderer's keyBoundsAt lookup.
  const m = createModel("major", 0);
  assert.equal(addPulse(m, -1, 100).pulses.length, 0);
  assert.equal(addPulse(m, 12, 100).pulses.length, 0);
  assert.equal(addPulse(m, 1.5, 100).pulses.length, 0);
  assert.equal(addPulse(m, NaN, 100).pulses.length, 0);
});

test("addPulse — multiple pulses on different pitch classes stack", () => {
  // ADR §scale keyboard: "Pulses stack visually (the most recent
  // dominates)." The model preserves all of them; the renderer picks how
  // to combine when drawing.
  let m = createModel("major", 0);
  m = addPulse(m, 0, 100);
  m = addPulse(m, 4, 100);
  m = addPulse(m, 7, 100);
  assert.equal(m.pulses.length, 3);
  assert.deepEqual(
    m.pulses.map((p) => p.pitchClass),
    [0, 4, 7],
  );
});

test("addPulse — multiple pulses on the same pitch class also stack", () => {
  // Repeated note re-triggers: a fast trill should accumulate pulses on
  // one key, not collapse to a single fixed-intensity glow.
  let m = createModel("major", 0);
  m = addPulse(m, 5, 80);
  m = addPulse(m, 5, 100);
  assert.equal(m.pulses.length, 2);
});

test("addPulse — does not mutate input model", () => {
  const m = createModel("major", 0);
  addPulse(m, 5, 100);
  assert.equal(m.pulses.length, 0);
});

// ---- updatePulses ---------------------------------------------------------

test("updatePulses — half PULSE_DECAY_MS halves intensity (linear decay)", () => {
  // Linear decay model: intensity(age) = max(0, intensity_0 * (1 - age/PULSE_DECAY_MS)).
  // Simpler than exponential and more predictable for visual verification —
  // pulse fully fades in exactly PULSE_DECAY_MS.
  const m0 = createModel("major", 0);
  const m1 = addPulse(m0, 5, 127); // intensity 1.0
  const m2 = updatePulses(m1, PULSE_DECAY_MS / 2);
  assert.equal(m2.pulses.length, 1);
  assert.ok(Math.abs(m2.pulses[0].intensity - 0.5) < 1e-9, `got ${m2.pulses[0].intensity}`);
  assert.equal(m2.pulses[0].ageMs, PULSE_DECAY_MS / 2);
});

test("updatePulses — linear decay holds across multi-tick decomposition", () => {
  // Linear decay (per the public contract on PULSE_DECAY_MS / Pulse) means
  // intensity(age) = intensity_0 * (1 - age/PULSE_DECAY_MS). The single-tick
  // half-decay test above passes regardless of how the decay is recomputed
  // each tick; this test pins the contract under multi-tick decomposition,
  // where a "current intensity × (1 - new-age/decay)" recurrence quietly
  // multiplies through and yields exponential decay.
  //
  // Two ticks of dt = decay/4 (= 62.5 ms) each → cumulative age = decay/2,
  // expected intensity exactly 0.5. A buggy recurrence would give
  //   1.0 * (1 - 62.5/250) * (1 - 125/250) = 0.75 * 0.5 = 0.375.
  // Tolerance: 1e-9 is plenty for the linear formula evaluated at exact
  // rational points; widen only if floating-point shows up here.
  const m0 = createModel("major", 0);
  let m = addPulse(m0, 5, 127); // intensity_0 = 1.0
  m = updatePulses(m, PULSE_DECAY_MS / 4);
  m = updatePulses(m, PULSE_DECAY_MS / 4);
  assert.equal(m.pulses.length, 1);
  assert.ok(
    Math.abs(m.pulses[0].intensity - 0.5) < 1e-9,
    `expected 0.5, got ${m.pulses[0].intensity}`,
  );
  assert.equal(m.pulses[0].ageMs, PULSE_DECAY_MS / 2);
});

test("updatePulses — pulse drops out at age >= PULSE_DECAY_MS", () => {
  // Decayed pulses must be pruned so the array stays bounded under a
  // continuous note stream. (At 16th notes / 120 BPM, ~8 noteOuts per
  // PULSE_DECAY_MS — without pruning the list grows linearly with time.)
  const m0 = createModel("major", 0);
  const m1 = addPulse(m0, 5, 127);
  const m2 = updatePulses(m1, PULSE_DECAY_MS);
  assert.equal(m2.pulses.length, 0);
});

test("updatePulses — partial decay then full decay drops the pulse", () => {
  // Two-step decay across multiple frames: the renderer calls updatePulses
  // every animation frame with the elapsed dtMs. Verify the cumulative
  // ageMs threshold holds, not just a single big tick.
  const m0 = createModel("major", 0);
  let m = addPulse(m0, 5, 127);
  m = updatePulses(m, PULSE_DECAY_MS * 0.6);
  assert.equal(m.pulses.length, 1);
  m = updatePulses(m, PULSE_DECAY_MS * 0.5);
  assert.equal(m.pulses.length, 0);
});

test("updatePulses — empty pulses is a no-op", () => {
  const m = createModel("major", 0);
  const next = updatePulses(m, 16);
  assert.deepEqual(next.pulses, []);
});

test("updatePulses — dtMs <= 0 leaves pulses unchanged", () => {
  // First-frame edge: jsui can call updatePulses with dt=0 between paints
  // when the timer fires faster than the model changes. Negative is
  // defensive — clock skew or paused-then-resumed could produce it.
  const m0 = createModel("major", 0);
  const m1 = addPulse(m0, 5, 127);
  const m2 = updatePulses(m1, 0);
  assert.equal(m2.pulses[0].ageMs, 0);
  assert.equal(m2.pulses[0].intensity, 1);
  const m3 = updatePulses(m1, -50);
  assert.equal(m3.pulses[0].ageMs, 0);
  assert.equal(m3.pulses[0].intensity, 1);
});

test("updatePulses — different pulses decay independently by their own age", () => {
  // Each pulse carries its own ageMs; one added at t=0 and another at t=100
  // should not finish decaying at the same moment.
  let m = createModel("major", 0);
  m = addPulse(m, 0, 127);
  m = updatePulses(m, 100);          // pulse 0 ageMs=100
  m = addPulse(m, 4, 127);            // pulse 1 ageMs=0
  m = updatePulses(m, 100);           // pulse 0 ageMs=200, pulse 1 ageMs=100
  assert.equal(m.pulses.length, 2);
  const byPc = new Map(m.pulses.map((p) => [p.pitchClass, p]));
  assert.equal(byPc.get(0)!.ageMs, 200);
  assert.equal(byPc.get(4)!.ageMs, 100);
});

test("updatePulses — does not mutate input model", () => {
  const m0 = createModel("major", 0);
  const m1 = addPulse(m0, 5, 127);
  const before = m1.pulses[0].ageMs;
  updatePulses(m1, 50);
  assert.equal(m1.pulses[0].ageMs, before);
});

// ---- isBlackKey -----------------------------------------------------------

test("isBlackKey — black keys at 1, 3, 6, 8, 10", () => {
  // Standard piano: C# D# F# G# A#. Used by both logic and renderer to
  // pick stroke / fill style.
  for (const pc of [1, 3, 6, 8, 10]) {
    assert.equal(isBlackKey(pc), true, `pc=${pc}`);
  }
});

test("isBlackKey — white keys at 0, 2, 4, 5, 7, 9, 11", () => {
  for (const pc of [0, 2, 4, 5, 7, 9, 11]) {
    assert.equal(isBlackKey(pc), false, `pc=${pc}`);
  }
});

// ---- computeGeometry ------------------------------------------------------

test("computeGeometry — white keys span the full canvas width", () => {
  // 7 white keys, equal width. The full width of the keyboard area is the
  // canvas width minus zero padding (kept simple in v1).
  const g = computeGeometry(700, 100);
  assert.equal(g.whiteKeyWidth, 100); // 700 / 7
});

test("computeGeometry — black key width is BLACK_KEY_WIDTH_RATIO of white", () => {
  const g = computeGeometry(700, 100);
  assert.ok(Math.abs(g.blackKeyWidth - g.whiteKeyWidth * BLACK_KEY_WIDTH_RATIO) < 1e-9);
});

test("computeGeometry — black key height is BLACK_KEY_HEIGHT_RATIO of white-area height", () => {
  // Black keys are raised: they occupy the top portion of the white-key
  // area. Ratio sets how far down they extend (e.g. 0.6 means the lower
  // 40% of the white area shows pure white between black keys).
  const g = computeGeometry(700, 100);
  assert.ok(Math.abs(g.blackKeyHeight - g.whiteKeyAreaHeight * BLACK_KEY_HEIGHT_RATIO) < 1e-9);
});

test("computeGeometry — white-key area spans the full canvas height", () => {
  // Inboil-style layout: dots are drawn INSIDE each in-scale key, so there
  // is no dedicated bottom strip. White keys take the full canvas height;
  // black keys are still BLACK_KEY_HEIGHT_RATIO of that.
  const g = computeGeometry(700, 100);
  assert.equal(g.whiteKeyAreaHeight, 100);
});

test("computeGeometry — dotRadius is DOT_RADIUS_RATIO of white-key width", () => {
  // Dot radius scales with key width so dots feel proportional at any
  // canvas size. Tied to whiteKeyWidth (not key height) so white and
  // black dots end up the same physical size.
  const g = computeGeometry(700, 100);
  // whiteKeyWidth = 700/7 = 100 → expected radius = 100 * DOT_RADIUS_RATIO.
  assert.ok(Math.abs(g.dotRadius - g.whiteKeyWidth * DOT_RADIUS_RATIO) < 1e-9);
});

test("computeGeometry — dotRadius enforces a minimum so the dot stays visible", () => {
  // For very narrow keyboards (small canvas in a host that resizes the
  // jsui), DOT_RADIUS_RATIO * whiteKeyWidth can fall below 1.5 px and
  // mgraphics will render it as a dot or disappear. Floor at 1.5.
  const g = computeGeometry(70, 20); // whiteKeyWidth=10 → 10*0.08=0.8, clamped to 1.5
  assert.equal(g.dotRadius, 1.5);
});

// ---- keyBoundsAt ----------------------------------------------------------

test("keyBoundsAt — white keys C..B sit left-to-right", () => {
  // C(0) leftmost, B(11) rightmost. Each white key is whiteKeyWidth wide.
  // White-key indices (left to right): C=0, D=1, E=2, F=3, G=4, A=5, B=6.
  const g = computeGeometry(700, 100);
  const whiteOrder: Array<[number, number]> = [
    [0, 0], [2, 1], [4, 2], [5, 3], [7, 4], [9, 5], [11, 6],
  ];
  for (const [pc, whiteIdx] of whiteOrder) {
    const b = keyBoundsAt(pc, g);
    assert.ok(Math.abs(b.x - whiteIdx * g.whiteKeyWidth) < 1e-9, `pc=${pc}`);
    assert.equal(b.w, g.whiteKeyWidth, `pc=${pc}`);
    assert.equal(b.isBlack, false, `pc=${pc}`);
  }
});

test("keyBoundsAt — white keys span the full white-key area height", () => {
  const g = computeGeometry(700, 100);
  for (const pc of [0, 2, 4, 5, 7, 9, 11]) {
    const b = keyBoundsAt(pc, g);
    assert.equal(b.y, 0, `pc=${pc}`);
    assert.equal(b.h, g.whiteKeyAreaHeight, `pc=${pc}`);
  }
});

test("keyBoundsAt — black key C# is centered at the C/D boundary", () => {
  // Black key width is centered on the boundary between adjacent whites:
  // C# between C(white 0) and D(white 1). Boundary x = 1 * whiteKeyWidth.
  const g = computeGeometry(700, 100);
  const b = keyBoundsAt(1, g);
  const expectedX = 1 * g.whiteKeyWidth - g.blackKeyWidth / 2;
  assert.ok(Math.abs(b.x - expectedX) < 1e-9);
  assert.equal(b.w, g.blackKeyWidth);
  assert.equal(b.isBlack, true);
});

test("keyBoundsAt — black keys are at every C/D, D/E, F/G, G/A, A/B boundary", () => {
  // Verifies the black-key x-positions follow standard piano layout.
  // Boundary white-index for each black pitch class: 1→1, 3→2, 6→4, 8→5, 10→6.
  const g = computeGeometry(700, 100);
  const blackBoundary: Array<[number, number]> = [
    [1, 1], [3, 2], [6, 4], [8, 5], [10, 6],
  ];
  for (const [pc, boundaryIdx] of blackBoundary) {
    const b = keyBoundsAt(pc, g);
    const expectedX = boundaryIdx * g.whiteKeyWidth - g.blackKeyWidth / 2;
    assert.ok(Math.abs(b.x - expectedX) < 1e-9, `pc=${pc}`);
  }
});

test("keyBoundsAt — black keys occupy only the top blackKeyHeight portion", () => {
  // Raised black keys: y starts at the top (0), height is blackKeyHeight,
  // so they end above the bottom edge of the white-key area.
  const g = computeGeometry(700, 100);
  for (const pc of [1, 3, 6, 8, 10]) {
    const b = keyBoundsAt(pc, g);
    assert.equal(b.y, 0, `pc=${pc}`);
    assert.equal(b.h, g.blackKeyHeight, `pc=${pc}`);
    assert.ok(b.h < g.whiteKeyAreaHeight, `pc=${pc}`);
  }
});

// ---- dotCenterAt ----------------------------------------------------------

test("dotCenterAt — white-key dot is centered horizontally on the white key", () => {
  // Each in-scale white key gets a single dot at its horizontal center.
  // Verifies all 7 white pitch classes — covers the full octave layout.
  const g = computeGeometry(700, 100);
  for (const pc of [0, 2, 4, 5, 7, 9, 11]) {
    const b = keyBoundsAt(pc, g);
    const d = dotCenterAt(pc, g);
    assert.ok(Math.abs(d.cx - (b.x + b.w / 2)) < 1e-9, `pc=${pc}`);
  }
});

test("dotCenterAt — white-key dot sits DOT_INSET_RATIO above the key bottom", () => {
  // Position formula: cy = key.h * (1 - DOT_INSET_RATIO). Inboil's
  // QuantizerSheet.svelte places the dot 12 px above the bottom of a
  // 100 px white key (~12% inset); we use a single ratio for both colors.
  const g = computeGeometry(700, 100);
  const b = keyBoundsAt(0, g);
  const d = dotCenterAt(0, g);
  assert.ok(Math.abs(d.cy - b.h * (1 - DOT_INSET_RATIO)) < 1e-9);
});

test("dotCenterAt — black-key dot is centered on the black key (not the white-key boundary)", () => {
  // The black-key dot must sit at the center of the black KEY, which is
  // offset by half blackKeyWidth from the white-key boundary. A naive
  // implementation that uses BLACK_BOUNDARY_INDEX directly without the
  // half-width correction would put the dot in the gap between two whites.
  const g = computeGeometry(700, 100);
  for (const pc of [1, 3, 6, 8, 10]) {
    const b = keyBoundsAt(pc, g);
    const d = dotCenterAt(pc, g);
    assert.ok(Math.abs(d.cx - (b.x + b.w / 2)) < 1e-9, `pc=${pc}`);
  }
});

test("dotCenterAt — black-key dot is inside the (shorter) black key", () => {
  // Black keys end at blackKeyHeight; the dot's cy must fall within that
  // height, not below where the black key ends. Equivalent: dot is inset
  // above the black-key bottom by DOT_INSET_RATIO * blackKeyHeight.
  const g = computeGeometry(700, 100);
  const b = keyBoundsAt(1, g);
  const d = dotCenterAt(1, g);
  assert.ok(d.cy < b.h, `expected ${d.cy} < ${b.h}`);
  assert.ok(Math.abs(d.cy - b.h * (1 - DOT_INSET_RATIO)) < 1e-9);
});

test("dotCenterAt — black-key dots sit higher on canvas than white-key dots", () => {
  // The two-row visual separation (the whole point of moving dots into
  // the keys) relies on this: black dots are inside the SHORTER black
  // key, white dots inside the FULL-HEIGHT white key, so the black dots
  // automatically end up higher. If this ever fails, the visual cue
  // collapses and the keyboard becomes ambiguous again.
  const g = computeGeometry(700, 100);
  const dWhite = dotCenterAt(0, g);
  const dBlack = dotCenterAt(1, g);
  assert.ok(dBlack.cy < dWhite.cy, `expected black ${dBlack.cy} < white ${dWhite.cy}`);
});

// ---- hitTest --------------------------------------------------------------
//
// Slice #4 (ADR 003 §scale keyboard): a click anywhere on a key surface
// returns that key's pitch class; black keys overlay white keys in the
// upper blackKeyHeight band, so a click in the black-key column above
// blackKeyHeight returns the black pc; below blackKeyHeight it falls
// through to the white below. Mirrors inboil's tapKey semantics
// (QuantizerSheet.svelte:165-167 — any click on a key counts).
//
// Geometry used in these tests: 700×100 canvas, so whiteKeyWidth=100,
// blackKeyWidth=60 (BLACK_KEY_WIDTH_RATIO=0.6 × 100), blackKeyHeight=60
// (BLACK_KEY_HEIGHT_RATIO=0.6 × 100). White-key indices left to right:
// C=0 [0,100), D=1 [100,200), E=2 [200,300), F=3 [300,400), G=4 [400,500),
// A=5 [500,600), B=6 [600,700). Black-key x-bounds (boundary*100 ± 30):
// C# pc1 [70,130), D# pc3 [170,230), F# pc6 [370,430), G# pc8 [470,530),
// A# pc10 [570,630). All test points are derived from these geometry
// values, not magic numbers.

test("hitTest — white-key center click returns the white pc (lower region)", () => {
  // y=80 is well below blackKeyHeight=60, so black-key overlay does not
  // apply; we should always land on the white below.
  const g = computeGeometry(700, 100);
  // C center x = whiteKeyWidth/2 = 50. y=80 is in white area.
  assert.equal(hitTest(50, 80, g), 0, "C center");
  assert.equal(hitTest(150, 80, g), 2, "D center");
  assert.equal(hitTest(250, 80, g), 4, "E center");
  assert.equal(hitTest(350, 80, g), 5, "F center");
  assert.equal(hitTest(450, 80, g), 7, "G center");
  assert.equal(hitTest(550, 80, g), 9, "A center");
  assert.equal(hitTest(650, 80, g), 11, "B center");
});

test("hitTest — black-key center click in upper region returns the black pc", () => {
  // Black centers are at boundary * whiteKeyWidth (no half-width offset
  // for the center itself). y=30 < blackKeyHeight=60 ⇒ in black overlay.
  const g = computeGeometry(700, 100);
  assert.equal(hitTest(100, 30, g), 1, "C# center (boundary 1)");
  assert.equal(hitTest(200, 30, g), 3, "D# center (boundary 2)");
  assert.equal(hitTest(400, 30, g), 6, "F# center (boundary 4)");
  assert.equal(hitTest(500, 30, g), 8, "G# center (boundary 5)");
  assert.equal(hitTest(600, 30, g), 10, "A# center (boundary 6)");
});

test("hitTest — click in black-key x-bounds but BELOW blackKeyHeight falls through to white", () => {
  // x=110 is inside C# x-bounds [70,130) AND inside D's white column
  // [100,200). y=80 > blackKeyHeight=60 ⇒ black overlay does not apply,
  // so the click is on D (pc 2), the visible part of the white key
  // below the black-key tip.
  const g = computeGeometry(700, 100);
  assert.equal(hitTest(110, 80, g), 2, "below C#, on D's visible lower portion");
  // x=90 is inside C# x-bounds [70,130) AND inside C's white column [0,100).
  assert.equal(hitTest(90, 80, g), 0, "below C#, on C's visible lower portion");
});

test("hitTest — gap-between-black-keys at upper region returns the white below", () => {
  // Between E and F there is no black key (no boundary-3 black). Any
  // point in E or F's column at y < blackKeyHeight should still resolve
  // to the white because no black overlay matches.
  const g = computeGeometry(700, 100);
  // Pick x=250 (E center) and x=350 (F center) at y=10 (top region).
  assert.equal(hitTest(250, 10, g), 4, "E top — no black overlay");
  assert.equal(hitTest(350, 10, g), 5, "F top — no black overlay");
  // Same for B/C boundary at canvas right (no boundary-7 black either).
  assert.equal(hitTest(650, 10, g), 11, "B top — no black overlay");
});

test("hitTest — black-key edges (left/right of bw) hit the black pc", () => {
  // C# bounds [70,130). x=70 is left edge; x=129 is just inside right
  // edge. Both at y=30 (in black region) should return pc 1.
  const g = computeGeometry(700, 100);
  assert.equal(hitTest(70, 30, g), 1, "C# left edge");
  assert.equal(hitTest(129.99, 30, g), 1, "C# right edge (just inside)");
});

test("hitTest — y exactly at blackKeyHeight is in the white region", () => {
  // Boundary semantics: y < blackKeyHeight is black overlay, y >=
  // blackKeyHeight is white. At y=60 (=blackKeyHeight) and x=100
  // (boundary between C and D), the click belongs to D's white column
  // (whiteIdx = floor(100/100) = 1 ⇒ D = pc 2). Codifies the
  // half-open interval so clicks at the exact threshold don't bounce
  // ambiguously between black and white.
  const g = computeGeometry(700, 100);
  assert.equal(hitTest(100, 60, g), 2);
});

test("hitTest — y just inside blackKeyHeight returns the black pc", () => {
  // y=59.99 < blackKeyHeight=60 ⇒ still black region. Confirms the
  // strict-less-than threshold matches the blackKeyHeight constant
  // exactly (no off-by-one against the keyBoundsAt black height).
  const g = computeGeometry(700, 100);
  assert.equal(hitTest(100, 59.99, g), 1);
});

test("hitTest — clicks outside the canvas return -1", () => {
  // Defensive: jsui's onclick fires only on hits inside the box, so
  // these are belt-and-suspenders. Negative coords, x at exactly
  // canvasWidth (one past last valid pixel), y == canvasHeight, etc.
  const g = computeGeometry(700, 100);
  assert.equal(hitTest(-1, 50, g), -1, "x<0");
  assert.equal(hitTest(700, 50, g), -1, "x==W (one past)");
  assert.equal(hitTest(800, 50, g), -1, "x>W");
  assert.equal(hitTest(50, -1, g), -1, "y<0");
  assert.equal(hitTest(50, 100, g), -1, "y==H (one past)");
  assert.equal(hitTest(50, 150, g), -1, "y>H");
});

test("hitTest — canvas edges (x=0, y=0, x=W-ε, y=H-ε) hit valid keys", () => {
  // Top-left corner is C's top-left and not in any black bounds (no
  // boundary-0 black) ⇒ pc 0. x just below W is in B's column. y just
  // below H is white area → for x at C# center (100), returns D=2.
  const g = computeGeometry(700, 100);
  assert.equal(hitTest(0, 0, g), 0, "top-left = C");
  assert.equal(hitTest(699.99, 99.99, g), 11, "bottom-right = B");
  assert.equal(hitTest(100, 99.99, g), 2, "x=100 bottom = D (no black at this y)");
});

test("hitTest — every pitch class is reachable by some click point", () => {
  // Coverage guard: if the white-pc-of-index table or the black bounds
  // table loses an entry, this test fails for the missing pc rather
  // than letting a silent gap ship.
  const g = computeGeometry(700, 100);
  const reached = new Set<number>();
  // White centers at y=80 (clearly in white region).
  for (const x of [50, 150, 250, 350, 450, 550, 650]) {
    const pc = hitTest(x, 80, g);
    if (pc >= 0) reached.add(pc);
  }
  // Black centers at y=30 (clearly in black region).
  for (const x of [100, 200, 400, 500, 600]) {
    const pc = hitTest(x, 30, g);
    if (pc >= 0) reached.add(pc);
  }
  assert.equal(reached.size, 12, `reached: ${[...reached].sort((a, b) => a - b).join(",")}`);
});

test("hitTest — non-finite x or y returns -1", () => {
  // jsui's onclick passes Number(...) of the event coords; a NaN
  // could leak through if Max sends a malformed message. Don't index
  // into bounds with NaN — return -1 cleanly.
  const g = computeGeometry(700, 100);
  assert.equal(hitTest(NaN, 50, g), -1);
  assert.equal(hitTest(50, NaN, g), -1);
  assert.equal(hitTest(Infinity, 50, g), -1);
  assert.equal(hitTest(50, -Infinity, g), -1);
});

// ---- constants exposed for the mirror drift test --------------------------

test("constants exported for mirror drift check", () => {
  // The mirror drift test (scaleKeyboard.mirror.test.ts) reads these named
  // exports from renderer source text. Keep them as bare numeric exports
  // (no enum / no object wrap) so the renderer can mirror them as
  // `var FOO = N` literals.
  assert.equal(typeof NUM_PITCH_CLASSES, "number");
  assert.equal(typeof PULSE_DECAY_MS, "number");
  assert.equal(typeof WHITE_KEYS_PER_OCTAVE, "number");
  assert.equal(typeof BLACK_KEY_WIDTH_RATIO, "number");
  assert.equal(typeof BLACK_KEY_HEIGHT_RATIO, "number");
  assert.equal(typeof DOT_INSET_RATIO, "number");
  assert.equal(typeof DOT_RADIUS_RATIO, "number");
});
