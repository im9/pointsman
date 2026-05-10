// Quantizer engine per ADR 003 §"Engine boundary".
// Cross-target conformance vectors: docs/ai/quantizer-test-vectors.json
// (scale interval tables, snap rule, chord-mode rule, harmony-mode rule).
// Behavioral parity with m4l/engine/quantizer.ts is the binding contract.

#pragma once

#include <vector>

#include "State.h"

namespace pointsman
{
    // Build the active scale's MIDI pitches across the full 0..127 range.
    // ChromaticHalf is the identity-passthrough sentinel and returns
    // [0,1,...,127] regardless of root (concept.md §"Scales (v1)").
    std::vector<int> buildScalePitches(ScaleName scale, int root);

    // Nearest scale pitch. Tie (d_lower == d_upper) → lower. Empty pitches
    // → identity. Mirrors m4l/engine/quantizer.ts:60-78.
    int snapToScale(int note, const std::vector<int>& pitches);

    // Snap to nearest chord-tone MIDI pitch if within `tolerance` semitones,
    // else fall back to snapToScale. Empty chordPcs degenerates to plain
    // scale snap. Mirrors m4l/engine/quantizer.ts:98-115.
    int snapToChordTones(int note,
                         const std::vector<int>& chordPcs,
                         const std::vector<int>& scalePitches,
                         int tolerance = 2);

    // Diatonic Nth above/below `note` along `scalePitches`. interval=N is
    // N-1 scale steps (3rd = 2 steps, 4th = 3, 5th = 4, 6th = 5). Out-of-
    // scale input snaps first (tie-to-lower). Clamps at scale extremes
    // rather than wrapping. Mirrors m4l/engine/quantizer.ts:125-142.
    int diatonicShift(int note,
                      int interval,
                      HarmonyDirection direction,
                      const std::vector<int>& scalePitches);
}
