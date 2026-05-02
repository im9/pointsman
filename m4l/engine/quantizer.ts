// Quantizer engine — pure functions per ADR 001.
// Cross-target conformance vectors: docs/ai/quantizer-test-vectors.json

export type MidiNote = number; // 0..127
export type PitchClass = number; // 0..11
export type ScaleName =
  | "major"
  | "minor"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "locrian"
  | "pentatonic"
  | "minor-pentatonic"
  | "blues"
  | "harmonic"
  | "melodic"
  | "whole"
  | "chromatic"
  | "chromatic-half";

const SCALE_INTERVALS: Record<Exclude<ScaleName, "chromatic-half">, number[]> = {
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

export function buildScalePitches(
  scale: ScaleName,
  root: PitchClass,
): MidiNote[] {
  if (scale === "chromatic-half") {
    return Array.from({ length: 128 }, (_, i) => i);
  }
  const intervals = SCALE_INTERVALS[scale];
  const pitchClasses = new Set(intervals.map((i) => (root + i) % 12));
  const out: MidiNote[] = [];
  for (let n = 0; n <= 127; n++) {
    if (pitchClasses.has(n % 12)) out.push(n);
  }
  return out;
}

// Nearest scale pitch. Tie (d_lower == d_upper) → return lower.
export function snapToScale(note: MidiNote, pitches: MidiNote[]): MidiNote {
  if (pitches.length === 0) return note;
  if (note <= pitches[0]) return pitches[0];
  const last = pitches[pitches.length - 1];
  if (note >= last) return last;
  // Binary search: find smallest index i with pitches[i] >= note.
  let lo = 0, hi = pitches.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (pitches[mid] < note) lo = mid + 1;
    else hi = mid;
  }
  const upper = pitches[lo];
  if (upper === note) return upper;
  const lower = pitches[lo - 1];
  const dUp = upper - note;
  const dDn = note - lower;
  return dDn <= dUp ? lower : upper; // tie → lower
}
