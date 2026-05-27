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
    // APVTS state version. ADR 003 §"Persistence" + ADR 004 Phase 2
    // §"Persistence". v1 was the first persisted shape; v2 was Phase 5's
    // surface redesign (chord-from-input + feel/drift collapse); v3 is
    // ADR 004's chord-shape primitive + arp surface (harmonyVoices
    // ValueTree child removed, chordShape Choice added, mode extended
    // to Arp, 8 arp pids added, arpGroovePattern sibling child added).
    // Each bump is a hard break: a legacy state tree is recognised by
    // PointsmanState.version != kStateVersion OR any removed pid present
    // OR any HarmonyVoice child node and silently discarded — no migrator.
    constexpr int kStateVersion = 3;
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

    // ---- harmonyVoices (vestige API, ADR 004 Phase 2) ----
    // Chord expansion now goes through chordShape (intervallic, ADR 004).
    // setHarmonyVoices / getHarmonyVoices remain as an in-memory-only
    // shim so the v0.1 editor's HARMONY group still compiles and runs
    // (its widget edits store into this vector but have no audible
    // effect — processBlock does not read it). Phase 4 deletes the
    // HARMONY group entirely, at which point these methods go too.
    // Not persisted: schema v3 carries no HarmonyVoice ValueTree
    // child, and the v2 → v3 detector treats any HarmonyVoice node as
    // a legacy marker.
    void setHarmonyVoices(std::vector<pointsman::HarmonyVoice> v);
    const std::vector<pointsman::HarmonyVoice>& getHarmonyVoices() const noexcept
    {
        return harmonyVoices;
    }

    // ---- arpGroovePattern (16-step accent + slide) ----
    // ADR 004 §"Groove layer" + §"Persistence". Stored as a sibling
    // ValueTree child on apvts.state (not as 32 APVTS pids) so the
    // host's automation list is not polluted with per-cell entries.
    // Round-tripped through getStateInformation / setStateInformation
    // alongside the standard APVTS state. The setter clamps each cell
    // (velocity to [0, 127]); the getter returns the canonical table.
    // Phase 2 sub-step A wires the persistence + API; sub-step B
    // consumes the tables in the arp clock.
    void setArpAccent(const pointsman::ArpAccentTable& accent);
    void setArpSlide (const pointsman::ArpSlideTable&  slide);
    const pointsman::ArpAccentTable& getArpAccent() const noexcept { return arpAccent_; }
    const pointsman::ArpSlideTable&  getArpSlide()  const noexcept { return arpSlide_;  }

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
    // ADR 004 Phase 2-B arp clock needs a BPM source; in test, the JUCE
    // playhead returns nullopt (no host), so we let the suite inject the
    // value and bypass the playhead read.
    void setBpmForTest(double bpm) noexcept { testBpm_ = bpm; }
    std::size_t getArpPoolSizeForTest() const noexcept { return arpPool_.size(); }
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
    void syncArpGroovePatternToTree();
    void syncArpGroovePatternFromTree();

    // ── ADR 004 Phase 2-B arp clock helpers ──
    void resetArpRuntimeState() noexcept;
    void addArpVoices(int sourceCh, int sourcePitch, int sourceVel,
                      pointsman::ChordShape shape,
                      const std::vector<int>& scalePitches);
    void removeArpVoicesForSource(int sourceCh, int sourcePitch);
    void rebuildArpPool(pointsman::ChordShape shape,
                        const std::vector<int>& scalePitches);
    void runArpClock(int numSamples,
                     pointsman::ArpPattern pattern,
                     pointsman::ArpRate rate,
                     int octaves, int stepRepeats,
                     float gateBase, float variation, float swing,
                     float feel, float driftFactor,
                     double bpm,
                     int outputChannel);

    bool isHostPlaying() noexcept;
    bool channelMatches(int messageChannel, int paramChannel) const noexcept;
    double getHostBpm() noexcept;

    // Vestige container (ADR 004 Phase 2). The v0.1 editor's HARMONY
    // group still pokes at this vector and listens to the matching
    // ValueTree children (`HarmonyVoice` nodes under `PointsmanState`)
    // to rebuild its badges. processBlock does NOT read it — chord
    // expansion is intervallic via `chordShape`. Tree mirroring stays
    // so the editor's listener fires on +/− edits; Phase 4 deletes the
    // group + this vector + the sync helpers in one cut. The spinlock
    // protects message-thread mutators (UI edits, setStateInformation)
    // against background-thread getStateInformation calls some preset-
    // preview hosts make.
    std::vector<pointsman::HarmonyVoice> harmonyVoices;
    juce::SpinLock                       harmonyVoicesLock_;

    // 16-step accent / slide patterns. Message-thread mutated (UI edits,
    // setStateInformation), audio-thread read in the arp clock. Storage
    // is the message-thread canonical copy + a lock-free audio-side
    // snapshot refreshed via a version counter so the message thread can
    // edit cells without blocking the audio thread. Editor edits that
    // miss a try-lock simply ride the previous block's snapshot — RT-safe.
    pointsman::ArpAccentTable arpAccent_{};
    pointsman::ArpSlideTable  arpSlide_{};

    // ── ADR 004 Phase 2-B arp clock state ──
    // The pool is the set of voices the arp iterates. Each entry tags
    // its contributing input note so noteOff drives the right removal.
    // Pool entries are deduplicated by (pitch, channel); a duplicate
    // contributor's source tag is dropped to keep the entry single-tagged
    // (m4l parity, ADR §"Held-note pool" simplification).
    struct ArpPoolEntry
    {
        int pitch        = 0;
        int channel      = 1;
        int sourceCh     = 1;
        int sourcePitch  = 0;
        int sourceVel    = 100;
    };
    std::vector<ArpPoolEntry> arpPool_;
    // Sorted-pitch view of arpPool_ rebuilt whenever the pool mutates.
    // resolveArpStep / strike take a const ref to this vector, so keep
    // it pre-reserved (kArpPoolMax = enough for 4 source notes × 6-voice
    // Dom13 chords with no overlap = 24 voices; bump if user reports
    // truncation under realistic input).
    static constexpr std::size_t kArpPoolMax = 32;
    std::vector<int> arpPoolPitches_;

    // Held-source-key set. Drives latch behaviour ("all keys released" =
    // empty heldKeys_) and lets noteOff remove the right pool entries
    // when latch is off. Tracked independently of the pool because the
    // pool may carry voices whose source noteOff already fired (latch on).
    struct ArpHeldKey { int channel; int pitch; };
    std::vector<ArpHeldKey> arpHeldKeys_;

    pointsman::ArpState arpState_           = pointsman::kInitialArpState;
    int                 arpTickIndex_       = 0;        // mod-16 groove index source
    // Fractional absolute-sample counter so non-integer rateSamples
    // (e.g. 1/16 @ 120 BPM = 5512.5 samples) do not accumulate
    // truncation drift across long sessions. Re-anchored to a whole
    // sample at every transport start (= block-start sample); the
    // double form persists across blocks.
    double              arpNextTickAbsSample_ = -1.0;   // negative = unset
    bool                arpLatchPendingClear_ = false;  // latched pool, next noteOn replaces it
    // Slide carry-state: the voices held under a slide-tied tick whose
    // noteOff is sample-aligned to the next tick's noteOn. Cleared each
    // tick after scheduling the deferred noteOff.
    std::vector<int>    arpSlidePendingPitches_;
    // Mode / chord-shape changes mid-session trigger pool rebuild +
    // panic. Tracked here so the per-block dispatch can detect the edge.
    pointsman::ModeChoice   lastMode_       = pointsman::ModeChoice::Scale;
    pointsman::ChordShape   lastChordShape_ = pointsman::ChordShape::Maj;

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

    // Per-noteOn chord-shape expansion buffer (ADR 004 Phase 2). Reserved
    // once in prepareToPlay; applyChordShapeInto refills it in place so
    // chord-mode expansion stays allocation-free on the audio thread.
    // Worst case is Dom13 = 6 voices; size 8 gives headroom.
    std::vector<int> cachedChordPitches_;

    bool wasPlaying = false;
    uint32_t lastSeed = 0;          // re-seed RNG when seed param changes
    bool rngInitialised = false;
    pointsman::RngState rng{};
    pointsman::DriftState driftState{};

    // Test-time host-playing override. nullopt → use real playhead.
    // Encoded as int8 (-1 unset / 0 stopped / 1 playing) instead of
    // std::optional to keep the header dependency surface small.
    int testIsPlaying = -1;
    // Test-time BPM override (negative → use real playhead / default
    // fallback). The plugin runtime sets this only via setBpmForTest.
    double testBpm_ = -1.0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PointsmanProcessor)
};
