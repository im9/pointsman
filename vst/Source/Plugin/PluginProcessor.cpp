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

    const juce::Identifier kPointsmanStateTag { "PointsmanState" };
    const juce::Identifier kHarmonyVoiceTag   { "HarmonyVoice" };
    const juce::Identifier kVersionAttr       { "version" };
    const juce::Identifier kIntervalAttr      { "interval" };
    const juce::Identifier kDirectionAttr     { "direction" };
    const juce::Identifier kParamTag          { "PARAM" };
    const juce::Identifier kIdAttr            { "id" };
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
    // first save sees a stable tree shape even if no harmony voices are set.
    auto& root = apvts.state;
    auto child = root.getOrCreateChildWithName(kPointsmanStateTag, nullptr);
    child.setProperty(kVersionAttr, kStateVersion, nullptr);

    // Pre-populate harmonyVoices with a default diatonic triad
    // (3rd-above + 5th-above) so chord mode is "single note becomes a
    // chord" out of the box. The user can clear or edit voices in the
    // editor's HARMONY group; an empty harmonyVoices in chord mode
    // collapses to 1-in-1-out (identical to scale mode).
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
    // Cap headroom: each input noteOn schedules 2 events × (1 + harmony
    // voices), so a generous reserve covers ~64 in-flight noteOns at the
    // 3-voice harmony max without a heap reallocation on the audio
    // thread. v1 surface does not promise a hard polyphony bound; if a
    // future use case exceeds this we revisit option C (fixed-capacity
    // ring) per ADR 003 §"Post-Phase 4 audit follow-ups".
    pending_.reserve(512);
    sounding_.clear();
    sounding_.reserve(128);
    // Pre-size the scale-pitch cache so the cache-miss rewrite path in
    // processBlock fills it via buildScalePitchesInto() without ever
    // re-allocating the underlying buffer on the audio thread. 128 is the
    // worst case (ChromaticHalf = identity).
    cachedScalePitches_.reserve(128);
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

    // Refresh the audio-side harmony-voices snapshot if the UI bumped
    // the version since last block. Try-lock so the audio thread never
    // blocks on a UI-thread writer that owns the canonical container;
    // on contention we keep the previous block's snapshot (RT-safe).
    const uint64_t hvVer = harmonyVoicesVersion_.load(std::memory_order_acquire);
    if (hvVer != harmonyVoicesAudioVersion_)
    {
        const juce::SpinLock::ScopedTryLockType tryLock(harmonyVoicesLock_);
        if (tryLock.isLocked())
        {
            harmonyVoicesAudioCount_ =
                std::min(harmonyVoices.size(), kHarmonyVoicesMax);
            for (std::size_t i = 0; i < harmonyVoicesAudioCount_; ++i)
                harmonyVoicesAudio_[i] = harmonyVoices[i];
            harmonyVoicesAudioVersion_ = hvVer;
        }
    }

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

            // Quantize input to nearest scale degree; chord-mode voices
            // are then computed off that anchor so an out-of-scale
            // input still resolves to a valid (scale, root) chord.
            const int quantized = snapToScale(pitch, scalePitches);

            // Build output pitches:
            //   scale mode: [quantized]                       → 1 note
            //   chord mode: [quantized, ...harmonyVoices]     → 1 + N notes
            // Chord mode is the "single-note-becomes-chord" expansion:
            // each input attack emits the scale-snapped input plus N
            // diatonic voices (user-configurable in the editor's
            // HARMONY group; new instances default to 3rd-above + 5th-
            // above = a diatonic triad). Out-of-scale input is snapped
            // first, so e.g. C# in C major → C → triad rooted on C.
            int outPitches[1 + kHarmonyVoicesMax];
            int numOut = 0;
            outPitches[numOut++] = quantized;
            if (modeChoice == ModeChoice::Chord)
            {
                // Iterate the audio-side snapshot (refreshed at the top
                // of processBlock under try-lock) so there is no race
                // against UI-thread setHarmonyVoices. Voices that clamp
                // to the base are still emitted (parity with m4l /
                // inboil; see Batch 2 fix).
                for (std::size_t i = 0; i < harmonyVoicesAudioCount_; ++i)
                    outPitches[numOut++] = diatonicShift(
                        quantized,
                        harmonyVoicesAudio_[i].interval,
                        harmonyVoicesAudio_[i].direction,
                        scalePitches);
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
    if (v.size() > kHarmonyVoicesMax)
        v.resize(kHarmonyVoicesMax);
    {
        const juce::SpinLock::ScopedLockType lock(harmonyVoicesLock_);
        harmonyVoices = std::move(v);
        // Bump under the lock so a try-locking audio reader either sees
        // the old (vector, version) pair or the new pair, never a torn
        // mix. fetch_add returns the old value; we don't need it.
        harmonyVoicesVersion_.fetch_add(1, std::memory_order_release);
    }
    syncHarmonyVoicesToTree();
}

void PointsmanProcessor::syncHarmonyVoicesToTree()
{
    auto& root = apvts.state;
    auto child = root.getOrCreateChildWithName(kPointsmanStateTag, nullptr);
    child.setProperty(kVersionAttr, kStateVersion, nullptr);
    child.removeAllChildren(nullptr);
    // Defense in depth: most hosts call getStateInformation on the message
    // thread (single-writer with setHarmonyVoices), but some preset-preview /
    // batch-save paths call it from a background thread. Take the lock so
    // the read is well-defined regardless. Caller (setHarmonyVoices) has
    // already released its lock by this point, so no re-entrancy.
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
    // Called from the message thread (setStateInformation). Hold the lock
    // around the rebuild so an audio-thread try-lock either sees the old
    // pre-load contents or the fully-rebuilt new ones, never a torn
    // intermediate state during the clear→push_back loop.
    const juce::SpinLock::ScopedLockType lock(harmonyVoicesLock_);
    harmonyVoices.clear();
    auto child = apvts.state.getChildWithName(kPointsmanStateTag);
    if (child.isValid())
    {
        for (int i = 0; i < child.getNumChildren(); ++i)
        {
            // Cap at kHarmonyVoicesMax: processBlock writes voices into a
            // fixed outPitches[1+kHarmonyVoicesMax] stack buffer.
            // setHarmonyVoices() already clamps; this branch is the
            // second ingress (preset load, hand-edited XML) and must
            // clamp too.
            if (harmonyVoices.size() >= kHarmonyVoicesMax) break;
            auto node = child.getChild(i);
            if (!node.hasType(kHarmonyVoiceTag)) continue;
            HarmonyVoice v{};
            // concept.md §"Chord and harmony modes" pins interval to
            // {3, 4, 5, 6}. Silently clamp out-of-range values from a
            // hand-edited or forward-incompatible preset rather than
            // refusing the load (forward-compat for v1↔future migration).
            const int rawInterval = static_cast<int>(
                node.getProperty(kIntervalAttr, 3));
            v.interval = juce::jlimit(3, 6, rawInterval);
            const auto dir = node.getProperty(kDirectionAttr, "above").toString();
            v.direction = (dir == "below") ? HarmonyDirection::Below : HarmonyDirection::Above;
            harmonyVoices.push_back(v);
        }
    }
    harmonyVoicesVersion_.fetch_add(1, std::memory_order_release);
}

void PointsmanProcessor::getStateInformation(juce::MemoryBlock& destData)
{
    syncHarmonyVoicesToTree();
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

    // ADR 003 Phase 5: detect a v1 state tree by either (a) the presence
    // of any removed pid in a PARAM child or (b) a PointsmanState child
    // whose `version` property is not "2". A v1 tree is silently
    // discarded; live defaults are preserved.
    const auto looksLikeV1 = [&]
    {
        for (int i = 0; i < loaded.getNumChildren(); ++i)
        {
            auto child = loaded.getChild(i);
            if (child.hasType(kParamTag))
            {
                const auto id = child.getProperty(kIdAttr).toString();
                for (const char* removed : pid::kRemovedV1Pids)
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

    if (looksLikeV1)
    {
        juce::Logger::writeToLog("Pointsman: discarding pre-v2 state");
        return; // keep the default-constructed v2 state intact
    }

    apvts.replaceState(loaded);
    syncHarmonyVoicesFromTree();
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new PointsmanProcessor();
}
