// scale-keyboard jsui pure logic — ADR 003 §scale keyboard.
//
// Pure data + math, no Max APIs. Runs in Node for tests. Mirrored (by hand,
// ASCII-only) into scaleKeyboard.jsui.js for Max's [jsui] consumer. A drift
// test (scaleKeyboard.mirror.test.ts) asserts the named constants below
// appear in the renderer text. Function bodies are kept in sync by
// discipline; surface is small (~6 functions).

import { buildScalePitches, type ScaleName } from "../../engine/quantizer.ts";

export const NUM_PITCH_CLASSES = 12;
export const WHITE_KEYS_PER_OCTAVE = 7;

// Pulse fade duration. ADR 003 §Open questions: 250 ms is a placeholder,
// to be tuned by ear at patcher build time. Linear decay (intensity drops
// to 0 over PULSE_DECAY_MS).
export const PULSE_DECAY_MS = 250;

// Black-key visual proportions, relative to the white-key dimensions:
// black key is narrower (BLACK_KEY_WIDTH_RATIO of whiteKeyWidth) and
// shorter (BLACK_KEY_HEIGHT_RATIO of whiteKeyAreaHeight). Both pulled from
// inboil's QuantizerSheet for visual continuity.
export const BLACK_KEY_WIDTH_RATIO = 0.6;
export const BLACK_KEY_HEIGHT_RATIO = 0.6;

// In-scale dot is drawn INSIDE each in-scale key (no dedicated bottom
// strip — that arrangement made it ambiguous which dot belongs to which
// key, see ADR 003 §scale keyboard).
//
// DOT_INSET_RATIO: vertical inset from the key's bottom, as a fraction
//   of that key's own height. Same ratio for both white and black keys
//   — black keys end up visually higher because their bounding height
//   is shorter (BLACK_KEY_HEIGHT_RATIO), giving the inboil-style
//   two-row visual for free.
// DOT_RADIUS_RATIO: dot radius as a fraction of whiteKeyWidth. Tied to
//   width (not key height) so white and black dots are the same physical
//   size and the dot reads as a single visual token across the keyboard.
export const DOT_INSET_RATIO = 0.15;
export const DOT_RADIUS_RATIO = 0.08;
const DOT_RADIUS_MIN_PX = 1.5;

// Chord-context dot radius (the third highlight tier between in-scale
// and pulse, per ADR 002 §Verification line 184). Drawn at the same
// position as the in-scale dot but ~2× the radius so a chord-tone PC
// reads as visibly "promoted" over a plain in-scale PC.
export const CHORD_DOT_RADIUS_RATIO = 0.16;

// Pitch classes that are black keys on a piano (C# D# F# G# A#).
const BLACK_PITCH_CLASSES = new Set<number>([1, 3, 6, 8, 10]);

// White-key index (0..6, left to right) for each white pitch class.
const WHITE_INDEX_OF: Record<number, number> = {
  0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6,
};

// Inverse of WHITE_INDEX_OF: white-key index 0..6 -> pitch class.
// Used by hitTest to map a click's whiteIdx back to a pc.
const PC_OF_WHITE_INDEX: number[] = [0, 2, 4, 5, 7, 9, 11];

// Boundary white-key index (left of the black key) for each black pitch
// class. Black-key center sits at boundaryIdx * whiteKeyWidth.
const BLACK_BOUNDARY_INDEX: Record<number, number> = {
  1: 1, 3: 2, 6: 4, 8: 5, 10: 6,
};

// Pitch classes ordered by ascending boundary index, so hitTest can
// iterate the black-key x-bounds without re-deriving boundary positions.
const BLACK_PCS_BY_BOUNDARY: number[] = [1, 3, 6, 8, 10];

export interface Pulse {
  pitchClass: number;
  intensity: number; // 0..1, normalized from MIDI velocity
  ageMs: number;     // 0..PULSE_DECAY_MS; >= PULSE_DECAY_MS is pruned
}

export interface KeyboardModel {
  inScale: boolean[]; // length 12, true if pitch class is in current scale
  // length 12, true if pitch class is part of the current chord context
  // (held controlChannel notes in mode=chord). Empty array semantically
  // when no controlChannel notes are held. Visually rendered as the
  // "third tier" between in-scale dot and pulse glow.
  chordPcs: boolean[];
  pulses: Pulse[];
}

export interface KeyboardGeometry {
  canvasWidth: number;
  canvasHeight: number;
  whiteKeyWidth: number;
  blackKeyWidth: number;
  whiteKeyAreaHeight: number;
  blackKeyHeight: number;
  dotRadius: number;
}

export interface KeyBounds {
  x: number;
  y: number;
  w: number;
  h: number;
  isBlack: boolean;
}

export function recomputeInScale(
  scale: ScaleName,
  root: number,
): boolean[] {
  // Reuse the engine's scale-pitch builder so the keyboard's in-scale
  // pattern can never disagree with what the quantizer actually snaps to.
  const pitches = buildScalePitches(scale, ((root % 12) + 12) % 12);
  const present = new Array(NUM_PITCH_CLASSES).fill(false) as boolean[];
  for (const p of pitches) {
    present[p % NUM_PITCH_CLASSES] = true;
  }
  return present;
}

export function createModel(scale: ScaleName, root: number): KeyboardModel {
  return {
    inScale: recomputeInScale(scale, root),
    chordPcs: new Array(NUM_PITCH_CLASSES).fill(false) as boolean[],
    pulses: [],
  };
}

export function setScale(
  model: KeyboardModel,
  scale: ScaleName,
  root: number,
): KeyboardModel {
  return {
    inScale: recomputeInScale(scale, root),
    chordPcs: model.chordPcs.slice(),
    pulses: model.pulses.map((p) => ({ ...p })),
  };
}

// Replace the chord-context pitch-class set. Bridge emits `chordChanged
// <pc...>` with the held controlChannel PCs (sorted, deduped). An empty
// list clears the tier (no controlChannel notes held). PCs outside 0..11
// are ignored — defensive against a malformed message reaching the jsui.
export function setChord(
  model: KeyboardModel,
  pcList: readonly number[],
): KeyboardModel {
  const next = new Array(NUM_PITCH_CLASSES).fill(false) as boolean[];
  for (const pc of pcList) {
    if (Number.isInteger(pc) && pc >= 0 && pc < NUM_PITCH_CLASSES) {
      next[pc] = true;
    }
  }
  return {
    inScale: model.inScale.slice(),
    chordPcs: next,
    pulses: model.pulses.map((p) => ({ ...p })),
  };
}

export function addPulse(
  model: KeyboardModel,
  pitchClass: number,
  velocity: number,
): KeyboardModel {
  if (
    !Number.isInteger(pitchClass) ||
    pitchClass < 0 ||
    pitchClass >= NUM_PITCH_CLASSES
  ) {
    return model;
  }
  if (!Number.isFinite(velocity) || velocity <= 0) return model;
  const intensity = Math.min(1, velocity / 127);
  const next: Pulse[] = model.pulses.map((p) => ({ ...p }));
  next.push({ pitchClass, intensity, ageMs: 0 });
  return { ...model, pulses: next };
}

export function updatePulses(
  model: KeyboardModel,
  dtMs: number,
): KeyboardModel {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return model;
  const next: Pulse[] = [];
  for (const p of model.pulses) {
    const ageMs = p.ageMs + dtMs;
    if (ageMs >= PULSE_DECAY_MS) continue; // prune fully-decayed
    const intensity = p.intensity * (1 - ageMs / PULSE_DECAY_MS);
    next.push({ pitchClass: p.pitchClass, intensity, ageMs });
  }
  return { ...model, pulses: next };
}

export function isBlackKey(pitchClass: number): boolean {
  return BLACK_PITCH_CLASSES.has(pitchClass);
}

export function computeGeometry(
  canvasWidth: number,
  canvasHeight: number,
): KeyboardGeometry {
  const whiteKeyWidth = canvasWidth / WHITE_KEYS_PER_OCTAVE;
  const blackKeyWidth = whiteKeyWidth * BLACK_KEY_WIDTH_RATIO;
  const whiteKeyAreaHeight = canvasHeight;
  const blackKeyHeight = whiteKeyAreaHeight * BLACK_KEY_HEIGHT_RATIO;
  const dotRadius = Math.max(
    DOT_RADIUS_MIN_PX,
    whiteKeyWidth * DOT_RADIUS_RATIO,
  );
  return {
    canvasWidth,
    canvasHeight,
    whiteKeyWidth,
    blackKeyWidth,
    whiteKeyAreaHeight,
    blackKeyHeight,
    dotRadius,
  };
}

export function keyBoundsAt(
  pitchClass: number,
  geometry: KeyboardGeometry,
): KeyBounds {
  if (isBlackKey(pitchClass)) {
    const boundaryIdx = BLACK_BOUNDARY_INDEX[pitchClass];
    const x = boundaryIdx * geometry.whiteKeyWidth - geometry.blackKeyWidth / 2;
    return {
      x,
      y: 0,
      w: geometry.blackKeyWidth,
      h: geometry.blackKeyHeight,
      isBlack: true,
    };
  }
  const whiteIdx = WHITE_INDEX_OF[pitchClass];
  return {
    x: whiteIdx * geometry.whiteKeyWidth,
    y: 0,
    w: geometry.whiteKeyWidth,
    h: geometry.whiteKeyAreaHeight,
    isBlack: false,
  };
}

export function dotCenterAt(
  pitchClass: number,
  geometry: KeyboardGeometry,
): { cx: number; cy: number } {
  const b = keyBoundsAt(pitchClass, geometry);
  return {
    cx: b.x + b.w / 2,
    cy: b.h * (1 - DOT_INSET_RATIO),
  };
}

// Map a canvas-relative click point to a pitch class, matching the
// visible key under the cursor. Returns -1 if the point is outside the
// canvas (defensive — jsui's onclick should already filter to in-box).
//
// Black keys overlay white keys in the y < blackKeyHeight band: a click
// in a black-key column AND in that band returns the black pc; below
// that band the click falls through to the white below. Mirrors
// inboil's tapKey UX (any click on a key surface counts).
export function hitTest(
  x: number,
  y: number,
  geometry: KeyboardGeometry,
): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
  if (x < 0 || x >= geometry.canvasWidth) return -1;
  if (y < 0 || y >= geometry.canvasHeight) return -1;

  if (y < geometry.blackKeyHeight) {
    for (const pc of BLACK_PCS_BY_BOUNDARY) {
      const boundaryIdx = BLACK_BOUNDARY_INDEX[pc];
      const bx = boundaryIdx * geometry.whiteKeyWidth - geometry.blackKeyWidth / 2;
      if (x >= bx && x < bx + geometry.blackKeyWidth) return pc;
    }
  }
  const whiteIdx = Math.floor(x / geometry.whiteKeyWidth);
  if (whiteIdx < 0 || whiteIdx >= WHITE_KEYS_PER_OCTAVE) return -1;
  return PC_OF_WHITE_INDEX[whiteIdx];
}
