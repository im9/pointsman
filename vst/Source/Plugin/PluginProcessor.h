#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <atomic>
#include <cstdint>
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

    // ---- Pulse-on-emit signal (audio → UI thread) ----
    // Lock-free signal carrying the most recently emitted output noteOn
    // for the editor's pulse-glow animation (ScaleKeyboardView). One
    // 64-bit atomic so a single acquire load on the UI thread observes a
    // coherent (version, channel, velocity, pitch) tuple. Reader pattern:
    // load with acquire; if the upper-32-bit version > lastSeenVersion,
    // unpack and append a new pulse to the local animation list.
    //
    // Layout (LSB → MSB):
    //   bits  0.. 7: MIDI pitch    (0..127)
    //   bits  8..15: velocity      (1..127)
    //   bits 16..23: MIDI channel  (1..16)
    //   bits 24..31: reserved (0)
    //   bits 32..63: monotonic version counter
    static constexpr int kPulsePitchShift    = 0;
    static constexpr int kPulseVelocityShift = 8;
    static constexpr int kPulseChannelShift  = 16;
    static constexpr int kPulseVersionShift  = 32;
    static constexpr uint64_t kPulseByteMask = 0xffull;

    static uint64_t packPulse(uint32_t version,
                              int pitch,
                              int velocity,
                              int channel) noexcept
    {
        return (static_cast<uint64_t>(version)        << kPulseVersionShift)
             | (static_cast<uint64_t>(channel  & 0xff) << kPulseChannelShift)
             | (static_cast<uint64_t>(velocity & 0xff) << kPulseVelocityShift)
             | (static_cast<uint64_t>(pitch    & 0xff) << kPulsePitchShift);
    }

    static uint32_t unpackPulseVersion(uint64_t packed) noexcept
    { return static_cast<uint32_t>(packed >> kPulseVersionShift); }
    static int unpackPulsePitch(uint64_t packed) noexcept
    { return static_cast<int>((packed >> kPulsePitchShift) & kPulseByteMask); }
    static int unpackPulseVelocity(uint64_t packed) noexcept
    { return static_cast<int>((packed >> kPulseVelocityShift) & kPulseByteMask); }
    static int unpackPulseChannel(uint64_t packed) noexcept
    { return static_cast<int>((packed >> kPulseChannelShift) & kPulseByteMask); }

    std::atomic<uint64_t> lastEmittedPulse{0};

    // ---- Test inspection ----
    // The tests/ binary needs visibility into a few normally-private bits
    // of state to assert chord-context behaviour and panic discipline
    // without instantiating a host. The plugin runtime never calls these.
    const std::vector<int>& chordContextPcsForTest() const noexcept
    {
        return chordContext.pitchClasses;
    }
    void setHostIsPlayingForTest(bool playing) noexcept { testIsPlaying = playing; }
    uint64_t getLastEmittedPulseForTest() const noexcept
    { return lastEmittedPulse.load(std::memory_order_acquire); }

private:
    void emitPanicTo(juce::MidiBuffer& out, int sampleOffset);
    void writeNoteOnTracked(juce::MidiBuffer& out, int sample,
                            int channel, int pitch, int velocity);
    void writeNoteOffTracked(juce::MidiBuffer& out, int sample,
                             int channel, int pitch);

    // Drain pending events whose target absolute sample falls in
    // [blockStartAbs_, blockStartAbs_ + numSamples). Sorted by target so
    // tie-broken noteOn-before-noteOff at the same sample yields a
    // well-formed output buffer even at gate length 0. Updates `sounding_`
    // alongside (push on noteOn, pop matching on noteOff) so panic /
    // transport-stop has an accurate roster of currently-sounding outputs.
    void drainPendingInto(juce::MidiBuffer& out, int numSamples);

    void syncHarmonyVoicesToTree();
    void syncHarmonyVoicesFromTree();

    bool isHostPlaying() noexcept;
    bool channelMatches(int messageChannel, int paramChannel) const noexcept;

    pointsman::ChordContext chordContext;
    std::vector<pointsman::HarmonyVoice> harmonyVoices;

    // ── Humanize-driven output scheduler (ADR 003 Phase 4) ──
    // Pointsman's output gate is humanize-driven, NOT input-noteOff-driven
    // (concept.md §"Per-event humanize"; m4l/host/host.ts:222-230 ignores
    // input noteOffs for output gating). Each input noteOn produces a pair
    // of pending events: an output noteOn at (input sample +
    // timingOffset) and an output noteOff at (output noteOn +
    // gateFinal × sourceStepDuration). Pending events are drained per
    // block as their absolute sample target falls within the block window.
    struct PendingMidi
    {
        uint64_t targetSampleAbs;
        int      channel;   // 1..16
        int      pitch;     // 0..127
        int      velocity;  // 1..127 for noteOn; 0 for noteOff
        bool     isNoteOn;
    };
    struct ActiveNote
    {
        int channel;
        int pitch;
    };

    // First-event source-step fallback, ms. Same value as
    // m4l/host/host.ts FIRST_EVENT_STEP_MS = 250. Generic across common
    // tempos (16th @ 60 BPM, 8th @ 120 BPM, quarter @ 240 BPM).
    static constexpr double kFirstEventStepMs = 250.0;

    std::vector<PendingMidi> pending_;
    std::vector<ActiveNote>  sounding_;

    double   sampleRate_         = 44100.0;
    uint64_t blockStartAbs_      = 0;     // absolute sample counter from prepareToPlay
    uint64_t lastInputSampleAbs_ = 0;     // most recent input noteOn (post-channel-match)
    bool     haveLastInput_      = false;

    // Cache of buildScalePitches((scale, root)). Rebuilt only when either
    // input changes; the audio thread reads cachedScalePitches_ as a const
    // reference. Avoids allocating a fresh std::vector<int> with up to
    // 128 entries on every processBlock call.
    std::vector<int> cachedScalePitches_;
    int cachedScaleIdx_ = -1;       // sentinel; first compare forces rebuild
    int cachedRootPc_   = -1;

    bool wasPlaying = false;
    uint32_t lastSeed = 0;          // re-seed RNG when seed param changes
    bool rngInitialised = false;
    pointsman::RngState rng{};
    pointsman::DriftState driftState{};
    uint32_t pulseVersion = 0;      // monotonic; bumped before each pulse store

    // Test-time host-playing override. nullopt → use real playhead.
    // Encoded as int8 (-1 unset / 0 stopped / 1 playing) instead of
    // std::optional to keep the header dependency surface small.
    int testIsPlaying = -1;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PointsmanProcessor)
};
