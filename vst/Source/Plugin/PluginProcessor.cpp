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
}

PointsmanProcessor::PointsmanProcessor()
    : AudioProcessor(BusesProperties()),
      apvts(*this, nullptr, "Pointsman", makeParameterLayout())
{
    // Ensure the PointsmanState child exists from construction so the host's
    // first save sees a stable tree shape even if no harmony voices are set.
    auto& root = apvts.state;
    auto child = root.getOrCreateChildWithName(kPointsmanStateTag, nullptr);
    child.setProperty(kVersionAttr, kStateVersion, nullptr);
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
    pending_.reserve(64);    // typical bound: a few notes in flight
    sounding_.clear();
    sounding_.reserve(32);
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

    // Publish the pulse signal for the editor's glow animation. Release
    // ordering pairs with acquire on the UI side; the version counter
    // turns the single-store into a one-shot edge that ScaleKeyboardView's
    // timer poll converts into a pulse-list append.
    ++pulseVersion;
    lastEmittedPulse.store(packPulse(pulseVersion, pitch, vel, channel),
                           std::memory_order_release);
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
    chordContext.pitchClasses.clear();
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
    juce::MidiBuffer out;
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
    const auto   triggerCh  = static_cast<TriggerModeChoice>(loadInt(apvts, pid::triggerMode));
    const int    inputCh    = loadInt(apvts, pid::inputChannel);
    const int    controlCh  = loadInt(apvts, pid::controlChannel);
    const float  vAmp       = loadFloat(apvts, pid::humanizeVelocity);
    const float  gAmp       = loadFloat(apvts, pid::humanizeGate);
    const float  tAmp       = loadFloat(apvts, pid::humanizeTiming);
    const float  dFactor    = loadFloat(apvts, pid::humanizeDrift);
    const float  outLvl     = loadFloat(apvts, pid::outputLevel);

    // Re-seed if seed param changed mid-session (host automation / UI).
    if (!rngInitialised || static_cast<uint32_t>(seedVal) != lastSeed)
    {
        rng = seedRng(static_cast<uint32_t>(seedVal));
        lastSeed = static_cast<uint32_t>(seedVal);
        rngInitialised = true;
    }

    const auto scalePitches = buildScalePitches(scale, rootPc);

    // ---- Iterate input MIDI ----
    for (const auto meta : midi)
    {
        const auto msg = meta.getMessage();
        const int sample = meta.samplePosition;
        const int ch = msg.getChannel();

        // controlChannel role only kicks in when an active mode uses it
        // (mode = chord, or triggerMode = root). Otherwise the channel is
        // treated as ordinary input subject to inputChannel filtering.
        const bool isControl = (ch == controlCh);
        const bool controlIsChordRole = isControl && modeChoice == ModeChoice::Chord;
        const bool controlIsRootRole  = isControl && triggerCh == TriggerModeChoice::Root
                                        && modeChoice != ModeChoice::Chord;

        if (msg.isNoteOn())
        {
            const int pitch = msg.getNoteNumber();
            const int velIn = msg.getVelocity();

            if (controlIsChordRole)
            {
                const int pc = ((pitch % 12) + 12) % 12;
                if (std::find(chordContext.pitchClasses.begin(),
                              chordContext.pitchClasses.end(), pc)
                    == chordContext.pitchClasses.end())
                    chordContext.pitchClasses.push_back(pc);
                continue;
            }
            if (controlIsRootRole)
            {
                const int newRoot = ((pitch % 12) + 12) % 12;
                if (auto* rp = apvts.getParameter(pid::root))
                    rp->setValueNotifyingHost(rp->convertTo0to1(static_cast<float>(newRoot)));
                continue;
            }
            if (!channelMatches(ch, inputCh))
            {
                out.addEvent(msg, sample);
                continue;
            }

            // ── Humanize-driven scheduling ─────────────────────────
            const uint64_t absInputSample = blockStartAbs_ + static_cast<uint64_t>(sample);
            const double sourceStepSamples = haveLastInput_
                ? static_cast<double>(absInputSample - lastInputSampleAbs_)
                : (kFirstEventStepMs * sampleRate_ / 1000.0);
            lastInputSampleAbs_ = absInputSample;
            haveLastInput_ = true;

            ComposeArgs ha{};
            ha.velocity           = vAmp;
            ha.gate               = gAmp;
            ha.timing             = tAmp;
            ha.driftFactor        = dFactor;
            ha.inputVelocity      = velIn;
            ha.outputLevel        = outLvl;
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

            // Quantize.
            const int quantized = (modeChoice == ModeChoice::Chord)
                ? snapToChordTones(pitch, chordContext.pitchClasses, scalePitches)
                : snapToScale(pitch, scalePitches);

            // Build output pitches: base + harmony voices. Harmony voices
            // that clamp to the base are still emitted (parity with m4l /
            // inboil; see Batch 2 fix).
            // Reservation note: harmonyVoices is bounded to kHarmonyVoicesMax,
            // so this push_back chain stays within initial capacity.
            int outPitches[1 + kHarmonyVoicesMax];
            int numOut = 0;
            outPitches[numOut++] = quantized;
            if (modeChoice == ModeChoice::Harmony)
            {
                for (const auto& v : harmonyVoices)
                    outPitches[numOut++] =
                        diatonicShift(quantized, v.interval, v.direction, scalePitches);
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
            if (controlIsChordRole)
            {
                const int pc = ((msg.getNoteNumber() % 12) + 12) % 12;
                auto& v = chordContext.pitchClasses;
                v.erase(std::remove(v.begin(), v.end(), pc), v.end());
                continue;
            }
            // controlIsRootRole and ordinary input noteOffs are silently
            // consumed: output gating is humanize-driven, not input-paired
            // (concept.md §"Per-event humanize"; m4l host.ts:222-230).
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
    harmonyVoices = std::move(v);
    syncHarmonyVoicesToTree();
}

void PointsmanProcessor::syncHarmonyVoicesToTree()
{
    auto& root = apvts.state;
    auto child = root.getOrCreateChildWithName(kPointsmanStateTag, nullptr);
    child.setProperty(kVersionAttr, kStateVersion, nullptr);
    child.removeAllChildren(nullptr);
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
    harmonyVoices.clear();
    auto child = apvts.state.getChildWithName(kPointsmanStateTag);
    if (!child.isValid()) return;
    for (int i = 0; i < child.getNumChildren(); ++i)
    {
        // Cap at kHarmonyVoicesMax: processBlock writes voices into a fixed
        // outPitches[1+kHarmonyVoicesMax] stack buffer. setHarmonyVoices()
        // already clamps; this branch is the second ingress (preset load,
        // hand-edited XML) and must clamp too.
        if (harmonyVoices.size() >= kHarmonyVoicesMax) break;
        auto node = child.getChild(i);
        if (!node.hasType(kHarmonyVoiceTag)) continue;
        HarmonyVoice v{};
        v.interval = static_cast<int>(node.getProperty(kIntervalAttr, 3));
        const auto dir = node.getProperty(kDirectionAttr, "above").toString();
        v.direction = (dir == "below") ? HarmonyDirection::Below : HarmonyDirection::Above;
        harmonyVoices.push_back(v);
    }
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
    if (auto xml = getXmlFromBinary(data, sizeInBytes))
    {
        if (xml->hasTagName(apvts.state.getType()))
        {
            apvts.replaceState(juce::ValueTree::fromXml(*xml));
            syncHarmonyVoicesFromTree();
        }
    }
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new PointsmanProcessor();
}
