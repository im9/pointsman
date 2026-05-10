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

void PointsmanProcessor::prepareToPlay(double, int)
{
    // RNG is (re-)seeded lazily inside processBlock when the seed param
    // changes. prepareToPlay just resets transport-tracking state; drift
    // is reset on transport-start per concept.md §"Per-event humanize".
    wasPlaying = false;
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
    // Flush every emitted-but-not-yet-released note, then clear chord
    // context per concept.md §"Transport stop does not touch drift state"
    // — drift survives, but in-flight notes and chord context do not.
    for (const auto& in : activeInputs)
    {
        for (const auto& outNote : in.outputs)
            writeNoteOffTracked(out, sampleOffset, outNote.channel, outNote.pitch);
    }
    activeInputs.clear();
    chordContext.pitchClasses.clear();
}

void PointsmanProcessor::processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer& midi)
{
    juce::MidiBuffer out;

    // ---- Transport edge: stop → panic ----
    const bool playing = isHostPlaying();
    if (wasPlaying && !playing)
    {
        emitPanicTo(out, 0);
        // Drift state does NOT reset on stop (concept.md). It DOES reset on
        // a 0→1 transport edge so each play loop re-seeds from the same
        // initial state.
    }
    if (!wasPlaying && playing)
    {
        driftState = DriftState{};
    }
    wasPlaying = playing;

    // ---- Read params ----
    const int    seedVal     = loadInt(apvts, pid::seed);
    const int    rootPc      = loadInt(apvts, pid::root);
    const auto   scale       = static_cast<ScaleName>(loadInt(apvts, pid::scale));
    const auto   modeChoice  = static_cast<ModeChoice>(loadInt(apvts, pid::mode));
    const auto   triggerCh   = static_cast<TriggerModeChoice>(loadInt(apvts, pid::triggerMode));
    const int    inputCh     = loadInt(apvts, pid::inputChannel);
    const int    controlCh   = loadInt(apvts, pid::controlChannel);
    const float  vAmp        = loadFloat(apvts, pid::humanizeVelocity);
    const float  gAmp        = loadFloat(apvts, pid::humanizeGate);
    const float  tAmp        = loadFloat(apvts, pid::humanizeTiming);
    const float  dFactor     = loadFloat(apvts, pid::humanizeDrift);
    const float  outLvl      = loadFloat(apvts, pid::outputLevel);

    // Re-seed RNG if seed changed (or first call). Drift state survives.
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
                continue; // consume — control channel notes do not appear on output
            }

            if (controlIsRootRole)
            {
                const int newRoot = ((pitch % 12) + 12) % 12;
                if (auto* rp = apvts.getParameter(pid::root))
                {
                    rp->setValueNotifyingHost(rp->convertTo0to1(static_cast<float>(newRoot)));
                }
                continue; // consume
            }

            // Ordinary input: filter by inputChannel.
            if (!channelMatches(ch, inputCh))
            {
                out.addEvent(msg, sample);
                continue;
            }

            // Quantize.
            int quantized = pitch;
            if (modeChoice == ModeChoice::Chord)
                quantized = snapToChordTones(pitch, chordContext.pitchClasses, scalePitches);
            else
                quantized = snapToScale(pitch, scalePitches);

            // Humanize: velocity / gate / timing draws. sourceStepDuration is
            // 0 in v1 (Pointsman is input-driven; no upstream step concept
            // is propagated yet) — timingOffset collapses to 0, so the host
            // gets a zero-jitter sample position. Drift / velocity / gate
            // perturbations still apply.
            ComposeArgs ha{};
            ha.velocity = vAmp;
            ha.gate = gAmp;
            ha.timing = tAmp;
            ha.driftFactor = dFactor;
            ha.inputVelocity = velIn;
            ha.outputLevel = outLvl;
            ha.outputGateBase = 1.0;
            ha.sourceStepDuration = 0.0;
            const auto hr = composeHumanize(rng, driftState, ha);

            InputNote inNote{};
            inNote.channel = ch;
            inNote.pitch = pitch;

            // Base note.
            writeNoteOnTracked(out, sample, ch, quantized, hr.velocityFinal);
            inNote.outputs.push_back({ch, quantized});

            // Harmony voices on top of the base.
            if (modeChoice == ModeChoice::Harmony)
            {
                for (const auto& v : harmonyVoices)
                {
                    const int voicePitch =
                        diatonicShift(quantized, v.interval, v.direction, scalePitches);
                    if (voicePitch == quantized) continue; // unison: skip duplicate
                    writeNoteOnTracked(out, sample, ch, voicePitch, hr.velocityFinal);
                    inNote.outputs.push_back({ch, voicePitch});
                }
            }

            activeInputs.push_back(std::move(inNote));
        }
        else if (msg.isNoteOff())
        {
            const int pitch = msg.getNoteNumber();

            if (controlIsChordRole)
            {
                const int pc = ((pitch % 12) + 12) % 12;
                auto& v = chordContext.pitchClasses;
                v.erase(std::remove(v.begin(), v.end(), pc), v.end());
                continue;
            }

            if (controlIsRootRole)
            {
                continue; // root is set on noteOn; noteOff is silently consumed
            }

            // Find the matching input. If this noteOff has no tracked input
            // (e.g. it was filtered away earlier or never quantized), drop
            // it on the floor — emitting a stray noteOff would risk a
            // mismatched pair downstream.
            auto it = std::find_if(activeInputs.begin(), activeInputs.end(),
                [&](const InputNote& in)
                { return in.channel == ch && in.pitch == pitch; });

            if (it != activeInputs.end())
            {
                for (const auto& outNote : it->outputs)
                    writeNoteOffTracked(out, sample, outNote.channel, outNote.pitch);
                activeInputs.erase(it);
            }
        }
        else
        {
            // Non-note traffic: CC, PB, channel pressure, etc. — pass through.
            out.addEvent(msg, sample);
        }
    }

    midi.swapWith(out);
}

juce::AudioProcessorEditor* PointsmanProcessor::createEditor()
{
    return new PointsmanEditor(*this);
}

void PointsmanProcessor::setHarmonyVoices(std::vector<HarmonyVoice> v)
{
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
