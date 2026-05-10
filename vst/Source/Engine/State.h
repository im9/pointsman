// Engine-side state types per ADR 003 §"Engine boundary".
// POD only; pure C++17, no juce_*.
//
// ScaleName order is the on-disk APVTS Choice ordering (ADR 003
// §"Parameter persistence (APVTS)"): may only be appended, never reordered.
// Mirrors m4l/engine/quantizer.ts ScaleName literal ordering for the eventual
// cross-target preset converter (idx 0 = major, …, idx 14 = chromatic-half).

#pragma once

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
    };

    constexpr std::size_t kScaleCount = 15;

    enum class HarmonyDirection
    {
        Above,
        Below,
    };

    // Diatonic voice-stack entry; interval is one of 3 / 4 / 5 / 6 per
    // concept.md §"Chord and harmony modes". Validated at the parameter
    // boundary (Plugin layer) before being passed to diatonicShift.
    struct HarmonyVoice
    {
        int interval = 3;
        HarmonyDirection direction = HarmonyDirection::Above;
    };

    // Held notes on the controlChannel collapsed to pitch classes (0..11).
    // The Plugin layer maintains this from real-time MIDI per concept.md
    // §"Chord and harmony modes"; snapToChordTones expands the set across
    // 0..127 each call.
    struct ChordContext
    {
        std::vector<int> pitchClasses; // 0..11
    };
}
