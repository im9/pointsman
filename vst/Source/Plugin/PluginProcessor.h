#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <vector>

#include "Engine/Humanize.h"
#include "Engine/Quantizer.h"
#include "Engine/Rng.h"
#include "Engine/State.h"
#include "Plugin/Parameters.h"

namespace pointsman
{
    // APVTS state version. ADR 003 §"Persistence". v1 is the first persisted
    // shape; bump only on incompatible schema changes (with a migrator).
    constexpr int kStateVersion = 1;
}

class PointsmanProcessor : public juce::AudioProcessor
{
public:
    PointsmanProcessor();
    ~PointsmanProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "Pointsman"; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return true; }
    bool isMidiEffect() const override { return true; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock&) override;
    void setStateInformation(const void*, int) override;

    juce::AudioProcessorValueTreeState apvts;

    // ---- harmonyVoices (variable-length child of apvts.state) ----
    // The vector is the runtime source-of-truth for processBlock; it is
    // mirrored into apvts.state's "PointsmanState" child on getState and
    // re-read from there on setState. The setter also pushes the change
    // back into the tree so a host save right after a UI edit captures it.
    void setHarmonyVoices(std::vector<pointsman::HarmonyVoice> v);
    const std::vector<pointsman::HarmonyVoice>& getHarmonyVoices() const noexcept
    {
        return harmonyVoices;
    }

    // ---- Test inspection ----
    // The tests/ binary needs visibility into a few normally-private bits
    // of state to assert chord-context behaviour and panic discipline
    // without instantiating a host. The plugin runtime never calls these.
    const std::vector<int>& chordContextPcsForTest() const noexcept
    {
        return chordContext.pitchClasses;
    }
    void setHostIsPlayingForTest(bool playing) noexcept { testIsPlaying = playing; }

private:
    // Active emitted note tracked for panic. The map key is the tuple
    // (output channel, output pitch); duplicates collapse onto a refcount
    // so an input held while harmony voices retrigger does not orphan
    // entries.
    struct ActiveNoteKey
    {
        int channel; // 1..16
        int pitch;   // 0..127
        bool operator==(const ActiveNoteKey& o) const noexcept
        {
            return channel == o.channel && pitch == o.pitch;
        }
    };

    void emitPanicTo(juce::MidiBuffer& out, int sampleOffset);
    void writeNoteOnTracked(juce::MidiBuffer& out, int sample,
                            int channel, int pitch, int velocity);
    void writeNoteOffTracked(juce::MidiBuffer& out, int sample,
                             int channel, int pitch);

    void syncHarmonyVoicesToTree();
    void syncHarmonyVoicesFromTree();

    bool isHostPlaying() noexcept;
    bool channelMatches(int messageChannel, int paramChannel) const noexcept;

    pointsman::ChordContext chordContext;
    std::vector<pointsman::HarmonyVoice> harmonyVoices;

    // Map from input (channel, pitch) → list of (output channel, pitch)
    // emitted for that input. Used so noteOff on the input emits noteOff
    // for every voice that was issued (covers mode = harmony + base note).
    struct InputNote
    {
        int channel;
        int pitch;
        std::vector<ActiveNoteKey> outputs;
    };
    std::vector<InputNote> activeInputs;

    bool wasPlaying = false;
    uint32_t lastSeed = 0;          // re-seed RNG when seed param changes
    bool rngInitialised = false;
    pointsman::RngState rng{};
    pointsman::DriftState driftState{};

    // Test-time host-playing override. nullopt → use real playhead.
    // Encoded as int8 (-1 unset / 0 stopped / 1 playing) instead of
    // std::optional to keep the header dependency surface small.
    int testIsPlaying = -1;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PointsmanProcessor)
};
