// scripts/gen-test-vectors/chord.mjs
//
// ADR 004 chord shape primitive: replaces the v0.1 diatonic
// `harmonyVoices` with intervallic, jazz-named presets that ignore the
// active scale (chord voices may go out-of-scale — borrowed-chord
// material is musically valid and deliberate).
//
// Append-only enum. The on-disk index used by APVTS / live.menu is
// position in the array — reordering silently corrupts every saved
// preset.

export const CHORD_SHAPES = [
  { name: "maj",    intervals: [0, 4, 7] },         //  0 — major triad (default)
  { name: "m",      intervals: [0, 3, 7] },         //  1 — minor triad
  { name: "dim",    intervals: [0, 3, 6] },         //  2 — diminished triad
  { name: "aug",    intervals: [0, 4, 8] },         //  3 — augmented triad
  { name: "sus2",   intervals: [0, 2, 7] },         //  4
  { name: "sus4",   intervals: [0, 5, 7] },         //  5
  { name: "power",  intervals: [0, 7] },            //  6 — 1-5 power chord
  { name: "maj7",   intervals: [0, 4, 7, 11] },     //  7
  { name: "m7",     intervals: [0, 3, 7, 10] },     //  8
  { name: "7",      intervals: [0, 4, 7, 10] },     //  9 — dominant 7th
  { name: "m7b5",   intervals: [0, 3, 6, 10] },     // 10 — half-diminished
  { name: "dim7",   intervals: [0, 3, 6, 9] },      // 11
  { name: "6",      intervals: [0, 4, 7, 9] },      // 12
  { name: "m6",     intervals: [0, 3, 7, 9] },      // 13
  { name: "add9",   intervals: [0, 4, 7, 14] },     // 14
  { name: "maj9",   intervals: [0, 4, 7, 11, 14] }, // 15
  { name: "m9",     intervals: [0, 3, 7, 10, 14] }, // 16
  { name: "9",      intervals: [0, 4, 7, 10, 14] }, // 17 — dominant 9
  { name: "13",     intervals: [0, 4, 7, 10, 14, 21] }, // 18
  { name: "octave", intervals: [0, 12] },           // 19 — root + octave
];

// Pure: intervallic expansion from a snapped root. Voices that would
// exceed MIDI 127 are dropped (not clamped, not wrapped — per ADR 004
// §"Octave traversal" and §"Edge cases", out-of-range emissions are
// silent). The chord shape's intervals are semitones from the root,
// NOT scale degrees — so out-of-scale voices are deliberate.
export function applyChordShape(rootMidi, shape) {
  const entry = typeof shape === "number" ? CHORD_SHAPES[shape] :
                CHORD_SHAPES.find((s) => s.name === shape);
  if (!entry) throw new Error(`unknown chord shape: ${shape}`);
  const out = [];
  for (const iv of entry.intervals) {
    const v = rootMidi + iv;
    if (v >= 0 && v <= 127) out.push(v);
  }
  return out;
}

export function genApplyChordShapeCases() {
  const cases = [];
  // (a) Every shape at C4 (root 60) — covers the canonical expansion.
  for (let i = 0; i < CHORD_SHAPES.length; i++) {
    const { name, intervals } = CHORD_SHAPES[i];
    cases.push({
      label: `C4 + ${name}`,
      root: 60,
      shape_index: i,
      shape_name: name,
      intervals,
      expected: applyChordShape(60, i),
    });
  }
  // (b) Every shape at C5 (root 72) — confirms additive symmetry.
  for (let i = 0; i < CHORD_SHAPES.length; i++) {
    const { name } = CHORD_SHAPES[i];
    cases.push({
      label: `C5 + ${name}`,
      root: 72,
      shape_index: i,
      shape_name: name,
      expected: applyChordShape(72, i),
    });
  }
  // (c) High-root edge cases — voices that would exceed MIDI 127 drop.
  // - 13 chord (max interval 21) at root 110 → top voice = 131, dropped.
  //   Expected: [110, 114, 117, 120, 124] (5 voices, 13's 6 minus the 131).
  cases.push({
    label: "edge: 13 at root 110 — top voice (131) drops",
    root: 110,
    shape_index: CHORD_SHAPES.findIndex((s) => s.name === "13"),
    shape_name: "13",
    expected: applyChordShape(110, "13"),
  });
  // - octave at root 127 → top voice 139 dropped, only root survives.
  cases.push({
    label: "edge: octave at root 127 — top voice (139) drops, root only",
    root: 127,
    shape_index: CHORD_SHAPES.findIndex((s) => s.name === "octave"),
    shape_name: "octave",
    expected: applyChordShape(127, "octave"),
  });
  // - 13 at root 127 → all but root drop.
  cases.push({
    label: "edge: 13 at root 127 — all extensions drop, root only",
    root: 127,
    shape_index: CHORD_SHAPES.findIndex((s) => s.name === "13"),
    shape_name: "13",
    expected: applyChordShape(127, "13"),
  });
  // - power at root 0 → no clipping at the low end (root + 7 = 7).
  cases.push({
    label: "edge: power at root 0 — low end, no drop",
    root: 0,
    shape_index: CHORD_SHAPES.findIndex((s) => s.name === "power"),
    shape_name: "power",
    expected: applyChordShape(0, "power"),
  });
  return cases;
}
