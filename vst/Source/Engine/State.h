// Engine-side state types per ADR 003 §"Engine boundary".
// POD only; pure C++17, no juce_*.
//
// ScaleName order is the on-disk APVTS Choice ordering (ADR 003
// §"Parameter persistence (APVTS)"): may only be appended, never reordered.
// Mirrors m4l/engine/quantizer.ts ScaleName literal ordering for the eventual
// cross-target preset converter (idx 0 = major, …, idx 14 = chromatic-half,
// idx 15 = phrygian-dominant per ADR 004).

#pragma once

#include <array>
#include <cstddef>
#include <vector>

namespace pointsman
{
    enum class ScaleName : int
    {
        Major = 0,
        Minor,
        Dorian,
        Phrygian,
        Lydian,
        Mixolydian,
        Locrian,
        Pentatonic,
        MinorPentatonic,
        Blues,
        Harmonic,
        Melodic,
        Whole,
        Chromatic,
        ChromaticHalf,
        PhrygianDominant,
    };

    constexpr std::size_t kScaleCount = 16;

    enum class HarmonyDirection
    {
        Above,
        Below,
    };

    // Canonical max length of the harmonyVoices stack per concept.md
    // §"Parameter surface" ("HarmonyVoice[] (length 0..3)"). Enforced at
    // the Plugin-layer boundary (PluginProcessor::setHarmonyVoices truncates)
    // so processBlock never iterates a 4th voice from preset load or any
    // other path that bypasses the editor `+` button.
    constexpr std::size_t kHarmonyVoicesMax = 3;

    // Diatonic voice-stack entry; interval is one of 3 / 4 / 5 / 6 per
    // concept.md §"Chord and harmony modes". Validated at the parameter
    // boundary (Plugin layer) before being passed to diatonicShift.
    // ADR 004 deprecates this in favour of ChordShape; removed when the
    // host/processor call sites land their v0.2 ports.
    struct HarmonyVoice
    {
        int interval = 3;
        HarmonyDirection direction = HarmonyDirection::Above;
    };

    // ========================================================================
    // ADR 004 — chord shape, arpeggiator, groove POD types
    // ========================================================================

    // Append-only. Position is the on-disk APVTS Choice index; mirrors
    // scripts/gen-test-vectors/chord.mjs CHORD_SHAPES bit-for-bit.
    enum class ChordShape : int
    {
        Maj = 0,    // 0 — major triad (default)
        Min,        // 1 — minor triad
        Dim,        // 2 — diminished triad
        Aug,        // 3 — augmented triad
        Sus2,       // 4
        Sus4,       // 5
        Power,      // 6 — 1-5 power chord
        Maj7,       // 7
        Min7,       // 8
        Dom7,       // 9 — dominant 7th
        Min7b5,     // 10 — half-diminished
        Dim7,       // 11
        Maj6,       // 12
        Min6,       // 13
        Add9,       // 14
        Maj9,       // 15
        Min9,       // 16
        Dom9,       // 17
        Dom13,      // 18
        Octave,     // 19 — root + octave
    };

    constexpr std::size_t kChordShapeCount = 20;

    // Append-only. Position is the on-disk APVTS Choice index; mirrors
    // scripts/gen-test-vectors/arp.mjs ARP_RATES bit-for-bit.
    enum class ArpRate : int
    {
        Q4 = 0, Q4D, Q4T,
        Q8, Q8D, Q8T,
        Q16, Q16D, Q16T,  // Q16 is the default
        Q32,
    };

    constexpr std::size_t kArpRateCount = 10;

    // Append-only. Position is the on-disk APVTS Choice index; mirrors
    // scripts/gen-test-vectors/arp.mjs ARP_PATTERNS bit-for-bit.
    enum class ArpPattern : int
    {
        Up = 0,
        Down,
        UpDown,
        Random,
        AsPlayed,
        Strike,
    };

    constexpr std::size_t kArpPatternCount = 6;

    // Pattern cursor state. Initial state is kInitialArpState; advance with
    // nextArpIndex. `direction` is +1 (climbing) or -1 (descending); only
    // ArpPattern::UpDown reads it. `repeatTick` is the step-repeat sub-counter
    // (0..arpStepRepeats-1).
    struct ArpState
    {
        int index = 0;
        int round = 0;
        int repeatTick = 0;
        int direction = 1;
    };

    constexpr ArpState kInitialArpState{ 0, 0, 0, 1 };

    // resolveArpStep output: either a non-empty pitches vector (Emit) or
    // a silent step (Rest).
    enum class ArpEmissionKind { Emit, Rest };

    struct ArpEmission
    {
        ArpEmissionKind kind = ArpEmissionKind::Rest;
        std::vector<int> pitches;
    };

    // applyArpVariation output. `pitches` populated for everything except
    // Rest. `semitones` is ±12 only when effect == OctaveShift, else 0.
    // `secondOffsetFraction` is 0.5 only when effect == Flam, else 0.0.
    enum class ArpVariationEffect { Rest, Normal, OctaveShift, Flam };

    struct ArpVariationResult
    {
        ArpVariationEffect effect = ArpVariationEffect::Rest;
        std::vector<int> pitches;
        int semitones = 0;
        double secondOffsetFraction = 0.0;
    };

    // applyArpGroove output. `applied` is false for rest emissions (the
    // other fields are then default-zero and should be ignored by the caller).
    struct ArpGrooveResult
    {
        bool applied = false;
        int velocity = 0;
        bool tieToNext = false;
        double swingOffsetSamples = 0.0;
    };

    // parseArpRate output: a rational quarter-notes-per-step. Target engines
    // reconstruct sample-count from the fraction (not the decimal) to avoid
    // float drift on triplet rates across long transports.
    struct ArpRateFraction
    {
        int num = 1;
        int den = 4;
    };

    // The 16-step accent / slide patterns are bar-relative tables indexed by
    // tickIndex mod 16. These aliases match the JSON test vector schema.
    using ArpAccentTable = std::array<int, 16>;
    using ArpSlideTable = std::array<bool, 16>;

}
