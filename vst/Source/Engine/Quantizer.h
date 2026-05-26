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
    // ADR 004 deprecates this in favour of applyChordShape; removed once
    // the host/processor v0.2 ports replace the call sites.
    int diatonicShift(int note,
                      int interval,
                      HarmonyDirection direction,
                      const std::vector<int>& scalePitches);

    // =====================================================================
    // ADR 004 — chord shape, arpeggiator, groove (pure functions)
    // =====================================================================
    //
    // Cross-target conformance: every function below has a matching JSON
    // section in docs/ai/quantizer-test-vectors.json and a 1:1 mirror in
    // m4l/engine/quantizer.ts. The vst tests in tests/test_Quantizer.cpp
    // iterate the JSON cases against these functions; m4l engine tests do
    // the same against the TS mirror. Behavioural divergence between the
    // two targets is the binding regression discipline.

    // Intervallic expansion from a snapped root. Voices that would exceed
    // [0, 127] are dropped (not clamped, not wrapped) per ADR 004
    // §"Chord shape primitive". Mirrors m4l applyChordShape.
    std::vector<int> applyChordShape(int rootMidi, ChordShape shape);

    // Returns the rational quarter-notes-per-step for the given rate.
    // Targets reconstruct sample-count from the fraction. Mirrors m4l
    // parseArpRate.
    ArpRateFraction parseArpRate(ArpRate rate);

    // Advances the arp cursor by one tick. `rngDraw01` ∈ [0, 1) is consumed
    // only by ArpPattern::Random; other patterns ignore it. Empty pool
    // returns the state unchanged. Mirrors m4l nextArpIndex.
    ArpState nextArpIndex(ArpPattern pattern,
                          ArpState state,
                          int poolSize,
                          int octaves,
                          int stepRepeats,
                          double rngDraw01);

    // Resolves the cursor to an emission. Traversal patterns return a
    // single voice; Strike returns the whole pool shifted uniformly.
    // Out-of-range pitches drop; if all drop or pool empty, returns
    // kind = Rest. Mirrors m4l resolveArpStep.
    ArpEmission resolveArpStep(const std::vector<int>& pool,
                               int index,
                               int octaveRound,
                               ArpPattern pattern);

    // Probability cascade per ADR 004 §"Variation modulation". At v = 0
    // every emission is Normal (RNG draws unused). Octave shift falls
    // through to Normal if any voice would exit [0, 127] (preserves
    // chord-shape integrity for Strike). Mirrors m4l applyArpVariation.
    ArpVariationResult applyArpVariation(const ArpEmission& emission,
                                         double variation,
                                         double rngDraw01,
                                         double rngDraw02);

    // Deterministic groove per ADR 004 §"Groove layer". velocity =
    // accentTable[tickIndex mod 16]; tieToNext = slideTable[tickIndex mod
    // 16]; swingOffsetSamples = swing × (sixteenthDurationSamples / 2)
    // when tickIndex is odd, else 0. Rest emissions short-circuit
    // (applied = false). Mirrors m4l applyArpGroove.
    ArpGrooveResult applyArpGroove(const ArpVariationResult& emission,
                                   int tickIndex,
                                   const ArpAccentTable& accentTable,
                                   const ArpSlideTable& slideTable,
                                   double swing,
                                   double sixteenthDurationSamples);

    // Slide-aware noteOff sample offset relative to this tick's noteOn.
    // Non-slide → gateSamples; Slide → nextTickSampleOffset (arpGate is
    // overridden, full overlap into the next tick). Mirrors m4l
    // scheduleArpNoteOff.
    double scheduleArpNoteOff(bool slideOnCurrent,
                              double gateSamples,
                              double nextTickSampleOffset);
}
