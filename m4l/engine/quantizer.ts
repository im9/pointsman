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
  | "chromatic-half"
  | "phrygian-dominant";

// Exported so the scale-keyboard renderer's mirror test
// (host/ui/scaleKeyboard.mirror.test.ts) can verify the renderer's
// hand-mirrored copy matches this canonical table.
export const SCALE_INTERVALS: Record<Exclude<ScaleName, "chromatic-half">, number[]> = {
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
  "phrygian-dominant": [0, 1, 4, 5, 7, 8, 10],
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

// ---- Harmony types (used by host mode == 'harmony') ------------------

export type HarmonyDirection = "above" | "below";
export type HarmonyInterval = 3 | 4 | 5 | 6;

export interface HarmonyVoice {
  interval: HarmonyInterval;
  direction: HarmonyDirection;
}

// ---- Chord-mode helper --------------------------------------------------
//
// Snap `note` to the nearest pitch in `chordPcs` (across all MIDI octaves)
// if within `tolerance` semitones; otherwise fall back to scale-snap.
// Mirrors inboil generative.ts:285-338 chord-mode behaviour. Tolerance
// default = 2 semitones (inboil hardcodes 2). Empty chordPcs → identical
// to plain scale-snap.

export function snapToChordTones(
  note: MidiNote,
  chordPcs: PitchClass[],
  scalePitches: MidiNote[],
  tolerance: number = 2,
): MidiNote {
  if (chordPcs.length === 0) return snapToScale(note, scalePitches);
  // Build the full-MIDI-range list of chord tones, sorted (loop is
  // already in ascending order).
  const pcSet = new Set(chordPcs.map((pc) => ((pc % 12) + 12) % 12));
  const chordMidi: MidiNote[] = [];
  for (let n = 0; n <= 127; n++) {
    if (pcSet.has(n % 12)) chordMidi.push(n);
  }
  const nearestChord = snapToScale(note, chordMidi);
  if (Math.abs(nearestChord - note) <= tolerance) return nearestChord;
  return snapToScale(note, scalePitches);
}

// ---- Harmony-mode helper ------------------------------------------------
//
// Diatonic Nth above/below `note` along `scalePitches`. Inboil semantics
// (generative.ts:235-254): interval=N is N-1 scale steps (3rd = 2 steps,
// 5th = 4 steps). Out-of-scale input snaps to nearest scale degree first
// (matching snapToScale's tie-to-lower rule). Clamps at scale extremes
// rather than wrapping.
//
// ADR 004 deprecates this in favour of `applyChordShape` (intervallic, jazz
// presets). The function survives in v0.2 only while the chord-mode call
// sites in host / processor still run on the v0.1 voicing primitive;
// removed once Phases 2 & 3 land.

export function diatonicShift(
  note: MidiNote,
  interval: HarmonyInterval,
  direction: HarmonyDirection,
  scalePitches: MidiNote[],
): MidiNote {
  if (scalePitches.length === 0) return note;
  // Find note's position in scale; if not exact, use nearest (tie-to-lower
  // matches snapToScale and inboil's "find nearest scale position" loop).
  const snapped = snapToScale(note, scalePitches);
  const idx = scalePitches.indexOf(snapped);
  // interval=N → N-1 scale steps. 3rd = 2 steps, 4th = 3, 5th = 4, 6th = 5.
  const steps = interval - 1;
  const targetIdx = direction === "above" ? idx + steps : idx - steps;
  if (targetIdx < 0) return scalePitches[0];
  if (targetIdx >= scalePitches.length) return scalePitches[scalePitches.length - 1];
  return scalePitches[targetIdx];
}

// ============================================================================
// ADR 004 — Chord shape primitive
// ============================================================================
//
// Intervallic expansion from a snapped root. Voices are absolute semitones
// from `rootMidi` (NOT scale degrees) — so out-of-scale voices are
// deliberate (borrowed-chord material is musically valid). Voices that would
// exceed MIDI 127 are dropped (silent step) rather than clamped, preserving
// chord-shape integrity for the arp's `strike` mode.

export type ChordShape =
  | "maj" | "m" | "dim" | "aug" | "sus2" | "sus4" | "power"
  | "maj7" | "m7" | "7" | "m7b5" | "dim7" | "6" | "m6"
  | "add9" | "maj9" | "m9" | "9" | "13" | "octave";

// Append-only. The order is the on-disk APVTS / live.menu index — re-ordering
// silently corrupts every saved preset. Matches scripts/gen-test-vectors/
// chord.mjs CHORD_SHAPES bit-for-bit.
export const CHORD_SHAPE_ORDER: readonly ChordShape[] = [
  "maj", "m", "dim", "aug", "sus2", "sus4", "power",
  "maj7", "m7", "7", "m7b5", "dim7", "6", "m6",
  "add9", "maj9", "m9", "9", "13", "octave",
] as const;

export const CHORD_SHAPES: Record<ChordShape, number[]> = {
  maj:    [0, 4, 7],
  m:      [0, 3, 7],
  dim:    [0, 3, 6],
  aug:    [0, 4, 8],
  sus2:   [0, 2, 7],
  sus4:   [0, 5, 7],
  power:  [0, 7],
  maj7:   [0, 4, 7, 11],
  m7:     [0, 3, 7, 10],
  "7":    [0, 4, 7, 10],
  m7b5:   [0, 3, 6, 10],
  dim7:   [0, 3, 6, 9],
  "6":    [0, 4, 7, 9],
  m6:     [0, 3, 7, 9],
  add9:   [0, 4, 7, 14],
  maj9:   [0, 4, 7, 11, 14],
  m9:     [0, 3, 7, 10, 14],
  "9":    [0, 4, 7, 10, 14],
  "13":   [0, 4, 7, 10, 14, 21],
  octave: [0, 12],
};

export function applyChordShape(rootMidi: MidiNote, shape: ChordShape): MidiNote[] {
  const intervals = CHORD_SHAPES[shape];
  const out: MidiNote[] = [];
  for (const iv of intervals) {
    const v = rootMidi + iv;
    if (v >= 0 && v <= 127) out.push(v);
  }
  return out;
}

// ============================================================================
// ADR 004 — Arpeggiator: rate parsing
// ============================================================================
//
// parseArpRate returns a rational { num, den } in quarter-notes per step.
// Target engines must reconstruct sample-count from the fraction (not the
// decimal) to avoid float drift across long transports — especially for
// triplet rates.

export type ArpRate =
  | "1/4" | "1/4D" | "1/4T"
  | "1/8" | "1/8D" | "1/8T"
  | "1/16" | "1/16D" | "1/16T"
  | "1/32";

interface ArpRateEntry {
  name: ArpRate;
  quartersNum: number;
  quartersDen: number;
}

export const ARP_RATES: readonly ArpRateEntry[] = [
  { name: "1/4",   quartersNum: 1, quartersDen: 1 },
  { name: "1/4D",  quartersNum: 3, quartersDen: 2 },
  { name: "1/4T",  quartersNum: 2, quartersDen: 3 },
  { name: "1/8",   quartersNum: 1, quartersDen: 2 },
  { name: "1/8D",  quartersNum: 3, quartersDen: 4 },
  { name: "1/8T",  quartersNum: 1, quartersDen: 3 },
  { name: "1/16",  quartersNum: 1, quartersDen: 4 }, // default
  { name: "1/16D", quartersNum: 3, quartersDen: 8 },
  { name: "1/16T", quartersNum: 1, quartersDen: 6 },
  { name: "1/32",  quartersNum: 1, quartersDen: 8 },
] as const;

export function parseArpRate(rate: ArpRate | number): { num: number; den: number } {
  const entry = typeof rate === "number" ? ARP_RATES[rate] :
                ARP_RATES.find((r) => r.name === rate);
  if (!entry) throw new Error(`unknown arp rate: ${String(rate)}`);
  return { num: entry.quartersNum, den: entry.quartersDen };
}

// ============================================================================
// ADR 004 — Arpeggiator: pattern cursor and step resolution
// ============================================================================

export type ArpPattern = "up" | "down" | "up-down" | "random" | "as-played" | "strike";

// Append-only. Position in this array is the on-disk APVTS / live.menu index.
export const ARP_PATTERN_ORDER: readonly ArpPattern[] = [
  "up", "down", "up-down", "random", "as-played", "strike",
] as const;

export interface ArpState {
  index: number;
  round: number;
  repeatTick: number;
  direction: 1 | -1;
}

export const INITIAL_ARP_STATE: ArpState = {
  index: 0, round: 0, repeatTick: 0, direction: 1,
};

// Advances the cursor by one tick. Initial state is INITIAL_ARP_STATE; the
// FIRST tick after transport-start consumes pattern position (0, 0), and
// this function is called to advance AFTER each emission is scheduled.
//
// rngDraw01 is a [0, 1) draw consumed only by pattern == "random"; other
// patterns ignore it. Empty pool returns the state unchanged.
export function nextArpIndex(
  pattern: ArpPattern,
  state: ArpState,
  poolSize: number,
  octaves: number,
  stepRepeats: number,
  rngDraw01: number,
): ArpState {
  if (poolSize === 0) return { ...state };
  const sr = Math.max(1, stepRepeats);
  const oc = Math.max(1, octaves);

  const nextRepeat = state.repeatTick + 1;
  if (nextRepeat < sr) {
    return { index: state.index, round: state.round, repeatTick: nextRepeat,
             direction: state.direction };
  }

  let newIndex = state.index;
  let newRound = state.round;
  let newDirection = state.direction;

  switch (pattern) {
    case "up":
    case "as-played": {
      newIndex = state.index + 1;
      if (newIndex >= poolSize) {
        newIndex = 0;
        newRound = (state.round + 1) % oc;
      }
      break;
    }
    case "down": {
      newIndex = state.index - 1;
      if (newIndex < 0) {
        newIndex = poolSize - 1;
        newRound = (state.round + 1) % oc;
      }
      break;
    }
    case "up-down": {
      if (poolSize === 1) {
        newIndex = 0;
        newRound = (state.round + 1) % oc;
        break;
      }
      let candidate = state.index + state.direction;
      if (candidate >= poolSize) {
        candidate = poolSize - 2;
        newDirection = -1;
      } else if (candidate < 0) {
        candidate = 1;
        newDirection = 1;
        newRound = (state.round + 1) % oc;
      }
      newIndex = candidate;
      break;
    }
    case "random": {
      newIndex = Math.min(poolSize - 1, Math.floor(rngDraw01 * poolSize));
      // Random has no positional structure — the octave round counter is
      // managed by the caller (tick-count modulo poolSize) and is out of
      // scope here.
      break;
    }
    case "strike": {
      newIndex = 0;
      newRound = (state.round + 1) % oc;
      break;
    }
  }
  return { index: newIndex, round: newRound, repeatTick: 0, direction: newDirection };
}

export type ArpEmission =
  | { kind: "emit"; pitches: MidiNote[] }
  | { kind: "rest" };

// Resolves the cursor to the set of emission pitches for one tick. Traversal
// patterns return a single voice; `strike` returns the whole pool shifted
// uniformly. Out-of-range pitches (>127 or <0) are dropped; if all drop or
// pool is empty, returns kind:"rest".
export function resolveArpStep(
  pool: MidiNote[],
  index: number,
  octaveRound: number,
  pattern: ArpPattern,
): ArpEmission {
  if (pool.length === 0) return { kind: "rest" };
  const shift = octaveRound * 12;
  if (pattern === "strike") {
    const pitches = pool.map((p) => p + shift).filter((p) => p >= 0 && p <= 127);
    if (pitches.length === 0) return { kind: "rest" };
    return { kind: "emit", pitches };
  }
  const i = ((index % pool.length) + pool.length) % pool.length;
  const v = pool[i] + shift;
  if (v < 0 || v > 127) return { kind: "rest" };
  return { kind: "emit", pitches: [v] };
}

// ============================================================================
// ADR 004 — Arpeggiator: variation cascade
// ============================================================================
//
// Probability cascade at v = clamp(variation, 0, 1):
//   [0,       0.30·v): Rest          — tick emits nothing
//   [0.30·v,  0.50·v): Octave shift  — ±12 (sign from rngDraw02 < 0.5 → -12)
//   [0.50·v,  0.65·v): Flam          — emit twice; second at +0.5 step
//   [0.65·v,  1.0):    Normal        — emission unchanged
//
// At v = 1.0 → 30% rest, 20% oct, 15% flam, 35% normal. Octave shift falls
// through to Normal if any pitch would exit [0, 127] (preserves chord-shape
// integrity for `strike`). Rest emissions pass through unchanged.

export type ArpVariationResult =
  | { effect: "rest" }
  | { effect: "normal"; pitches: MidiNote[] }
  | { effect: "octave_shift"; pitches: MidiNote[]; semitones: 12 | -12 }
  | { effect: "flam"; pitches: MidiNote[]; second_offset_fraction: number };

export function applyArpVariation(
  emission: ArpEmission,
  variation: number,
  rngDraw01: number,
  rngDraw02: number,
): ArpVariationResult {
  if (emission.kind === "rest") return { effect: "rest" };
  const v = Math.max(0, Math.min(1, variation));
  if (v === 0 || rngDraw01 >= 0.65 * v) {
    return { effect: "normal", pitches: [...emission.pitches] };
  }
  if (rngDraw01 < 0.30 * v) {
    return { effect: "rest" };
  }
  if (rngDraw01 < 0.50 * v) {
    const semitones: 12 | -12 = rngDraw02 < 0.5 ? -12 : 12;
    const shifted = emission.pitches.map((p) => p + semitones);
    if (shifted.some((p) => p < 0 || p > 127)) {
      return { effect: "normal", pitches: [...emission.pitches] };
    }
    return { effect: "octave_shift", pitches: shifted, semitones };
  }
  return { effect: "flam", pitches: [...emission.pitches], second_offset_fraction: 0.5 };
}

// ============================================================================
// ADR 004 — Arpeggiator: groove cascade (accent / slide / swing)
// ============================================================================
//
// Indexing: tickIndex mod 16 — the 16-step grid is the rhythm cycle,
// decoupled from the arp pattern's harmonic cycle. swingOffsetSamples is in
// 16th-grid units (rate-independent magnitude). Rest emissions short-circuit
// (groove never applies to rests).
//
// Flam + slide interaction is caller-handled (only the second flam emission
// inherits tieToNext; first emission gets its normal noteOff). This function
// returns one tieToNext flag per tick; the scheduler applies it appropriately.

export type ArpGrooveResult =
  | { applied: false }
  | { applied: true; velocity: number; tieToNext: boolean; swingOffsetSamples: number };

export function applyArpGroove(
  emission: ArpVariationResult,
  tickIndex: number,
  accentTable: number[],
  slideTable: boolean[],
  swing: number,
  sixteenthDurationSamples: number,
): ArpGrooveResult {
  if (emission.effect === "rest") return { applied: false };
  const i = ((tickIndex % 16) + 16) % 16;
  const velocity = accentTable[i];
  const tieToNext = !!slideTable[i];
  const swingOffsetSamples = (tickIndex % 2 === 1)
    ? swing * (sixteenthDurationSamples / 2)
    : 0;
  return { applied: true, velocity, tieToNext, swingOffsetSamples };
}

// ============================================================================
// ADR 004 — Slide-aware noteOff scheduling
// ============================================================================
//
// Non-slide → noteOff at gateSamples (staccato gate).
// Slide      → noteOff at nextTickSampleOffset (arpGate overridden; full
//              overlap into next tick's noteOn for receiver-synth glide).
//
// Caller applies the flam convention: pass slideOnCurrent=false for the
// first flam emission; pass the tick's tieToNext for the second.

export function scheduleArpNoteOff(
  slideOnCurrent: boolean,
  gateSamples: number,
  nextTickSampleOffset: number,
): { noteOffSampleOffset: number } {
  return {
    noteOffSampleOffset: slideOnCurrent ? nextTickSampleOffset : gateSamples,
  };
}
