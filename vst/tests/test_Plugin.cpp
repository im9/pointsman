// Tests for the Pointsman APVTS / processor surface per ADR 003 Phase 2:
// APVTS round-trip, harmonyVoices ValueTree round-trip, panic on transport
// stop, controlChannel chord-context maintenance, mode=chord controlChannel
// notes consumed.
//
// Uses pointsman_plugin_core (no juce_audio_plugin_client wrapper) so the
// processor can be exercised directly without an AU/VST3 host.

#include <catch2/catch_test_macros.hpp>

#include <juce_audio_basics/juce_audio_basics.h>

#include "Engine/State.h"
#include "Plugin/Parameters.h"
#include "Plugin/PluginProcessor.h"

using namespace pointsman;

namespace
{
    // Set a Choice / Int / Float parameter to a raw value via the same
    // setValueNotifyingHost path the host would use, exercising the full
    // 0..1 normalisation round-trip.
    void setParamRaw(juce::AudioProcessorValueTreeState& s,
                     const char* pid,
                     float rawValue)
    {
        auto* p = s.getParameter(pid);
        REQUIRE(p != nullptr);
        p->setValueNotifyingHost(p->convertTo0to1(rawValue));
    }

    int getParamRawInt(juce::AudioProcessorValueTreeState& s, const char* pid)
    {
        auto* raw = s.getRawParameterValue(pid);
        REQUIRE(raw != nullptr);
        return static_cast<int>(raw->load());
    }

    float getParamRawFloat(juce::AudioProcessorValueTreeState& s, const char* pid)
    {
        auto* raw = s.getRawParameterValue(pid);
        REQUIRE(raw != nullptr);
        return raw->load();
    }

    // Drive processBlock with an empty audio buffer and the given MIDI
    // buffer (in/out swap). Pointsman is IS_MIDI_EFFECT, so 0-channel
    // audio is the host contract.
    void processOnce(PointsmanProcessor& p, juce::MidiBuffer& midi, int blockSize = 256)
    {
        juce::AudioBuffer<float> audio(0, blockSize);
        p.processBlock(audio, midi);
    }
}

TEST_CASE("APVTS: every canonical pid round-trips via getState/setState",
          "[plugin][apvts]")
{
    PointsmanProcessor src;
    src.prepareToPlay(44100.0, 256);

    // Mutate every native pid to a non-default value. Choices use indices
    // matched to the ADR §"Parameter persistence" table; Ints / Floats use
    // mid-range values that cannot collide with the constructor defaults.
    setParamRaw(src.apvts, pid::scale,            7.0f);  // Pentatonic
    setParamRaw(src.apvts, pid::root,             5.0f);
    setParamRaw(src.apvts, pid::mode,             2.0f);  // Harmony
    setParamRaw(src.apvts, pid::humanizeVelocity, 0.42f);
    setParamRaw(src.apvts, pid::humanizeGate,     0.13f);
    setParamRaw(src.apvts, pid::humanizeTiming,   0.71f);
    setParamRaw(src.apvts, pid::humanizeDrift,    0.95f);
    setParamRaw(src.apvts, pid::outputLevel,      0.5f);
    setParamRaw(src.apvts, pid::triggerMode,      1.0f);  // Root
    setParamRaw(src.apvts, pid::inputChannel,     3.0f);
    setParamRaw(src.apvts, pid::controlChannel,   16.0f);
    // Test seed value chosen below 2^24 so it is exactly representable as
    // float32 — APVTS stores parameter values as float32, so any test value
    // above 2^24 would lose bits in the legitimate save → reopen path.
    // (Parameter range itself is also clamped to [0, 0xffffff] for the same
    // reason — see Parameters.cpp.)
    setParamRaw(src.apvts, pid::seed,             12345678.0f);

    juce::MemoryBlock blob;
    src.getStateInformation(blob);

    PointsmanProcessor dst;
    dst.setStateInformation(blob.getData(), static_cast<int>(blob.getSize()));

    REQUIRE(getParamRawInt(dst.apvts,   pid::scale)            == 7);
    REQUIRE(getParamRawInt(dst.apvts,   pid::root)             == 5);
    REQUIRE(getParamRawInt(dst.apvts,   pid::mode)             == 2);
    REQUIRE(getParamRawFloat(dst.apvts, pid::humanizeVelocity) == 0.42f);
    REQUIRE(getParamRawFloat(dst.apvts, pid::humanizeGate)     == 0.13f);
    REQUIRE(getParamRawFloat(dst.apvts, pid::humanizeTiming)   == 0.71f);
    REQUIRE(getParamRawFloat(dst.apvts, pid::humanizeDrift)    == 0.95f);
    REQUIRE(getParamRawFloat(dst.apvts, pid::outputLevel)      == 0.5f);
    REQUIRE(getParamRawInt(dst.apvts,   pid::triggerMode)      == 1);
    REQUIRE(getParamRawInt(dst.apvts,   pid::inputChannel)     == 3);
    REQUIRE(getParamRawInt(dst.apvts,   pid::controlChannel)   == 16);
    REQUIRE(getParamRawInt(dst.apvts,   pid::seed)             == 12345678);
}

TEST_CASE("harmonyVoices: ValueTree round-trip preserves order + fields",
          "[plugin][harmony]")
{
    PointsmanProcessor src;
    src.setHarmonyVoices({
        {3, HarmonyDirection::Above},  // 3rd above
        {5, HarmonyDirection::Above},  // 5th above
        {3, HarmonyDirection::Below},  // 3rd below
    });

    juce::MemoryBlock blob;
    src.getStateInformation(blob);

    PointsmanProcessor dst;
    dst.setStateInformation(blob.getData(), static_cast<int>(blob.getSize()));

    const auto& voices = dst.getHarmonyVoices();
    REQUIRE(voices.size() == 3);
    REQUIRE(voices[0].interval == 3);
    REQUIRE(voices[0].direction == HarmonyDirection::Above);
    REQUIRE(voices[1].interval == 5);
    REQUIRE(voices[1].direction == HarmonyDirection::Above);
    REQUIRE(voices[2].interval == 3);
    REQUIRE(voices[2].direction == HarmonyDirection::Below);
}

TEST_CASE("harmonyVoices: empty round-trip produces empty vector",
          "[plugin][harmony]")
{
    // PointsmanState child must be present from construction (so the host's
    // first save sees a stable shape) — but with zero HarmonyVoice entries
    // the round-trip is empty, not absent.
    PointsmanProcessor src;
    REQUIRE(src.getHarmonyVoices().empty());

    juce::MemoryBlock blob;
    src.getStateInformation(blob);

    PointsmanProcessor dst;
    dst.setStateInformation(blob.getData(), static_cast<int>(blob.getSize()));
    REQUIRE(dst.getHarmonyVoices().empty());
}

TEST_CASE("panic: transport stop emits noteOff for every active output",
          "[plugin][panic]")
{
    PointsmanProcessor p;
    p.prepareToPlay(44100.0, 256);

    // Default mode = scale, default scale = major, root = 0 → 60 (C4) is
    // already in scale, so it passes through pitch-unchanged. (We don't
    // assert on pitch identity here — only that *something* is emitted on
    // noteOn and that *something else* is emitted on transport stop.)
    p.setHostIsPlayingForTest(true);

    {
        juce::MidiBuffer midi;
        midi.addEvent(juce::MidiMessage::noteOn(1, 60, static_cast<juce::uint8>(100)), 0);
        processOnce(p, midi);

        // Output should contain at least one noteOn (the quantized base).
        bool sawNoteOn = false;
        for (const auto meta : midi)
            if (meta.getMessage().isNoteOn()) sawNoteOn = true;
        REQUIRE(sawNoteOn);
    }

    // Transition to stopped — next processBlock fires the panic flush.
    p.setHostIsPlayingForTest(false);
    {
        juce::MidiBuffer midi; // empty input
        processOnce(p, midi);

        bool sawNoteOff = false;
        for (const auto meta : midi)
        {
            const auto m = meta.getMessage();
            if (m.isNoteOff() && m.getChannel() == 1) sawNoteOff = true;
        }
        REQUIRE(sawNoteOff);
    }

    // A second stopped processBlock should be a no-op — panic only fires
    // on the playing→stopped edge, not on every stopped block.
    {
        juce::MidiBuffer midi;
        processOnce(p, midi);
        bool any = false;
        for (const auto meta : midi) { (void) meta; any = true; }
        REQUIRE_FALSE(any);
    }
}

TEST_CASE("controlChannel: mode=chord notes maintain chord context, "
          "are not emitted",
          "[plugin][chord]")
{
    PointsmanProcessor p;
    p.prepareToPlay(44100.0, 256);
    p.setHostIsPlayingForTest(true);

    // Set mode = chord, controlChannel = 2.
    setParamRaw(p.apvts, pid::mode, 1.0f);
    setParamRaw(p.apvts, pid::controlChannel, 2.0f);

    // Send chord-context noteOn (pitch class 4 = E).
    {
        juce::MidiBuffer midi;
        midi.addEvent(juce::MidiMessage::noteOn(2, 64, static_cast<juce::uint8>(100)), 0);
        processOnce(p, midi);

        // Output buffer must be empty — control notes are consumed.
        bool any = false;
        for (const auto meta : midi) { (void) meta; any = true; }
        REQUIRE_FALSE(any);
    }
    REQUIRE(p.chordContextPcsForTest() == std::vector<int>{4});

    // Add a second chord-tone (G = pc 7).
    {
        juce::MidiBuffer midi;
        midi.addEvent(juce::MidiMessage::noteOn(2, 67, static_cast<juce::uint8>(100)), 0);
        processOnce(p, midi);
        REQUIRE(p.chordContextPcsForTest() == std::vector<int>{4, 7});
    }

    // Release the first chord note: pc 4 leaves the context.
    {
        juce::MidiBuffer midi;
        midi.addEvent(juce::MidiMessage::noteOff(2, 64), 0);
        processOnce(p, midi);
        REQUIRE(p.chordContextPcsForTest() == std::vector<int>{7});
    }
}

TEST_CASE("controlChannel: triggerMode=root noteOn sets root pc, is consumed",
          "[plugin][trigger]")
{
    PointsmanProcessor p;
    p.prepareToPlay(44100.0, 256);
    p.setHostIsPlayingForTest(true);

    setParamRaw(p.apvts, pid::triggerMode, 1.0f);   // Root
    setParamRaw(p.apvts, pid::controlChannel, 4.0f);

    juce::MidiBuffer midi;
    // pitch 65 → pc 5 = F.
    midi.addEvent(juce::MidiMessage::noteOn(4, 65, static_cast<juce::uint8>(100)), 0);
    processOnce(p, midi);

    bool any = false;
    for (const auto meta : midi) { (void) meta; any = true; }
    REQUIRE_FALSE(any);                                  // consumed

    REQUIRE(getParamRawInt(p.apvts, pid::root) == 5);    // root updated
}

TEST_CASE("input quantize: mode=scale snaps non-scale notes to nearest in-scale",
          "[plugin][quantize]")
{
    // Default state is major / root=0 / mode=scale. Input C# (61) snaps to
    // C (60) by tie-to-lower against {60, 62}.
    PointsmanProcessor p;
    p.prepareToPlay(44100.0, 256);
    p.setHostIsPlayingForTest(true);

    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 61, static_cast<juce::uint8>(100)), 0);
    processOnce(p, midi);

    int sawPitch = -1;
    for (const auto meta : midi)
    {
        const auto m = meta.getMessage();
        if (m.isNoteOn()) { sawPitch = m.getNoteNumber(); break; }
    }
    REQUIRE(sawPitch == 60);
}
