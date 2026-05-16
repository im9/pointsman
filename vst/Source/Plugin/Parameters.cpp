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

    juce::AudioProcessorValueTreeState::ParameterLayout makeParameterLayout()
    {
        using APF = juce::AudioParameterFloat;
        using API = juce::AudioParameterInt;
        using APC = juce::AudioParameterChoice;
        using PID = juce::ParameterID;

        // ParameterID version-hint = kStateVersion (1). Hosts use this to track
        // mismatch between persisted and current build; never bump for
        // additions, only for incompatible reorderings (which are forbidden
        // by ADR 003 §"Parameter persistence").
        constexpr int versionHint = 1;

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

        layout.add(std::make_unique<APF>(
            PID{pid::humanizeVelocity, versionHint}, "Humanize Velocity",
            juce::NormalisableRange<float>(0.0f, 1.0f), defaults::humanizeVelocity));
        layout.add(std::make_unique<APF>(
            PID{pid::humanizeGate, versionHint}, "Humanize Gate",
            juce::NormalisableRange<float>(0.0f, 1.0f), defaults::humanizeGate));
        layout.add(std::make_unique<APF>(
            PID{pid::humanizeTiming, versionHint}, "Humanize Timing",
            juce::NormalisableRange<float>(0.0f, 1.0f), defaults::humanizeTiming));
        layout.add(std::make_unique<APF>(
            PID{pid::humanizeDrift, versionHint}, "Humanize Drift",
            juce::NormalisableRange<float>(0.0f, 1.0f), defaults::humanizeDrift));

        layout.add(std::make_unique<APF>(
            PID{pid::outputLevel, versionHint}, "Output Level",
            juce::NormalisableRange<float>(0.0f, 1.0f), defaults::outputLevel));

        layout.add(std::make_unique<APC>(
            PID{pid::triggerMode, versionHint}, "Trigger Mode",
            toStringArray(kTriggerModeChoiceLabels.data(),
                          kTriggerModeChoiceLabels.size()),
            defaults::triggerMode));

        layout.add(std::make_unique<API>(
            PID{pid::inputChannel, versionHint}, "Input Channel",
            0, 16, defaults::inputChannel));
        layout.add(std::make_unique<API>(
            PID{pid::controlChannel, versionHint}, "Control Channel",
            1, 16, defaults::controlChannel));

        // Seed range 0..2^24-1 (≈16.7M values). Bounded by IEEE-754 single-
        // precision mantissa: APVTS stores parameter values as float32, and
        // every integer in [0, 2^24] is exactly representable, so persisted
        // seeds round-trip bit-identical. Above 2^24 the host save/reopen
        // path silently quantises the value. 16M+ unique presets is more
        // than enough headroom for a humanize seed selector.
        layout.add(std::make_unique<API>(
            PID{pid::seed, versionHint}, "Seed",
            0, 0xffffff, defaults::seed));

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
