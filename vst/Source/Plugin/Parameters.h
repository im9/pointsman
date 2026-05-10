// APVTS parameter shape per ADR 003 §"Parameter persistence (APVTS)".
// pid identifiers and Choice index orderings are the on-disk format and may
// only be appended, never reordered.

#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include <array>

#include "Engine/State.h"

namespace pointsman::pid
{
    inline constexpr const char* scale            = "scale";
    inline constexpr const char* root             = "root";
    inline constexpr const char* mode             = "mode";
    inline constexpr const char* humanizeVelocity = "humanizeVelocity";
    inline constexpr const char* humanizeGate     = "humanizeGate";
    inline constexpr const char* humanizeTiming   = "humanizeTiming";
    inline constexpr const char* humanizeDrift    = "humanizeDrift";
    inline constexpr const char* outputLevel      = "outputLevel";
    inline constexpr const char* triggerMode      = "triggerMode";
    inline constexpr const char* inputChannel     = "inputChannel";
    inline constexpr const char* controlChannel   = "controlChannel";
    inline constexpr const char* seed             = "seed";
}

namespace pointsman::defaults
{
    inline constexpr int    scale            = 0;   // major
    inline constexpr int    root             = 0;   // C
    inline constexpr int    mode             = 0;   // scale
    inline constexpr float  humanizeVelocity = 0.0f;
    inline constexpr float  humanizeGate     = 0.0f;
    inline constexpr float  humanizeTiming   = 0.0f;
    inline constexpr float  humanizeDrift    = 0.0f;
    inline constexpr float  outputLevel      = 1.0f;
    inline constexpr int    triggerMode      = 0;   // passthrough
    inline constexpr int    inputChannel     = 0;   // omni
    inline constexpr int    controlChannel   = 1;
    inline constexpr int    seed             = 0;
}

namespace pointsman
{
    // Display strings for the Choice parameters. Order is the on-disk
    // index — append-only.
    inline constexpr std::array<const char*, kScaleCount> kScaleChoiceLabels = {
        "Major", "Minor", "Dorian", "Phrygian", "Lydian", "Mixolydian",
        "Locrian", "Pentatonic", "Minor Pentatonic", "Blues", "Harmonic",
        "Melodic", "Whole", "Chromatic", "Chromatic Half"
    };

    enum class ModeChoice : int { Scale = 0, Chord = 1, Harmony = 2 };
    inline constexpr std::array<const char*, 3> kModeChoiceLabels = {
        "Scale", "Chord", "Harmony"
    };

    enum class TriggerModeChoice : int { Passthrough = 0, Root = 1 };
    inline constexpr std::array<const char*, 2> kTriggerModeChoiceLabels = {
        "Passthrough", "Root"
    };

    juce::AudioProcessorValueTreeState::ParameterLayout makeParameterLayout();
}
