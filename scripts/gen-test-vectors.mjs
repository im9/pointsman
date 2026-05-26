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
// Modules under scripts/gen-test-vectors/:
//   prng.mjs   — xoshiro128++ / SplitMix64 + RNG case generators
//   scale.mjs  — SCALE_INTERVALS, buildScalePitches, snapToScale,
//                snapToChordTones, diatonicShift + cases
//   chord.mjs  — CHORD_SHAPES, applyChordShape + cases (ADR 004)
//   arp.mjs    — ARP_RATES, ARP_PATTERNS, parseArpRate, nextArpIndex,
//                resolveArpStep, (TODO) applyArpVariation, applyArpGroove,
//                scheduleArpNoteOff + cases (ADR 004)
//
// Run:  node scripts/gen-test-vectors.mjs
// Re-run any time vector cases change; do not hand-edit the JSONs.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  genSplitMix64InitCases,
  genPrngCases,
} from "./gen-test-vectors/prng.mjs";

import {
  SCALE_INTERVALS,
  genBuildScalePitchesCases,
  genSnapToScaleCases,
  genSnapToChordTonesCases,
  genDiatonicShiftCases,
} from "./gen-test-vectors/scale.mjs";

import {
  CHORD_SHAPES,
  genApplyChordShapeCases,
} from "./gen-test-vectors/chord.mjs";

import {
  ARP_RATES,
  ARP_PATTERNS,
  genParseArpRateCases,
  genNextArpIndexCases,
  genResolveArpStepCases,
} from "./gen-test-vectors/arp.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");
const OUT_RNG = join(REPO, "docs/ai/rng-test-vectors.json");
const OUT_QT = join(REPO, "docs/ai/quantizer-test-vectors.json");

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
    chord_shapes: CHORD_SHAPES,
    arp_rates: ARP_RATES,
    arp_patterns: ARP_PATTERNS,
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
        "5th = 4, 6th = 5). Mirrors inboil generative.ts:235-254. " +
        "REMOVED from target engines per ADR 004 (v2 → v3 break, " +
        "replaced by chord shape primitive); kept here for historical " +
        "audit traceability.",
    },
    chord_shape_rule: {
      definition:
        "applyChordShape(rootMidi, shape): intervallic expansion from " +
        "the snapped root using semitone offsets (NOT scale degrees). " +
        "Voices that would exceed MIDI 127 are dropped (silent step), " +
        "not clamped, not wrapped. Out-of-scale voices are deliberate " +
        "— this is the chord-voicing freedom that v0.2's chord shape " +
        "primitive buys. ADR 004 §Decision §Chord shape primitive.",
    },
    arp_rate_rule: {
      definition:
        "parseArpRate(rate): returns { num, den } rational of quarter " +
        "notes per arp step. Dotted = base × 3/2, triplet = base × 2/3. " +
        "Target engines must reconstruct sample-count from the rational " +
        "form to avoid float drift. ADR 004 §Decision §Arpeggiator parameters.",
    },
    arp_pattern_rule: {
      definition:
        "nextArpIndex(pattern, state, poolSize, octaves, stepRepeats, " +
        "rngDraw01) → newState. State = { index, round, repeatTick, " +
        "direction }. Step-repeat sub-counter: each step held for " +
        "stepRepeats ticks before pattern advances. Round advances on " +
        "pattern-cycle completion (up/down/up-down/as-played) or every " +
        "step boundary (strike). Random consumes rngDraw01; other " +
        "patterns ignore it. Initial state: { index:0, round:0, " +
        "repeatTick:0, direction:+1 }. ADR 004 §Decision §Pattern semantics.",
    },
    arp_step_resolution_rule: {
      definition:
        "resolveArpStep(pool, index, octaveRound, pattern) → { kind, " +
        "pitches? }. Traversal patterns return a single voice " +
        "(pool[index] + 12*octaveRound). Strike returns the whole pool " +
        "uniformly octave-shifted. Out-of-range pitches (>127 or <0) " +
        "are dropped; if all drop or pool empty, returns kind:rest. " +
        "ADR 004 §Decision §Pattern semantics + §Edge cases.",
    },
  },
  build_scale_pitches: genBuildScalePitchesCases(),
  snap_to_scale: genSnapToScaleCases(),
  snap_to_chord_tones: genSnapToChordTonesCases(),
  diatonic_shift: genDiatonicShiftCases(),
  apply_chord_shape: genApplyChordShapeCases(),
  parse_arp_rate: genParseArpRateCases(),
  next_arp_index: genNextArpIndexCases(),
  resolve_arp_step: genResolveArpStepCases(),
};

writeFileSync(OUT_RNG, JSON.stringify(rngJson, null, 2) + "\n");
writeFileSync(OUT_QT, JSON.stringify(qtJson, null, 2) + "\n");

console.log(`wrote ${OUT_RNG}`);
console.log(`wrote ${OUT_QT}`);
console.log(`rng sections: prng=${rngJson.prng.length}, splitmix=${rngJson.splitmix64_init.length}`);
console.log(`qt  sections: bsp=${qtJson.build_scale_pitches.length}, ` +
            `snap=${qtJson.snap_to_scale.length}, ` +
            `chord=${qtJson.snap_to_chord_tones.length}, ` +
            `dshift=${qtJson.diatonic_shift.length}, ` +
            `acs=${qtJson.apply_chord_shape.length}, ` +
            `par=${qtJson.parse_arp_rate.length}, ` +
            `nai=${qtJson.next_arp_index.length}, ` +
            `ras=${qtJson.resolve_arp_step.length}`);
