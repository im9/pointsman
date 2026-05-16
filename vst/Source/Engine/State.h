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

    // Canonical max length of the harmonyVoices stack per concept.md
    // §"Parameter surface" ("HarmonyVoice[] (length 0..3)"). Enforced at
    // the Plugin-layer boundary (PluginProcessor::setHarmonyVoices truncates)
    // so processBlock never iterates a 4th voice from preset load or any
    // other path that bypasses the editor `+` button.
    constexpr std::size_t kHarmonyVoicesMax = 3;

    // Diatonic voice-stack entry; interval is one of 3 / 4 / 5 / 6 per
    // concept.md §"Chord and harmony modes". Validated at the parameter
    // boundary (Plugin layer) before being passed to diatonicShift.
    struct HarmonyVoice
    {
        int interval = 3;
        HarmonyDirection direction = HarmonyDirection::Above;
    };

}
