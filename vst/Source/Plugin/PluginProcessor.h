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
    // APVTS state version. ADR 003 §"Persistence". v1 was the first persisted
    // shape; v2 is the Phase 5 surface redesign (chord-from-input + feel/drift
    // collapse). Phase 5 is a hard break: a v1 state tree is recognised by
    // the presence of any removed pid (or PointsmanState.version != "2")
    // and silently discarded — no migrator.
    constexpr int kStateVersion = 2;
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
    // Lock-free ring carrying each emitted output noteOn for the editor's
    // pulse-glow animation (ScaleKeyboardView). Chord mode emits N voices
    // per input within a single processBlock; a one-slot atomic would
    // collapse all but the last into a single visible pulse. The ring is
    // SPSC (audio thread writes, UI timer reads) and sized at 8 slots —
    // well above any plausible burst within one 60Hz UI poll.
    //
    // Each slot's value is the packed (version, channel, velocity, pitch)
    // tuple below. pulseRingHead_ is the monotonic count of emits and
    // doubles as the version of the most-recent entry; slot index for
    // version V is (V - 1) & kPulseRingMask.
    //
    // Reader pattern: acquire-load head; for each V in (lastSeenVersion,
    // head] read slot[(V-1) & mask] with acquire and confirm its packed
    // version equals V (else the slot was overwritten by the writer
    // wrapping around; drop it).
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

    static constexpr std::size_t kPulseRingSize = 8;
    static_assert((kPulseRingSize & (kPulseRingSize - 1)) == 0,
                  "kPulseRingSize must be a power of two");
    static constexpr uint32_t kPulseRingMask = kPulseRingSize - 1;

    std::array<std::atomic<uint64_t>, kPulseRingSize> pulseRing_{};
    std::atomic<uint32_t>                             pulseRingHead_{0};

    // ---- Test inspection ----
    // The tests/ binary needs visibility into a few normally-private bits
    // of state to assert panic discipline without instantiating a host.
    // The plugin runtime never calls these.
    void setHostIsPlayingForTest(bool playing) noexcept { testIsPlaying = playing; }
    uint64_t getLastEmittedPulseForTest() const noexcept
    {
        const uint32_t head = pulseRingHead_.load(std::memory_order_acquire);
        if (head == 0) return 0;
        return pulseRing_[(head - 1) & kPulseRingMask]
                 .load(std::memory_order_acquire);
    }
    uint32_t getPulseHeadForTest() const noexcept
    { return pulseRingHead_.load(std::memory_order_acquire); }

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

    // Harmony voices: written by the message thread (UI edits, preset
    // load), read by the audio thread on every input noteOn in
    // mode=harmony. The canonical container `harmonyVoices` is the
    // UI-side mutable state and is only accessed under
    // `harmonyVoicesLock_`. The audio side keeps a private fixed-size
    // snapshot (`harmonyVoicesAudio_` / count) refreshed via try-lock
    // when the version atomic shows a new edit; if the try-lock fails
    // the audio thread keeps the last-known-good cache for the block,
    // which preserves RT-safety without dropping voices on contention.
    std::vector<pointsman::HarmonyVoice> harmonyVoices;
    juce::SpinLock                       harmonyVoicesLock_;
    std::atomic<uint64_t>                harmonyVoicesVersion_{0};
    std::array<pointsman::HarmonyVoice,
               pointsman::kHarmonyVoicesMax> harmonyVoicesAudio_{};
    std::size_t harmonyVoicesAudioCount_   = 0;
    uint64_t    harmonyVoicesAudioVersion_ = 0;

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

    // Hard upper bounds on the scheduler buffers so processBlock never
    // re-allocates them on the audio thread. Sized at ~10× the typical
    // worst-case load (60Hz input × 4 chord voices × 5s max gate cap ≈
    // 1200 in-flight at peak); above this an input noteOn is dropped at
    // the push-back boundary rather than triggering a heap allocation in
    // the audio path. Drop-on-overrun is the convention for RT-safe MIDI
    // schedulers (a missed note is better than an audible glitch).
    static constexpr std::size_t kMaxPending  = 2048;
    // sounding_ grows by one entry per drained noteOn until its paired
    // noteOff drains; worst case is "all pending noteOns fire before any
    // noteOff fires", so the bound matches kMaxPending / 2.
    static constexpr std::size_t kMaxSounding = kMaxPending / 2;

    // Defensive cap on derived sourceStepDuration. A pathologically slow
    // input rate (multi-second gaps between noteOns) would otherwise
    // schedule a default-gate noteOff that far in the future — non-
    // musical and a uint64 cast hazard. 5 s is a half-note at 24 BPM,
    // well outside any normal play context. ADR 003 §"Post-Phase 4
    // audit follow-ups" #14, option (B): clamp at the bridge boundary.
    static constexpr double kMaxSourceStepMs = 5000.0;

    std::vector<PendingMidi> pending_;
    std::vector<ActiveNote>  sounding_;

    // Output MIDI buffer reused across blocks. Constructing a fresh
    // juce::MidiBuffer per processBlock allocated its internal byte array
    // every call; clear() on a member retains capacity, so steady-state
    // emits are amortized allocation-free on the audio thread.
    juce::MidiBuffer out_;

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

    // Test-time host-playing override. nullopt → use real playhead.
    // Encoded as int8 (-1 unset / 0 stopped / 1 playing) instead of
    // std::optional to keep the header dependency surface small.
    int testIsPlaying = -1;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PointsmanProcessor)
};
