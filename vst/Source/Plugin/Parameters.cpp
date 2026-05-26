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
        using APB = juce::AudioParameterBool;
        using APC = juce::AudioParameterChoice;
        using PID = juce::ParameterID;

        // ParameterID version-hint = kStateVersion (3 after ADR 004 Phase 2).
        // Hosts use this to track mismatch between persisted and current build.
        constexpr int versionHint = 3;

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

        // ADR 004 §"Chord shape primitive". 20-preset Choice (intervallic,
        // not diatonic). Default = Maj triad. The chordShape applies only
        // when mode ∈ {chord, arp}; in scale mode it is ignored.
        layout.add(std::make_unique<APC>(
            PID{pid::chordShape, versionHint}, "Chord Shape",
            toStringArray(kChordShapeChoiceLabels.data(),
                          kChordShapeChoiceLabels.size()),
            defaults::chordShape));

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

        // ADR 004 §"Arpeggiator parameters". Eight pids effective only
        // when mode == arp; they round-trip regardless of mode. The
        // 16-step accent / slide patterns are NOT here — they live on a
        // sibling ValueTree child (arpGroovePattern) to avoid polluting
        // the host's automation list with 32 per-cell pids.
        layout.add(std::make_unique<APC>(
            PID{pid::arpPattern, versionHint}, "Arp Pattern",
            toStringArray(kArpPatternChoiceLabels.data(),
                          kArpPatternChoiceLabels.size()),
            defaults::arpPattern));
        layout.add(std::make_unique<APC>(
            PID{pid::arpRate, versionHint}, "Arp Rate",
            toStringArray(kArpRateChoiceLabels.data(),
                          kArpRateChoiceLabels.size()),
            defaults::arpRate));
        layout.add(std::make_unique<API>(
            PID{pid::arpOctaves, versionHint}, "Arp Octaves",
            1, 4, defaults::arpOctaves));
        layout.add(std::make_unique<API>(
            PID{pid::arpStepRepeats, versionHint}, "Arp Step Repeats",
            1, 8, defaults::arpStepRepeats));
        layout.add(std::make_unique<APF>(
            PID{pid::arpGate, versionHint}, "Arp Gate",
            juce::NormalisableRange<float>(0.0f, 1.0f), defaults::arpGate));
        layout.add(std::make_unique<APF>(
            PID{pid::arpVariation, versionHint}, "Arp Variation",
            juce::NormalisableRange<float>(0.0f, 1.0f), defaults::arpVariation));
        layout.add(std::make_unique<APB>(
            PID{pid::arpLatch, versionHint}, "Arp Latch",
            defaults::arpLatch != 0));
        // arpSwing caps at 0.75 per ADR 004 §"Arpeggiator parameters" —
        // beyond that the swung tick collides with the next 16th.
        layout.add(std::make_unique<APF>(
            PID{pid::arpSwing, versionHint}, "Arp Swing",
            juce::NormalisableRange<float>(0.0f, 0.75f), defaults::arpSwing));

        return layout;
    }
}
