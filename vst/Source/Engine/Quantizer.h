// Quantizer engine per ADR 003 §"Engine boundary".
// Cross-target conformance vectors: docs/ai/quantizer-test-vectors.json
// (scale interval tables, snap rule, chord-mode rule, harmony-mode rule).
// Behavioral parity with m4l/engine/quantizer.ts is the binding contract.

#pragma once

#include <cstdint>
#include <vector>

#include "State.h"

namespace pointsman
{
    // Build the active scale's MIDI pitches across the full 0..127 range.
    // ChromaticHalf is the identity-passthrough sentinel and returns
    // [0,1,...,127] regardless of root (concept.md §"Scales (v1)").
    std::vector<int> buildScalePitches(ScaleName scale, int root);

    // In-place form for the audio-thread cache path. Clears `out` (keeping
    // capacity) and refills. The caller is expected to `out.reserve(128)`
    // once at prepareToPlay; subsequent (scale, root) changes then rewrite
    // the buffer without a heap allocation. Same output as the return-by-
    // value form — the test suite asserts parity.
    void buildScalePitchesInto(ScaleName scale, int root, std::vector<int>& out);

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

    // Mask form of the same rule. Bits 0..11 of `chordPcsMask` correspond
    // to pitch classes 0..11; bits >= 12 are ignored. Lets the audio
    // thread carry the chord context as a single std::atomic<uint16_t>
    // (lock-free, no allocation) instead of a std::vector<int>.
    int snapToChordTones(int note,
                         uint16_t chordPcsMask,
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
