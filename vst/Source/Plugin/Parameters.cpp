#include "Parameters.h"

#include <juce_core/juce_core.h>

namespace pointsman
{
    namespace
    {
        juce::StringArray toStringArray(const char* const* labels, std::size_t n)
        {
            juce::StringArray a;
            for (std::size_t i = 0; i < n; ++i) a.add(labels[i]);
            return a;
        }
    }

    int makeRandomSeedForNewInstance()
    {
        // 24-bit range; juce::Random::getSystemRandom() is fine for
        // "shake the humanize seed" — we are not signing anything.
        return juce::Random::getSystemRandom().nextInt({0, 0x1000000});
    }

    juce::AudioProcessorValueTreeState::ParameterLayout makeParameterLayout(int initialSeed)
    {
        using APF = juce::AudioParameterFloat;
        using API = juce::AudioParameterInt;
        using APC = juce::AudioParameterChoice;
        using PID = juce::ParameterID;

        // ParameterID version-hint = kStateVersion (2 after Phase 5). Hosts
        // use this to track mismatch between persisted and current build.
        constexpr int versionHint = 2;

        juce::AudioProcessorValueTreeState::ParameterLayout layout;

        layout.add(std::make_unique<APC>(
            PID{pid::scale, versionHint}, "Scale",
            toStringArray(kScaleChoiceLabels.data(), kScaleChoiceLabels.size()),
            defaults::scale));

        layout.add(std::make_unique<API>(
            PID{pid::root, versionHint}, "Root",
            0, 11, defaults::root));

        layout.add(std::make_unique<APC>(
            PID{pid::mode, versionHint}, "Mode",
            toStringArray(kModeChoiceLabels.data(), kModeChoiceLabels.size()),
            defaults::mode));

        // feel: single 0..1 amount driving signed-uniform noise on
        // velocity / gate / timing axes (concept.md §"Per-event humanize").
        // drift: EMA smoothing across the three axes; 0 = independent
        // draws (jittery); near 1 = slow drift.
        layout.add(std::make_unique<APF>(
            PID{pid::feel,  versionHint}, "Feel",
            juce::NormalisableRange<float>(0.0f, 1.0f), defaults::feel));
        layout.add(std::make_unique<APF>(
            PID{pid::drift, versionHint}, "Drift",
            juce::NormalisableRange<float>(0.0f, 1.0f), defaults::drift));

        layout.add(std::make_unique<API>(
            PID{pid::inputChannel, versionHint}, "Input Channel",
            0, 16, defaults::inputChannel));

        // Seed range 0..2^24-1 (≈16.7M values). Bounded by IEEE-754 single-
        // precision mantissa: APVTS stores parameter values as float32, and
        // every integer in [0, 2^24] is exactly representable, so persisted
        // seeds round-trip bit-identical. Above 2^24 the host save/reopen
        // path silently quantises the value. 16M+ unique presets is more
        // than enough headroom for a humanize seed selector.
        //
        // Default is `initialSeed` — passed in by the processor constructor
        // so the random-per-instance seed (concept.md §"Per-event humanize")
        // becomes the parameter's APVTS default and is captured by the
        // host's first save.
        layout.add(std::make_unique<API>(
            PID{pid::seed, versionHint}, "Seed",
            0, 0xffffff,
            juce::jlimit(0, 0xffffff, initialSeed)));

        // Keyboard display range. Two MIDI Int params bound to a
        // TwoValueHorizontal slider in the editor's DISPLAY group.
        // Bounds 36..108 = C3..C8: lower bound matches the legacy
        // kbdOctLo == 3 anchor so users never see octave -1 / 0 / 1
        // notes (Pointsman is musical, not a piano keyboard demo), and
        // the upper bound covers the practical input range. Append-only
        // per ADR 003 §"Parameter persistence" — older state trees
        // without these params fall back to APVTS's default = 36/71,
        // which matches the pre-feature C3..B5 layout.
        layout.add(std::make_unique<API>(
            PID{pid::kbdRangeLoNote, versionHint}, "Keyboard Range Lo",
            36, 108, defaults::kbdRangeLoNote));
        layout.add(std::make_unique<API>(
            PID{pid::kbdRangeHiNote, versionHint}, "Keyboard Range Hi",
            36, 108, defaults::kbdRangeHiNote));

        return layout;
    }
}
