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
    // cachedChordPitches_ buffer. No audio-thread snapshot dance is
    // needed for the chord primitive (it is a single Choice, atomic on
    // load). The 16-step accent / slide tables and the arp pool /
    // clock arrive in sub-step B.
    const auto chordShape = static_cast<ChordShape>(loadInt(apvts, pid::chordShape));

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
                // expanded here.
                out.addEvent(msg, sample);
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
            //   arp mode (sub-step A placeholder): same as chord mode.
            //   Sub-step B replaces this branch with pool maintenance +
            //   tick-deferred emission; selecting Arp during the interim
            //   still produces audible chord-shape voices so users can
            //   verify the chordShape primitive end-to-end.
            const int*  outPitches = nullptr;
            int         numOut     = 0;
            int         singleVoice = 0;
            if (modeChoice == ModeChoice::Scale)
            {
                singleVoice = quantized;
                outPitches  = &singleVoice;
                numOut      = 1;
            }
            else
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
            // Channel-matched input noteOffs are silently consumed:
            // output gating is humanize-driven (gateFinal ×
            // sourceStepDuration), not input-paired (ADR 003 Phase 4 /
            // m4l host.ts:222-230 semantics). Off-channel noteOffs pass
            // through unchanged so any matching off-channel noteOn we
            // passed through above gets its pair on the output.
            if (!channelMatched)
                out.addEvent(msg, sample);
        }
        else
        {
            // Non-note traffic: CC, PB, channel pressure, etc. — pass through.
            out.addEvent(msg, sample);
        }
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
