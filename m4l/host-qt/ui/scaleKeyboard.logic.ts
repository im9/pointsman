// QT scale-keyboard jsui pure logic — ADR 003 §QT scale keyboard.
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

// Bottom strip below the keyboard reserved for in-scale dots. Renderer
// draws a dot per pitch class at the horizontal center of that key.
export const DOT_AREA_RATIO = 0.2;

// Pitch classes that are black keys on a piano (C# D# F# G# A#).
const BLACK_PITCH_CLASSES = new Set<number>([1, 3, 6, 8, 10]);

// White-key index (0..6, left to right) for each white pitch class.
const WHITE_INDEX_OF: Record<number, number> = {
  0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6,
};

// Boundary white-key index (left of the black key) for each black pitch
// class. Black-key center sits at boundaryIdx * whiteKeyWidth.
const BLACK_BOUNDARY_INDEX: Record<number, number> = {
  1: 1, 3: 2, 6: 4, 8: 5, 10: 6,
};

export interface Pulse {
  pitchClass: number;
  intensity: number; // 0..1, normalized from MIDI velocity
  ageMs: number;     // 0..PULSE_DECAY_MS; >= PULSE_DECAY_MS is pruned
}

export interface KeyboardModel {
  inScale: boolean[]; // length 12, true if pitch class is in current scale
  pulses: Pulse[];
}

export interface KeyboardGeometry {
  canvasWidth: number;
  canvasHeight: number;
  whiteKeyWidth: number;
  blackKeyWidth: number;
  whiteKeyAreaHeight: number;
  blackKeyHeight: number;
  dotAreaHeight: number;
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
  const dotAreaHeight = canvasHeight * DOT_AREA_RATIO;
  const whiteKeyAreaHeight = canvasHeight - dotAreaHeight;
  const blackKeyHeight = whiteKeyAreaHeight * BLACK_KEY_HEIGHT_RATIO;
  return {
    canvasWidth,
    canvasHeight,
    whiteKeyWidth,
    blackKeyWidth,
    whiteKeyAreaHeight,
    blackKeyHeight,
    dotAreaHeight,
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
