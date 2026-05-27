#include "PluginProcessor.h"
#include "../Editor/PluginEditor.h"

#include <algorithm>

using namespace pointsman;

namespace
{
    // Reading APVTS choice / int params: getRawParameterValue() returns a
    // pointer to the live atomic float in the APVTS, where Choice / Int
    // values are stored as their integer representation. Cast back to int.
    int loadInt(juce::AudioProcessorValueTreeState& s, const char* pid)
    {
        return static_cast<int>(s.getRawParameterValue(pid)->load());
    }

    float loadFloat(juce::AudioProcessorValueTreeState& s, const char* pid)
    {
        return s.getRawParameterValue(pid)->load();
    }

    const juce::Identifier kPointsmanStateTag    { "PointsmanState" };
    const juce::Identifier kHarmonyVoiceTag      { "HarmonyVoice" };
    const juce::Identifier kVersionAttr          { "version" };
    const juce::Identifier kIntervalAttr         { "interval" };
    const juce::Identifier kDirectionAttr        { "direction" };
    const juce::Identifier kParamTag             { "PARAM" };
    const juce::Identifier kIdAttr               { "id" };
    // ADR 004 §"Persistence": 16-step accent / slide patterns stored
    // as a sibling ValueTree child on the APVTS root. Two packed-string
    // properties so the on-disk shape is compact and round-trip-stable.
    const juce::Identifier kArpGrooveTag         { "arpGroovePattern" };
    const juce::Identifier kArpGrooveAccentAttr  { "accent" };
    const juce::Identifier kArpGrooveSlideAttr   { "slide"  };

    juce::String packAccent(const pointsman::ArpAccentTable& a)
    {
        juce::String s;
        s.preallocateBytes(16 * 4);
        for (int i = 0; i < 16; ++i)
        {
            if (i > 0) s << ' ';
            s << a[(std::size_t) i];
        }
        return s;
    }

    void unpackAccent(const juce::String& packed, pointsman::ArpAccentTable& out)
    {
        // Default to flat-100 so a partial or missing payload yields
        // the documented "missing → defaults" behaviour without trapping
        // garbage values into the table.
        for (int i = 0; i < 16; ++i) out[(std::size_t) i] = 100;
        if (packed.isEmpty()) return;
        auto tokens = juce::StringArray::fromTokens(packed, " ", "");
        const int n = juce::jmin(16, tokens.size());
        for (int i = 0; i < n; ++i)
            out[(std::size_t) i] = juce::jlimit(0, 127, tokens[i].getIntValue());
    }

    juce::String packSlide(const pointsman::ArpSlideTable& s)
    {
        // Each cell is a single char '0' / '1'; final string is 16 chars.
        char buf[17] = {};
        for (int i = 0; i < 16; ++i) buf[i] = s[(std::size_t) i] ? '1' : '0';
        return juce::String(buf, 16);
    }

    void unpackSlide(const juce::String& packed, pointsman::ArpSlideTable& out)
    {
        for (int i = 0; i < 16; ++i) out[(std::size_t) i] = false;
        const int n = juce::jmin(16, packed.length());
        for (int i = 0; i < n; ++i)
            out[(std::size_t) i] = packed[i] == '1';
    }
}

PointsmanProcessor::PointsmanProcessor()
    : AudioProcessor(BusesProperties()),
      apvts(*this, nullptr, "Pointsman",
            // Pass a fresh random seed in [0, 0xffffff] so the APVTS default
            // for pid::seed is that random value (concept.md §"Per-event
            // humanize": new instances pick a random seed on construction).
            // The host's first save then captures it; later reopens restore
            // bit-exactly. Drawn before layout construction because the
            // ParameterInt's default is fixed at registration time.
            makeParameterLayout(makeRandomSeedForNewInstance()))
{
    // Ensure the PointsmanState child exists from construction so the host's
    // first save sees a stable tree shape carrying the version marker.
    auto& root = apvts.state;
    auto child = root.getOrCreateChildWithName(kPointsmanStateTag, nullptr);
    child.setProperty(kVersionAttr, kStateVersion, nullptr);

    // ADR 004 default groove pattern: all-100 accent (matches v0.1's
    // typical output velocity) and all-off slide (no ties). Mirror into
    // the ValueTree immediately so the host's first save captures it.
    for (int i = 0; i < 16; ++i)
    {
        arpAccent_[(std::size_t) i] = 100;
        arpSlide_ [(std::size_t) i] = false;
    }
    syncArpGroovePatternToTree();

    // Vestige harmonyVoices pre-population. Phase 4 deletes the HARMONY
    // editor group + this seed; until then we still hand the editor a
    // canonical triad so its widgets render in a familiar state. No
    // audible effect (chord expansion is intervallic via chordShape).
    setHarmonyVoices({
        {3, HarmonyDirection::Above},
        {5, HarmonyDirection::Above},
    });
}

void PointsmanProcessor::prepareToPlay(double sampleRate, int)
{
    // RNG is (re-)seeded lazily inside processBlock when the seed param
    // changes. prepareToPlay resets transport-tracking + scheduler state;
    // drift is reset on transport-start per concept.md §"Per-event humanize".
    sampleRate_ = sampleRate;
    wasPlaying = false;
    blockStartAbs_ = 0;
    lastInputSampleAbs_ = 0;
    haveLastInput_ = false;
    pending_.clear();
    sounding_.clear();
    // Reserve to the hard cap so processBlock's push_back never
    // triggers a heap reallocation on the audio thread. Above the cap
    // the input noteOn is dropped at the push boundary — see the
    // size guard in processBlock.
    pending_.reserve(kMaxPending);
    sounding_.reserve(kMaxSounding);
    // Pre-size the scale-pitch cache so the cache-miss rewrite path in
    // processBlock fills it via buildScalePitchesInto() without ever
    // re-allocating the underlying buffer on the audio thread. 128 is the
    // worst case (ChromaticHalf = identity).
    cachedScalePitches_.reserve(128);
    // Chord-shape expansion buffer (ADR 004). Worst case = Dom13 (6
    // voices); 8 gives headroom for any append-only future preset.
    cachedChordPitches_.reserve(8);
}

void PointsmanProcessor::releaseResources() {}

bool PointsmanProcessor::isHostPlaying() noexcept
{
    if (testIsPlaying >= 0) return testIsPlaying == 1;
    auto* ph = getPlayHead();
    if (ph == nullptr) return false;
    const auto pos = ph->getPosition();
    if (!pos.hasValue()) return false;
    return pos->getIsPlaying();
}

bool PointsmanProcessor::channelMatches(int messageChannel, int paramChannel) const noexcept
{
    if (paramChannel == 0) return true;     // 0 = omni for inputChannel
    return messageChannel == paramChannel;
}

double PointsmanProcessor::getHostBpm() noexcept
{
    // Tests inject a BPM via setBpmForTest because JUCE's TestPlayHead is
    // not wired up; production reads via the real playhead. Fallback of
    // 120 BPM keeps the arp clock alive if the host omits tempo entirely
    // (some sample-player hosts do during preview).
    if (testBpm_ > 0.0) return testBpm_;
    auto* ph = getPlayHead();
    if (ph != nullptr)
    {
        const auto pos = ph->getPosition();
        if (pos.hasValue())
        {
            if (auto bpm = pos->getBpm()) return *bpm;
        }
    }
    return 120.0;
}

void PointsmanProcessor::resetArpRuntimeState() noexcept
{
    arpPool_.clear();
    arpPoolPitches_.clear();
    arpHeldKeys_.clear();
    arpState_ = pointsman::kInitialArpState;
    arpTickIndex_ = 0;
    arpNextTickAbsSample_ = -1.0;
    arpLatchPendingClear_ = false;
    arpSlidePendingPitches_.clear();
}

namespace
{
    // Local helper — rebuild the sorted-pitch view from the pool. Lives
    // here so addArpVoices / removeArpVoicesForSource / rebuildArpPool
    // can share a single implementation; the pool vector is passed by
    // reference rather than via a member function so ArpPoolEntry can
    // stay a private nested type.
    template <class PoolEntry>
    void refreshArpPoolPitchesImpl(const std::vector<PoolEntry>& pool,
                                   std::vector<int>& outPitches)
    {
        outPitches.clear();
        outPitches.reserve(pool.size());
        for (const auto& e : pool) outPitches.push_back(e.pitch);
        std::sort(outPitches.begin(), outPitches.end());
    }
}

void PointsmanProcessor::addArpVoices(int sourceCh, int sourcePitch, int sourceVel,
                                      ChordShape shape,
                                      const std::vector<int>& scalePitches)
{
    if (arpPool_.size() >= kArpPoolMax) return; // RT-safe drop

    // Scale-snap input, then chord-shape expand into a reusable scratch
    // (cachedChordPitches_ doubles as the noteOn-time scratch already).
    const int snapped = snapToScale(sourcePitch, scalePitches);
    applyChordShapeInto(snapped, shape, cachedChordPitches_);

    // Track held-key independently of pool (latch keeps pool past
    // noteOff; held-key drives the "all keys released" detector).
    arpHeldKeys_.push_back({ sourceCh, sourcePitch });

    for (const int pitch : cachedChordPitches_)
    {
        if (arpPool_.size() >= kArpPoolMax) break;
        // Dedup by (pitch, channel): if an entry already covers this
        // (pitch, sourceCh), skip — the existing source tag wins, matching
        // m4l/inboil semantics ("overlapping voices from multiple held
        // notes collapse"; first contributor's release removes the entry).
        bool dup = false;
        for (const auto& e : arpPool_)
        {
            if (e.pitch == pitch && e.channel == sourceCh) { dup = true; break; }
        }
        if (dup) continue;
        ArpPoolEntry entry{};
        entry.pitch       = pitch;
        entry.channel     = sourceCh;
        entry.sourceCh    = sourceCh;
        entry.sourcePitch = sourcePitch;
        entry.sourceVel   = sourceVel;
        arpPool_.push_back(entry);
    }
    refreshArpPoolPitchesImpl(arpPool_, arpPoolPitches_);
}

void PointsmanProcessor::removeArpVoicesForSource(int sourceCh, int sourcePitch)
{
    // Drop the held-key entry first (latch reads this on next noteOn to
    // decide whether to replace or extend the pool).
    auto hit = std::find_if(arpHeldKeys_.begin(), arpHeldKeys_.end(),
        [&](const ArpHeldKey& k){ return k.channel == sourceCh && k.pitch == sourcePitch; });
    if (hit != arpHeldKeys_.end()) arpHeldKeys_.erase(hit);

    // arpLatch is read at the per-tick callsite, NOT here — latch logic
    // delays pool removal to next noteOn (the pool stays). For non-latch
    // the noteOff drops the matching pool entries immediately.
    const bool latchOn = static_cast<bool>(loadInt(apvts, pid::arpLatch));
    if (latchOn)
    {
        if (arpHeldKeys_.empty()) arpLatchPendingClear_ = true;
        return;
    }
    arpPool_.erase(std::remove_if(arpPool_.begin(), arpPool_.end(),
        [&](const ArpPoolEntry& e)
        {
            return e.sourceCh == sourceCh && e.sourcePitch == sourcePitch;
        }), arpPool_.end());
    refreshArpPoolPitchesImpl(arpPool_, arpPoolPitches_);
}

void PointsmanProcessor::rebuildArpPool(ChordShape shape,
                                        const std::vector<int>& scalePitches)
{
    // chordShape change mid-hold: replay every still-held key through the
    // new shape. Pool index is preserved so the cursor doesn't snap back
    // to 0 — only the contents change (ADR §"Held-note pool" rule 5).
    arpPool_.clear();
    arpPoolPitches_.clear();
    // Snapshot held keys; addArpVoices mutates arpHeldKeys_ via push_back.
    const auto held = arpHeldKeys_;
    arpHeldKeys_.clear();
    for (const auto& k : held)
        addArpVoices(k.channel, k.pitch, 100, shape, scalePitches);
}

namespace
{
    inline double drawUnit(pointsman::RngState& rng) noexcept
    {
        // u32 → [0, 1) via the 2^32 divisor, matching the m4l shared
        // RNG convention; nextU32 always advances the stream so the
        // arp tick's draw order stays reproducible across param edits.
        return static_cast<double>(pointsman::nextU32(rng))
             / 4294967296.0; // 2^32
    }
}

void PointsmanProcessor::runArpClock(int numSamples,
                                     ArpPattern pattern,
                                     ArpRate rate,
                                     int octaves, int stepRepeats,
                                     float gateBase, float variation, float swing,
                                     float feel, float driftFactor,
                                     double bpm,
                                     int outputChannel)
{
    if (numSamples <= 0)         return;
    if (bpm <= 0.0)              return; // defensive: no tempo, no ticks
    if (arpPool_.empty())        return;

    const auto rateFrac = parseArpRate(rate);
    // step duration (samples). 60 / bpm = sec/quarter; rateFrac is in
    // quarter-notes per step.
    const double secondsPerQuarter = 60.0 / bpm;
    const double rateSamplesDbl   =
        secondsPerQuarter * sampleRate_ * static_cast<double>(rateFrac.num)
                                       / static_cast<double>(rateFrac.den);
    if (rateSamplesDbl < 1.0) return; // pathological tempo / rate combo
    // The groove layer's swing offset is a fraction of half-a-16th
    // (per applyArpGroove). 1/16 PPQ = 0.25 quarter, so:
    const double sixteenthSamples = secondsPerQuarter * sampleRate_ * 0.25;

    const double blockStartAbsDbl = static_cast<double>(blockStartAbs_);
    const double blockEndDbl      = blockStartAbsDbl + numSamples;

    // First-block-of-play primer: when transport just started, anchor
    // the first tick at blockStartAbs_ (immediate). Subsequent blocks
    // keep advancing whatever fractional counter we left behind.
    // The negative sentinel (set in resetArpRuntimeState / transport
    // edges) distinguishes "fresh start" from "valid future tick".
    if (arpNextTickAbsSample_ < 0.0 || arpNextTickAbsSample_ < blockStartAbsDbl)
        arpNextTickAbsSample_ = blockStartAbsDbl;

    while (arpNextTickAbsSample_ < blockEndDbl)
    {
        const uint64_t tickAbs =
            static_cast<uint64_t>(arpNextTickAbsSample_);
        const int      tickIdx = arpTickIndex_;

        // Pull the RNG draws for THIS tick in fixed order before any
        // branch-on-pattern logic — keeps the stream reproducible
        // regardless of pattern / variation values (m4l parity).
        const double rngPatternDraw  =
            (pattern == ArpPattern::Random) ? drawUnit(rng) : 0.0;
        const double rngVarDraw1     = drawUnit(rng);
        const double rngVarDraw2     = drawUnit(rng);

        // Resolve the current step (uses pool + state) BEFORE advancing.
        ArpEmission emission = resolveArpStep(
            arpPoolPitches_, arpState_.index, arpState_.round, pattern);

        // Advance the cursor for the next tick.
        arpState_ = nextArpIndex(
            pattern, arpState_, static_cast<int>(arpPoolPitches_.size()),
            octaves, stepRepeats, rngPatternDraw);

        // Variation cascade.
        ArpVariationResult vResult =
            applyArpVariation(emission, variation, rngVarDraw1, rngVarDraw2);

        // Groove cascade (deterministic; rests short-circuit).
        ArpGrooveResult gResult = applyArpGroove(
            vResult, tickIdx, arpAccent_, arpSlide_, swing, sixteenthSamples);

        // Schedule the deferred noteOff for a previous slide-tied tick at
        // exactly this tick's noteOn sample (immediately before — same
        // sample is fine because drainPendingInto sorts noteOn-before-
        // noteOff on equal sample). If this tick is a rest, the slide
        // still releases at the next-tick boundary (per ADR §"Composition
        // guarantees" rest precedence).
        const uint64_t noteOffOnSlideBoundary = tickAbs;
        if (!arpSlidePendingPitches_.empty()
            && pending_.size() + arpSlidePendingPitches_.size() <= kMaxPending)
        {
            for (const int p : arpSlidePendingPitches_)
                pending_.push_back({ noteOffOnSlideBoundary, outputChannel,
                                     p, 0, false });
            arpSlidePendingPitches_.clear();
        }

        if (vResult.effect == ArpVariationEffect::Rest || !gResult.applied)
        {
            // Rest emission still consumes the humanize RNG draws below
            // so the stream stays in lockstep — without this the
            // velocity/timing state would skew based on rest density.
            ComposeArgs ha{};
            ha.velocity = feel;
            ha.gate     = feel;
            ha.timing   = feel;
            ha.driftFactor    = driftFactor;
            ha.inputVelocity  = 100; // unused for rest, kept consistent
            ha.outputLevel    = 1.0;
            ha.outputGateBase = static_cast<double>(gateBase);
            ha.sourceStepDuration = rateSamplesDbl / sampleRate_ * 1000.0;
            (void) composeHumanize(rng, driftState, ha);
            arpNextTickAbsSample_ += rateSamplesDbl;
            ++arpTickIndex_;
            continue;
        }

        // Humanize per-tick: groove velocity becomes the inputVelocity
        // baseline (so accent values get jittered around, not the
        // pool's source velocity).
        ComposeArgs ha{};
        ha.velocity = feel;
        ha.gate     = feel;
        ha.timing   = feel;
        ha.driftFactor    = driftFactor;
        ha.inputVelocity  = gResult.velocity;
        ha.outputLevel    = 1.0;
        ha.outputGateBase = static_cast<double>(gateBase);
        ha.sourceStepDuration = rateSamplesDbl / sampleRate_ * 1000.0;
        const auto hr = composeHumanize(rng, driftState, ha);

        // Sample placement. Negative timing offsets clamp to 0
        // (parity with chord-mode scheduling — never pull a noteOn
        // earlier than its tick origin).
        const double timingOffsetSamples =
            hr.timingOffset * sampleRate_ / 1000.0;
        const double swingOffsetSamples = gResult.swingOffsetSamples;
        const uint64_t noteOnAbs = tickAbs
            + static_cast<uint64_t>(std::max(0.0, swingOffsetSamples
                                                + std::max(0.0, timingOffsetSamples)));

        // Slide-aware noteOff offset. scheduleArpNoteOff returns either
        // the gate sample length or the per-tick boundary distance when
        // tied. The "next tick" reference here ignores swing delta — the
        // overlap stays sample-aligned for the receiving synth's glide
        // detection.
        const double gateLenSamples =
            std::max(0.0, hr.gateFinal * rateSamplesDbl);
        const double noteOffOffset = scheduleArpNoteOff(
            gResult.tieToNext, gateLenSamples, rateSamplesDbl);
        const uint64_t noteOffAbs =
            noteOnAbs + static_cast<uint64_t>(noteOffOffset);

        const std::size_t voiceCount = vResult.pitches.size();
        const bool flam = vResult.effect == ArpVariationEffect::Flam;
        const std::size_t pairsNeeded = voiceCount * (flam ? 4u : 2u);
        if (pending_.size() + pairsNeeded > kMaxPending)
        {
            arpNextTickAbsSample_ += rateSamplesDbl;
            ++arpTickIndex_;
            continue;
        }

        for (const int p : vResult.pitches)
        {
            pending_.push_back({ noteOnAbs, outputChannel, p,
                                 hr.velocityFinal, true });
            if (gResult.tieToNext)
            {
                // Defer the noteOff to the next tick. The non-slide path
                // schedules a normal noteOff at noteOffAbs; the slide
                // path adds the pitch to arpSlidePendingPitches_ so the
                // next iteration emits the deferred noteOff aligned to
                // the next tick's noteOn sample.
                arpSlidePendingPitches_.push_back(p);
            }
            else
            {
                pending_.push_back({ noteOffAbs, outputChannel, p,
                                     0, false });
            }
        }

        if (flam)
        {
            const uint64_t flamNoteOnAbs = noteOnAbs
                + static_cast<uint64_t>(vResult.secondOffsetFraction
                                        * rateSamplesDbl);
            const uint64_t flamNoteOffAbs = flamNoteOnAbs
                + static_cast<uint64_t>(gateLenSamples);
            for (const int p : vResult.pitches)
            {
                pending_.push_back({ flamNoteOnAbs, outputChannel, p,
                                     hr.velocityFinal, true });
                pending_.push_back({ flamNoteOffAbs, outputChannel, p,
                                     0, false });
            }
        }

        arpNextTickAbsSample_ += rateSamplesDbl;
        ++arpTickIndex_;
    }
}

void PointsmanProcessor::writeNoteOnTracked(juce::MidiBuffer& out,
                                            int sample,
                                            int channel,
                                            int pitch,
                                            int velocity)
{
    const auto vel = static_cast<juce::uint8>(juce::jlimit(1, 127, velocity));
    out.addEvent(juce::MidiMessage::noteOn(channel, pitch, vel), sample);

    // Publish into the pulse ring. Audio thread is the sole writer, so a
    // relaxed load + store of the head is safe; the slot store + head
    // store both use release so the UI's acquire on the head establishes
    // visibility of the slot contents. Chord mode emits N voices in the
    // same processBlock — the ring keeps every one (single-slot atomic
    // would collapse them to just the last).
    const uint32_t v = pulseRingHead_.load(std::memory_order_relaxed) + 1;
    pulseRing_[(v - 1) & kPulseRingMask]
        .store(packPulse(v, pitch, vel, channel), std::memory_order_release);
    pulseRingHead_.store(v, std::memory_order_release);
}

void PointsmanProcessor::writeNoteOffTracked(juce::MidiBuffer& out,
                                             int sample,
                                             int channel,
                                             int pitch)
{
    out.addEvent(juce::MidiMessage::noteOff(channel, pitch), sample);
}

void PointsmanProcessor::emitPanicTo(juce::MidiBuffer& out, int sampleOffset)
{
    // Flush every emitted-but-not-yet-released note (sounding_), drop any
    // queued-but-not-yet-fired events (pending_), and clear chord context.
    // Drift survives per concept.md §"Transport stop does not touch drift
    // state". Note-on events still in pending_ never reach the output, so
    // dropping them paired with their queued noteOff is correct: the host
    // never heard either edge.
    for (const auto& s : sounding_)
        writeNoteOffTracked(out, sampleOffset, s.channel, s.pitch);
    sounding_.clear();
    pending_.clear();
}

void PointsmanProcessor::drainPendingInto(juce::MidiBuffer& out, int numSamples)
{
    if (pending_.empty()) return;

    const uint64_t blockEnd = blockStartAbs_ + static_cast<uint64_t>(numSamples);

    // Sort by target sample ascending; tie-break noteOn before noteOff so a
    // gateLen=0 event still emits a well-formed pair within the same sample.
    std::sort(pending_.begin(), pending_.end(),
        [](const PendingMidi& a, const PendingMidi& b)
        {
            if (a.targetSampleAbs != b.targetSampleAbs)
                return a.targetSampleAbs < b.targetSampleAbs;
            if (a.isNoteOn != b.isNoteOn) return a.isNoteOn;
            return false;
        });

    auto firstKeep = std::partition_point(
        pending_.begin(), pending_.end(),
        [&](const PendingMidi& m){ return m.targetSampleAbs < blockEnd; });

    for (auto it = pending_.begin(); it != firstKeep; ++it)
    {
        // Negative relative samples (target < blockStartAbs_, i.e. overdue
        // from a prior block where we didn't fire — should not happen with
        // monotonic block advance, but defend against it anyway) clamp to
        // sample 0 of this block.
        int rel = (it->targetSampleAbs >= blockStartAbs_)
                    ? static_cast<int>(it->targetSampleAbs - blockStartAbs_)
                    : 0;
        if (rel >= numSamples) rel = numSamples - 1;
        if (rel < 0)           rel = 0;

        if (it->isNoteOn)
        {
            writeNoteOnTracked(out, rel, it->channel, it->pitch, it->velocity);
            sounding_.push_back({it->channel, it->pitch});
        }
        else
        {
            writeNoteOffTracked(out, rel, it->channel, it->pitch);
            // Erase first matching sounding entry (harmony at scale extremes
            // can produce duplicate (ch, pitch) tuples; both must be tracked).
            auto match = std::find_if(sounding_.begin(), sounding_.end(),
                [&](const ActiveNote& s)
                { return s.channel == it->channel && s.pitch == it->pitch; });
            if (match != sounding_.end()) sounding_.erase(match);
        }
    }
    pending_.erase(pending_.begin(), firstKeep);
}

void PointsmanProcessor::processBlock(juce::AudioBuffer<float>& audio, juce::MidiBuffer& midi)
{
    // Reuse the member buffer across blocks: clear() retains capacity so
    // steady-state runs do not re-allocate the internal byte array.
    out_.clear();
    auto& out = out_;
    const int numSamples = audio.getNumSamples();

    const int seedVal = loadInt(apvts, pid::seed);

    // ---- Transport edges ----
    const bool playing = isHostPlaying();
    if (wasPlaying && !playing)
    {
        emitPanicTo(out, 0);
        // Drift state does NOT reset on stop (concept.md §"Per-event
        // humanize"). lastInput is reset so the next event after stop
        // falls back to kFirstEventStepMs (parity with m4l host.ts:245).
        haveLastInput_ = false;
        // ADR 004 §"Arp clock" transport semantics: stop resets the arp
        // cursor + tick counter so the next play begins on tickIndex 0.
        // Pool and held-keys persist across stop — restarting with the
        // same keys held should resume on the same voices.
        arpState_ = pointsman::kInitialArpState;
        arpTickIndex_ = 0;
        arpNextTickAbsSample_ = -1.0;
        arpSlidePendingPitches_.clear();
    }
    if (!wasPlaying && playing)
    {
        // Each play loop re-seeds from the canonical initial state so a
        // fixed (seed, input sequence, params) reproduces output bit-for-
        // bit (concept.md §"Transport"). Mirrors m4l host.ts:237.
        driftState = DriftState{};
        rng = seedRng(static_cast<uint32_t>(seedVal));
        lastSeed = static_cast<uint32_t>(seedVal);
        rngInitialised = true;
        haveLastInput_ = false;
        // Re-anchor the arp clock so the first tick fires at the start
        // of this play loop (sample 0 of the current block). Index stays
        // at 0; runArpClock will increment as ticks fire.
        arpState_ = pointsman::kInitialArpState;
        arpTickIndex_ = 0;
        arpNextTickAbsSample_ = -1.0;
        arpSlidePendingPitches_.clear();
    }
    wasPlaying = playing;

    // ---- Read remaining params ----
    const int    rootPc     = loadInt(apvts, pid::root);
    const auto   scale      = static_cast<ScaleName>(loadInt(apvts, pid::scale));
    const auto   modeChoice = static_cast<ModeChoice>(loadInt(apvts, pid::mode));
    const int    inputCh    = loadInt(apvts, pid::inputChannel);
    const float  feel       = loadFloat(apvts, pid::feel);
    const float  dFactor    = loadFloat(apvts, pid::drift);

    // Re-seed if seed param changed mid-session (host automation / UI).
    if (!rngInitialised || static_cast<uint32_t>(seedVal) != lastSeed)
    {
        rng = seedRng(static_cast<uint32_t>(seedVal));
        lastSeed = static_cast<uint32_t>(seedVal);
        rngInitialised = true;
    }

    // Rebuild the per-scale MIDI pitch span only when (scale, root)
    // changes. Pure function of those two inputs, so the cache is always
    // valid otherwise.
    const int scaleIdx = static_cast<int>(scale);
    if (scaleIdx != cachedScaleIdx_ || rootPc != cachedRootPc_)
    {
        // In-place rewrite — cachedScalePitches_ has reserve(128) from
        // prepareToPlay, so this stays alloc-free on the audio thread.
        buildScalePitchesInto(scale, rootPc, cachedScalePitches_);
        cachedScaleIdx_ = scaleIdx;
        cachedRootPc_   = rootPc;
    }
    const auto& scalePitches = cachedScalePitches_;

    // ADR 004 Phase 2: chordShape is read per-block (Choice param) and
    // applied per noteOn via applyChordShapeInto into the reserved
    // cachedChordPitches_ buffer. The 16-step accent / slide tables
    // and the arp pool / clock consume chordShape in mode=Arp via
    // addArpVoices / runArpClock.
    const auto chordShape = static_cast<ChordShape>(loadInt(apvts, pid::chordShape));

    // ---- Mode / chord-shape edge detection (ADR 004 Phase 2-B) ----
    // Mode change: panic + drop the arp runtime (pool + cursor) so a
    // mid-session toggle never bleeds pool emissions into chord mode or
    // vice versa.
    // chordShape change while in arp: rebuild the pool from currently-
    // held source keys + flush sounding notes; cursor resets to 0 so
    // the new shape's voices traverse from index 0.
    if (lastMode_ != modeChoice)
    {
        emitPanicTo(out, 0);
        resetArpRuntimeState();
        haveLastInput_ = false;
        lastMode_ = modeChoice;
    }
    else if (modeChoice == ModeChoice::Arp && lastChordShape_ != chordShape)
    {
        emitPanicTo(out, 0);
        rebuildArpPool(chordShape, scalePitches);
        arpState_ = pointsman::kInitialArpState;
        arpSlidePendingPitches_.clear();
    }
    lastChordShape_ = chordShape;

    // ---- Iterate input MIDI ----
    for (const auto meta : midi)
    {
        const auto msg = meta.getMessage();
        const int sample = meta.samplePosition;
        const int ch = msg.getChannel();
        const bool channelMatched = channelMatches(ch, inputCh);

        if (msg.isNoteOn())
        {
            const int pitch = msg.getNoteNumber();
            const int velIn = msg.getVelocity();

            if (!channelMatched)
            {
                // Other-channel input passes through untouched
                // (concept.md §"Input handling"). Preserving non-matching
                // channels is required for MPE: with IN CH = master
                // (e.g. 1), per-note channels (2..15) must still flow to
                // the downstream MPE instrument carrying pitch bend /
                // pressure / timbre, even though they are not chord-
                // expanded here. ADR 004 also routes MPE per-note channel
                // input around arp processing entirely.
                out.addEvent(msg, sample);
                continue;
            }

            // ── ADR 004 arp mode: pool maintenance, no immediate emit ──
            if (modeChoice == ModeChoice::Arp)
            {
                // Latch-pending clear fires on the first noteOn after the
                // user released all keys: the pool is wiped and the new
                // noteOn becomes the sole pool root, matching the
                // canonical hardware-arp latch behaviour.
                if (arpLatchPendingClear_)
                {
                    arpPool_.clear();
                    arpPoolPitches_.clear();
                    arpLatchPendingClear_ = false;
                    arpState_ = pointsman::kInitialArpState;
                }
                addArpVoices(ch, pitch, velIn, chordShape, scalePitches);
                continue;
            }

            // ── Humanize-driven scheduling ─────────────────────────
            const uint64_t absInputSample = blockStartAbs_ + static_cast<uint64_t>(sample);
            // Distinguish "chord-voice attack" from "fast TM step". Below
            // the simultaneous-ish threshold (~50 ms, slightly above
            // human perceptual simultaneity at 20-30 ms), treat the
            // attack as a fresh musical event and use the first-event
            // fallback so all voices ring audibly at the default gate.
            // Above the threshold, the inter-attack delta IS the step
            // (TM-style sequence at 50+ ms / 16th @ 300 BPM and slower).
            //
            // Without this clamp, a live chord played on a keyboard
            // produces inaudible 2nd-and-later voices: even when noteOns
            // arrive in sequential processBlock calls (a few ms apart),
            // delta is far below kFirstEventStepMs and gateFinal ×
            // sourceStepSamples collapses to a click. Phase 5 manual-
            // gate report ("chord 単音しか鳴らない").
            constexpr double kSimultaneousThresholdMs = 50.0;
            const double firstEventSamples = kFirstEventStepMs * sampleRate_ / 1000.0;
            double rawSourceStepSamples;
            if (!haveLastInput_)
            {
                rawSourceStepSamples = firstEventSamples;
            }
            else
            {
                const double delta = static_cast<double>(absInputSample - lastInputSampleAbs_);
                const double thresholdSamples = kSimultaneousThresholdMs * sampleRate_ / 1000.0;
                rawSourceStepSamples = (delta < thresholdSamples) ? firstEventSamples : delta;
            }
            // Cap at kMaxSourceStepMs: a multi-second input gap would
            // otherwise schedule a default-gate noteOff that far out
            // and risk uint64 cast pathology. Clamp at the bridge
            // boundary so every downstream calculation (gate length,
            // timing offset, drift smoothing) sees the same bound.
            const double maxSourceStepSamples = kMaxSourceStepMs * sampleRate_ / 1000.0;
            const double sourceStepSamples =
                std::min(rawSourceStepSamples, maxSourceStepSamples);
            lastInputSampleAbs_ = absInputSample;
            haveLastInput_ = true;

            // Phase 5 routing: a single `feel` amount drives velocity /
            // gate / timing amplitudes (each axis still draws
            // independently inside composeHumanize). `drift` is the EMA
            // factor shared across the three axes per concept.md
            // §"Per-event humanize".
            ComposeArgs ha{};
            ha.velocity           = feel;
            ha.gate               = feel;
            ha.timing             = feel;
            ha.driftFactor        = dFactor;
            ha.inputVelocity      = velIn;
            ha.outputLevel        = 1.0;  // outputLevel removed in v2
            ha.outputGateBase     = 1.0;
            ha.sourceStepDuration = sourceStepSamples / sampleRate_ * 1000.0; // ms
            const auto hr = composeHumanize(rng, driftState, ha);

            // ms → samples. Negative timing offset clamps to immediate
            // (parity with m4l/host/bridge.ts:313 `delay > 0 ? delay : 0`).
            const double timingOffsetSamples = hr.timingOffset * sampleRate_ / 1000.0;
            const uint64_t noteOnTargetAbs = (timingOffsetSamples > 0.0)
                ? absInputSample + static_cast<uint64_t>(timingOffsetSamples)
                : absInputSample;
            const double gateLenSamples =
                std::max(0.0, hr.gateFinal * sourceStepSamples);
            const uint64_t noteOffTargetAbs =
                noteOnTargetAbs + static_cast<uint64_t>(gateLenSamples);

            // Quantize input to nearest scale degree; chord/arp modes
            // expand the snapped pitch via chordShape (intervallic).
            // Out-of-scale input snaps first, so e.g. C# in C major → C
            // → chord rooted on C using the active chordShape.
            const int quantized = snapToScale(pitch, scalePitches);

            // Build output pitches:
            //   scale mode: [quantized]                       → 1 note
            //   chord mode: applyChordShape(quantized, shape) → 1..6 notes
            // Arp mode is handled earlier (continue above) — its noteOn
            // feeds the pool and the post-loop runArpClock emits ticks
            // over time, not synchronously here.
            const int*  outPitches  = nullptr;
            int         numOut      = 0;
            int         singleVoice = 0;
            if (modeChoice == ModeChoice::Scale)
            {
                singleVoice = quantized;
                outPitches  = &singleVoice;
                numOut      = 1;
            }
            else // ModeChoice::Chord
            {
                applyChordShapeInto(quantized, chordShape, cachedChordPitches_);
                outPitches = cachedChordPitches_.data();
                numOut     = static_cast<int>(cachedChordPitches_.size());
                if (numOut == 0) continue; // every voice exceeded [0, 127]
            }

            // Push the noteOn/noteOff pair per voice. The atomic-by-
            // input-event check guarantees we either schedule all voices
            // or none — half-emitted chords (some voices stuck without
            // releases) would manifest as hung notes. Drop the entire
            // input event rather than a partial expansion when at cap.
            if (pending_.size() + static_cast<std::size_t>(numOut) * 2 > kMaxPending)
            {
                // RT-safe overflow handling: silently drop this noteOn
                // expansion. Triggered only by pathological input rates
                // (sustained ~100Hz with max gates) — the missed note is
                // preferable to a heap allocation glitch on the audio
                // thread.
                continue;
            }
            for (int i = 0; i < numOut; ++i)
            {
                pending_.push_back({noteOnTargetAbs,  ch, outPitches[i],
                                    hr.velocityFinal, true});
                pending_.push_back({noteOffTargetAbs, ch, outPitches[i],
                                    0,                false});
            }
        }
        else if (msg.isNoteOff())
        {
            // ADR 004 arp mode: channel-matched noteOff removes the
            // matching source's voices from the pool (or latches them
            // for "next noteOn after release" behaviour when arpLatch
            // is on, per addArpVoices / removeArpVoicesForSource).
            if (modeChoice == ModeChoice::Arp && channelMatched)
            {
                removeArpVoicesForSource(ch, msg.getNoteNumber());
                continue;
            }
            // Scale / chord modes: channel-matched input noteOffs are
            // silently consumed (output gating is humanize-driven, not
            // input-paired — ADR 003 Phase 4 / m4l host.ts:222-230
            // semantics). Off-channel noteOffs pass through so any
            // off-channel noteOn we passed through above gets its pair.
            if (!channelMatched)
                out.addEvent(msg, sample);
        }
        else
        {
            // Non-note traffic: CC, PB, channel pressure, etc. — pass through.
            out.addEvent(msg, sample);
        }
    }

    // ---- ADR 004 arp clock ----
    // After the MIDI loop has updated the pool from this block's input,
    // schedule arp ticks for the same block. Ticks emit through the
    // shared pending_ queue, which is then drained alongside chord-mode
    // events below.
    if (modeChoice == ModeChoice::Arp && playing)
    {
        const auto  pattern     = static_cast<ArpPattern>(loadInt(apvts, pid::arpPattern));
        const auto  rate        = static_cast<ArpRate>(loadInt(apvts, pid::arpRate));
        const int   octaves     = loadInt(apvts, pid::arpOctaves);
        const int   stepRepeats = loadInt(apvts, pid::arpStepRepeats);
        const float gateBase    = loadFloat(apvts, pid::arpGate);
        const float variation   = loadFloat(apvts, pid::arpVariation);
        const float swing       = loadFloat(apvts, pid::arpSwing);
        const double bpm        = getHostBpm();
        // Output channel: use the inputChannel param when non-omni so
        // the arp emissions land on the same MIDI channel the user is
        // routing into the plugin; for omni inputs, default to channel
        // 1 (cross-target convention).
        const int outCh = inputCh > 0 ? inputCh : 1;
        runArpClock(numSamples, pattern, rate, octaves, stepRepeats,
                    gateBase, variation, swing, feel, dFactor, bpm, outCh);
    }

    // ---- Drain pending events for this block ----
    drainPendingInto(out, numSamples);

    // ---- Advance block counter ----
    blockStartAbs_ += static_cast<uint64_t>(numSamples);

    midi.swapWith(out);
}

juce::AudioProcessorEditor* PointsmanProcessor::createEditor()
{
    return new PointsmanEditor(*this);
}

void PointsmanProcessor::setHarmonyVoices(std::vector<HarmonyVoice> v)
{
    // ADR 004 Phase 2 vestige path. The editor's HARMONY group still
    // reads/writes the vector and re-renders its badges via a ValueTree
    // listener — the tree mirror below keeps that wiring functional.
    // processBlock does NOT consult the vector (chord expansion is
    // intervallic via chordShape). Phase 4 deletes the editor group,
    // this method, and the sync helpers in one cut.
    if (v.size() > kHarmonyVoicesMax) v.resize(kHarmonyVoicesMax);
    {
        const juce::SpinLock::ScopedLockType lock(harmonyVoicesLock_);
        harmonyVoices = std::move(v);
    }
    syncHarmonyVoicesToTree();
}

void PointsmanProcessor::syncHarmonyVoicesToTree()
{
    auto& root = apvts.state;
    auto child = root.getOrCreateChildWithName(kPointsmanStateTag, nullptr);
    child.setProperty(kVersionAttr, kStateVersion, nullptr);
    child.removeAllChildren(nullptr);
    const juce::SpinLock::ScopedLockType lock(harmonyVoicesLock_);
    for (const auto& v : harmonyVoices)
    {
        juce::ValueTree node(kHarmonyVoiceTag);
        node.setProperty(kIntervalAttr, v.interval, nullptr);
        node.setProperty(kDirectionAttr,
                         v.direction == HarmonyDirection::Above
                             ? juce::String("above")
                             : juce::String("below"),
                         nullptr);
        child.appendChild(node, nullptr);
    }
}

void PointsmanProcessor::syncHarmonyVoicesFromTree()
{
    const juce::SpinLock::ScopedLockType lock(harmonyVoicesLock_);
    harmonyVoices.clear();
    auto child = apvts.state.getChildWithName(kPointsmanStateTag);
    if (!child.isValid()) return;
    for (int i = 0; i < child.getNumChildren(); ++i)
    {
        if (harmonyVoices.size() >= kHarmonyVoicesMax) break;
        auto node = child.getChild(i);
        if (!node.hasType(kHarmonyVoiceTag)) continue;
        HarmonyVoice v{};
        const int rawInterval =
            static_cast<int>(node.getProperty(kIntervalAttr, 3));
        v.interval = juce::jlimit(3, 6, rawInterval);
        const auto dir = node.getProperty(kDirectionAttr, "above").toString();
        v.direction = (dir == "below") ? HarmonyDirection::Below
                                       : HarmonyDirection::Above;
        harmonyVoices.push_back(v);
    }
}

void PointsmanProcessor::setArpAccent(const pointsman::ArpAccentTable& accent)
{
    for (int i = 0; i < 16; ++i)
        arpAccent_[(std::size_t) i] = juce::jlimit(0, 127, accent[(std::size_t) i]);
    syncArpGroovePatternToTree();
}

void PointsmanProcessor::setArpSlide(const pointsman::ArpSlideTable& slide)
{
    arpSlide_ = slide;
    syncArpGroovePatternToTree();
}

void PointsmanProcessor::syncArpGroovePatternToTree()
{
    auto& root = apvts.state;
    auto child = root.getOrCreateChildWithName(kArpGrooveTag, nullptr);
    child.setProperty(kArpGrooveAccentAttr, packAccent(arpAccent_), nullptr);
    child.setProperty(kArpGrooveSlideAttr,  packSlide (arpSlide_),  nullptr);
}

void PointsmanProcessor::syncArpGroovePatternFromTree()
{
    auto child = apvts.state.getChildWithName(kArpGrooveTag);
    if (!child.isValid())
    {
        // Missing payload → ADR 004 §"Persistence" documents this as
        // "loads the default all-100 accent / all-off slide pattern".
        for (int i = 0; i < 16; ++i)
        {
            arpAccent_[(std::size_t) i] = 100;
            arpSlide_ [(std::size_t) i] = false;
        }
        return;
    }
    unpackAccent(child.getProperty(kArpGrooveAccentAttr).toString(), arpAccent_);
    unpackSlide (child.getProperty(kArpGrooveSlideAttr ).toString(), arpSlide_);
}

void PointsmanProcessor::getStateInformation(juce::MemoryBlock& destData)
{
    syncArpGroovePatternToTree();
    auto state = apvts.copyState();
    if (auto xml = state.createXml())
        copyXmlToBinary(*xml, destData);
}

void PointsmanProcessor::setStateInformation(const void* data, int sizeInBytes)
{
    auto xml = getXmlFromBinary(data, sizeInBytes);
    if (xml == nullptr) return;
    if (!xml->hasTagName(apvts.state.getType())) return;

    auto loaded = juce::ValueTree::fromXml(*xml);

    // ADR 003 Phase 5 + ADR 004 Phase 2: detect a legacy (v1 or v2) state
    // tree and discard. Markers, either of which independently suffices:
    //   (a) any PARAM child whose id is in pid::kRemovedLegacyPids
    //       (catches v1: humanizeVelocity / outputLevel / controlChannel
    //        etc. were PARAM pids in v1 and disappeared in v2)
    //   (b) PointsmanState.version is set and != kStateVersion
    //       (catches v2 — its constructor wrote version=2 — and also
    //        future-proofs against forward-incompatible loads).
    // v3 trees may still carry HarmonyVoice child nodes alongside
    // version=3 (the vestige editor mirror; see syncHarmonyVoicesToTree),
    // so the HarmonyVoice presence alone is not a legacy marker.
    const auto looksLegacy = [&]
    {
        for (int i = 0; i < loaded.getNumChildren(); ++i)
        {
            auto child = loaded.getChild(i);
            if (child.hasType(kParamTag))
            {
                const auto id = child.getProperty(kIdAttr).toString();
                for (const char* removed : pid::kRemovedLegacyPids)
                    if (id == juce::String(removed)) return true;
            }
        }
        auto ps = loaded.getChildWithName(kPointsmanStateTag);
        if (ps.isValid())
        {
            const auto v = ps.getProperty(kVersionAttr, 0);
            if (static_cast<int>(v) != 0
                && static_cast<int>(v) != kStateVersion)
                return true;
        }
        return false;
    }();

    if (looksLegacy)
    {
        juce::Logger::writeToLog("Pointsman: discarding pre-v3 state");
        return; // keep the default-constructed v3 state intact
    }

    apvts.replaceState(loaded);
    syncHarmonyVoicesFromTree();
    syncArpGroovePatternFromTree();
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new PointsmanProcessor();
}
