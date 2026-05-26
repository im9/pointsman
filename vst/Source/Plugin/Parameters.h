// APVTS parameter shape per ADR 003 §"Parameter persistence (APVTS)" /
// Phase 5 §"Parameter surface redesign" + ADR 004 Phase 2 §"Persistence".
// pid identifiers and Choice index orderings are the on-disk format and
// may only be appended, never reordered.
//
// v3 surface (concept.md §"Parameter surface (canonical)", ADR 004):
//   scale / root / mode / chordShape / feel / drift / inputChannel /
//   seed / kbdRange* + 8 arp pids (arpPattern, arpRate, arpOctaves,
//   arpStepRepeats, arpGate, arpVariation, arpLatch, arpSwing). The
//   16-step accent / slide patterns live in a sibling ValueTree child
//   (arpGroovePattern) rather than as 32 automatable pids.
//
// Legacy schema deltas:
// - v1→v2 removed: humanizeVelocity / humanizeGate / humanizeTiming /
//   humanizeDrift / outputLevel / triggerMode / controlChannel.
// - v2→v3 removed: harmonyVoices (was a PointsmanState ValueTree child,
//   not a PARAM pid, but listed here for legacy-detection purposes).
// kStateVersion bumped to 3; a v1 OR v2 state tree is recognised and
// silently discarded (no migrator) per ADR 003 Phase 5 + ADR 004 Phase 2.

#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include <array>

#include "Engine/State.h"

namespace pointsman::pid
{
    inline constexpr const char* scale          = "scale";
    inline constexpr const char* root           = "root";
    inline constexpr const char* mode           = "mode";
    inline constexpr const char* chordShape     = "chordShape";
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

    // ADR 004 arp params (effective only when mode == arp; round-trip
    // through APVTS regardless of mode).
    inline constexpr const char* arpPattern     = "arpPattern";
    inline constexpr const char* arpRate        = "arpRate";
    inline constexpr const char* arpOctaves     = "arpOctaves";
    inline constexpr const char* arpStepRepeats = "arpStepRepeats";
    inline constexpr const char* arpGate        = "arpGate";
    inline constexpr const char* arpVariation   = "arpVariation";
    inline constexpr const char* arpLatch       = "arpLatch";
    inline constexpr const char* arpSwing       = "arpSwing";

    // Pids that existed in an earlier schema and are removed in v3.
    // Listed here as a const array so setStateInformation can scan an
    // incoming state tree for any of them and detect "this is a legacy
    // tree" without having to resurrect the older layout. The first
    // seven entries are the v1 set (ADR 003 Phase 5); "harmonyVoices"
    // is included for documentation even though it was never a PARAM
    // pid — it was a PointsmanState ValueTree child in v2, and v2 is
    // additionally detected by the version property + child node scan
    // in setStateInformation. ADR 003 Phase 5 + ADR 004 Phase 2
    // §"Persistence".
    inline constexpr std::array<const char*, 8> kRemovedLegacyPids = {
        "humanizeVelocity",
        "humanizeGate",
        "humanizeTiming",
        "humanizeDrift",
        "outputLevel",
        "triggerMode",
        "controlChannel",
        "harmonyVoices",
    };
}

namespace pointsman::defaults
{
    inline constexpr int    scale          = 0;   // major
    inline constexpr int    root           = 0;   // C
    inline constexpr int    mode           = 0;   // scale
    inline constexpr int    chordShape     = 0;   // Maj (ADR 004 default)
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

    // ADR 004 arp defaults.
    inline constexpr int    arpPattern     = 0;   // Up
    inline constexpr int    arpRate        = 6;   // 1/16
    inline constexpr int    arpOctaves     = 1;
    inline constexpr int    arpStepRepeats = 1;
    inline constexpr float  arpGate        = 0.5f;
    inline constexpr float  arpVariation   = 0.0f;
    inline constexpr int    arpLatch       = 0;   // off
    inline constexpr float  arpSwing       = 0.0f;
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

    // ADR 004 §"Mode is exclusive, three values". Index order is the
    // on-disk APVTS Choice index — append-only.
    enum class ModeChoice : int { Scale = 0, Chord = 1, Arp = 2 };
    inline constexpr std::array<const char*, 3> kModeChoiceLabels = {
        "Scale", "Chord", "Arp"
    };

    // ADR 004 §"Chord shape primitive". Order mirrors the ChordShape
    // enum and scripts/gen-test-vectors/chord.mjs CHORD_SHAPES.
    inline constexpr std::array<const char*, kChordShapeCount> kChordShapeChoiceLabels = {
        "Maj", "Min", "Dim", "Aug", "Sus2", "Sus4", "Power",
        "Maj7", "Min7", "Dom7", "Min7b5", "Dim7", "Maj6", "Min6",
        "Add9", "Maj9", "Min9", "Dom9", "Dom13", "Octave"
    };

    // ADR 004 §"Arpeggiator parameters". Order mirrors the ArpRate /
    // ArpPattern enums.
    inline constexpr std::array<const char*, kArpRateCount> kArpRateChoiceLabels = {
        "1/4", "1/4D", "1/4T",
        "1/8", "1/8D", "1/8T",
        "1/16", "1/16D", "1/16T",
        "1/32"
    };
    inline constexpr std::array<const char*, kArpPatternCount> kArpPatternChoiceLabels = {
        "Up", "Down", "Up-Down", "Random", "As Played", "Strike"
    };

    // Random seed drawn for new PluginProcessor instances per concept.md
    // §"Per-event humanize" ("New plugin instances pick a random seed on
    // construction"). Single source of truth so both the runtime
    // constructor and any test harness can pull from the same RNG.
    // Range matches the seed parameter: [0, 0xffffff].
    int makeRandomSeedForNewInstance();

    juce::AudioProcessorValueTreeState::ParameterLayout makeParameterLayout(int initialSeed);
}
