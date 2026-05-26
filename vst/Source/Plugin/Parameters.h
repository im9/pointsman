// APVTS parameter shape per ADR 003 §"Parameter persistence (APVTS)" and
// Phase 5 §"Parameter surface redesign". pid identifiers and Choice index
// orderings are the on-disk format and may only be appended, never reordered.
//
// v2 surface (concept.md §"Parameter surface (canonical)"):
//   scale / root / mode / harmonyVoices (ValueTree child, not a pid) /
//   feel / drift / inputChannel / seed (+ kbdRange* view-state).
//
// v1 surface deltas: humanizeVelocity / humanizeGate / humanizeTiming /
// humanizeDrift / outputLevel / triggerMode / controlChannel removed.
// kStateVersion bumped to 2; a v1 state tree is recognised and discarded
// (no migrator) per ADR 003 Phase 5.

#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include <array>

#include "Engine/State.h"

namespace pointsman::pid
{
    inline constexpr const char* scale          = "scale";
    inline constexpr const char* root           = "root";
    inline constexpr const char* mode           = "mode";
    inline constexpr const char* feel           = "feel";
    inline constexpr const char* drift          = "drift";
    inline constexpr const char* inputChannel   = "inputChannel";
    inline constexpr const char* seed           = "seed";
    // Keyboard display range (low / high MIDI). View-state, but persisted
    // with the host project so users can pick a per-session register and
    // have it reload. Bounds 24..108 (C1..C8) match the standard 88-key
    // piano window; the slider is also responsible for enforcing
    // hi >= lo + 11 (≥1 octave displayed).
    inline constexpr const char* kbdRangeLoNote = "kbdRangeLoNote";
    inline constexpr const char* kbdRangeHiNote = "kbdRangeHiNote";

    // Pids that existed in v1 and are removed in v2. Listed here as a
    // const array so setStateInformation can scan an incoming state tree
    // for any of them and detect "this is a v1 tree" without having to
    // resurrect the v1 layout. ADR 003 Phase 5 §"v1 state discard".
    inline constexpr std::array<const char*, 7> kRemovedV1Pids = {
        "humanizeVelocity",
        "humanizeGate",
        "humanizeTiming",
        "humanizeDrift",
        "outputLevel",
        "triggerMode",
        "controlChannel",
    };
}

namespace pointsman::defaults
{
    inline constexpr int    scale          = 0;   // major
    inline constexpr int    root           = 0;   // C
    inline constexpr int    mode           = 0;   // scale
    inline constexpr float  feel           = 0.0f;
    inline constexpr float  drift          = 0.0f;
    inline constexpr int    inputChannel   = 0;   // omni
    // seed default is "random per instance" — defaults::seed is just the
    // ParameterInt range floor, not the runtime default. The processor
    // constructor draws a fresh seed in [0, 0xffffff] before building the
    // APVTS, so that random value becomes the parameter's initial state
    // (concept.md §"Per-event humanize").
    inline constexpr int    seed           = 0;
    inline constexpr int    kbdRangeLoNote = 36; // C3 — matches the legacy
    inline constexpr int    kbdRangeHiNote = 71; // B5 — fixed 3-oct window
}

namespace pointsman
{
    // Display strings for the Choice parameters. Order is the on-disk
    // index — append-only.
    inline constexpr std::array<const char*, kScaleCount> kScaleChoiceLabels = {
        "Major", "Minor", "Dorian", "Phrygian", "Lydian", "Mixolydian",
        "Locrian", "Pentatonic", "Minor Pentatonic", "Blues", "Harmonic",
        "Melodic", "Whole", "Chromatic", "Chromatic Half", "Phrygian Dominant"
    };

    // Phase 5 post-merge: 2 modes only. Chord absorbs the former Harmony
    // mode's voice-stack semantics (1 + N notes), with a default 1-3-5
    // diatonic triad pre-populated in harmonyVoices so out-of-the-box
    // behaviour matches the "single note becomes a chord" intent.
    enum class ModeChoice : int { Scale = 0, Chord = 1 };
    inline constexpr std::array<const char*, 2> kModeChoiceLabels = {
        "Scale", "Chord"
    };

    // Random seed drawn for new PluginProcessor instances per concept.md
    // §"Per-event humanize" ("New plugin instances pick a random seed on
    // construction"). Single source of truth so both the runtime
    // constructor and any test harness can pull from the same RNG.
    // Range matches the seed parameter: [0, 0xffffff].
    int makeRandomSeedForNewInstance();

    juce::AudioProcessorValueTreeState::ParameterLayout makeParameterLayout(int initialSeed);
}
