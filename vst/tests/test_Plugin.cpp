// Tests for the Pointsman APVTS / processor surface per ADR 003 Phase 5
// (parameter surface v2 + chord/harmony merge): APVTS round-trip,
// harmonyVoices ValueTree round-trip, chord-mode triad expansion
// (concept.md §"Chord and harmony modes"), panic on transport stop,
// random-seed init, v1 state discard.
//
// Uses pointsman_plugin_core (no juce_audio_plugin_client wrapper) so the
// processor can be exercised directly without an AU/VST3 host.

#include <catch2/catch_test_macros.hpp>

#include <juce_audio_basics/juce_audio_basics.h>

#include <set>

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
    setParamRaw(src.apvts, pid::scale,        7.0f);  // Pentatonic
    setParamRaw(src.apvts, pid::root,         5.0f);
    setParamRaw(src.apvts, pid::mode,         1.0f);  // Chord (post-merge)
    setParamRaw(src.apvts, pid::feel,         0.42f);
    setParamRaw(src.apvts, pid::drift,        0.95f);
    setParamRaw(src.apvts, pid::inputChannel, 3.0f);
    // Test seed value chosen below 2^24 so it is exactly representable as
    // float32 — APVTS stores parameter values as float32, so any test value
    // above 2^24 would lose bits in the legitimate save → reopen path.
    // (Parameter range itself is also clamped to [0, 0xffffff] for the same
    // reason — see Parameters.cpp.)
    setParamRaw(src.apvts, pid::seed,         12345678.0f);

    juce::MemoryBlock blob;
    src.getStateInformation(blob);

    PointsmanProcessor dst;
    dst.setStateInformation(blob.getData(), static_cast<int>(blob.getSize()));

    REQUIRE(getParamRawInt(dst.apvts,   pid::scale)        == 7);
    REQUIRE(getParamRawInt(dst.apvts,   pid::root)         == 5);
    REQUIRE(getParamRawInt(dst.apvts,   pid::mode)         == 1);
    REQUIRE(getParamRawFloat(dst.apvts, pid::feel)         == 0.42f);
    REQUIRE(getParamRawFloat(dst.apvts, pid::drift)        == 0.95f);
    REQUIRE(getParamRawInt(dst.apvts,   pid::inputChannel) == 3);
    REQUIRE(getParamRawInt(dst.apvts,   pid::seed)         == 12345678);
}

TEST_CASE("harmonyVoices: new processor instance defaults to a diatonic "
          "triad ({3rd above, 5th above})",
          "[plugin][harmony][defaults]")
{
    // Phase 5 redesign (post-merge): chord mode is renamed-and-merged from
    // harmony mode. With harmonyVoices empty, mode = chord degenerates to
    // 1-in-1-out (identical to scale). To deliver the "single note becomes
    // a chord" behaviour out of the box, new instances are pre-populated
    // with a 1-3-5 diatonic triad. Users can edit the voices in the
    // editor's HARMONY group (or remove them to fall back to plain
    // quantize within chord mode).
    PointsmanProcessor p;
    const auto& v = p.getHarmonyVoices();
    REQUIRE(v.size() == 2);
    REQUIRE(v[0].interval  == 3);
    REQUIRE(v[0].direction == HarmonyDirection::Above);
    REQUIRE(v[1].interval  == 5);
    REQUIRE(v[1].direction == HarmonyDirection::Above);
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

TEST_CASE("harmonyVoices: setHarmonyVoices truncates to kHarmonyVoicesMax",
          "[plugin][harmony]")
{
    // concept.md §"Parameter surface": harmonyVoices length is 0..3. The
    // editor's `+` button blocks adds at >=3, but the processor-side API
    // (setHarmonyVoices) is reachable from preset load and any other path
    // that bypasses the editor. Defense-in-depth here: silently truncate
    // to the canonical max so processBlock never iterates a 4th voice.
    PointsmanProcessor p;
    p.setHarmonyVoices({
        {3, HarmonyDirection::Above},
        {4, HarmonyDirection::Above},
        {5, HarmonyDirection::Above},
        {6, HarmonyDirection::Above},  // 4th — must be dropped
    });
    REQUIRE(p.getHarmonyVoices().size() == kHarmonyVoicesMax);
    REQUIRE(p.getHarmonyVoices()[0].interval == 3);
    REQUIRE(p.getHarmonyVoices()[1].interval == 4);
    REQUIRE(p.getHarmonyVoices()[2].interval == 5);
}

TEST_CASE("harmonyVoices: preset with >kHarmonyVoicesMax HarmonyVoice nodes "
          "is clamped on load",
          "[plugin][harmony]")
{
    // Defense-in-depth at the preset boundary. setHarmonyVoices() truncates
    // at kHarmonyVoicesMax, but setStateInformation → syncHarmonyVoicesFromTree
    // previously read every <HarmonyVoice> child unbounded. processBlock
    // writes harmony voices into a fixed-size outPitches[1+kHarmonyVoicesMax]
    // buffer; a corrupt or hand-edited preset with 4+ HarmonyVoice nodes
    // would overflow it. Mirror the setter's clamp at the load boundary.
    //
    // Threshold (3): from concept.md §"Parameter surface" ("HarmonyVoice[]
    // length 0..3") and Engine/State.h kHarmonyVoicesMax.
    struct CopyXmlExposer : public PointsmanProcessor
    {
        using AudioProcessor::copyXmlToBinary;
    };
    CopyXmlExposer src;
    auto state = src.apvts.copyState();
    auto child = state.getOrCreateChildWithName(
        juce::Identifier("PointsmanState"), nullptr);
    child.removeAllChildren(nullptr);
    for (int i = 0; i < 5; ++i)   // 5 voices, exceeds the cap of 3
    {
        juce::ValueTree node(juce::Identifier("HarmonyVoice"));
        node.setProperty(juce::Identifier("interval"), 3 + (i % 4), nullptr);
        node.setProperty(juce::Identifier("direction"),
                         juce::String("above"), nullptr);
        child.appendChild(node, nullptr);
    }

    juce::MemoryBlock blob;
    auto xml = state.createXml();
    REQUIRE(xml != nullptr);
    CopyXmlExposer::copyXmlToBinary(*xml, blob);

    PointsmanProcessor dst;
    dst.setStateInformation(blob.getData(), static_cast<int>(blob.getSize()));

    REQUIRE(dst.getHarmonyVoices().size() == kHarmonyVoicesMax);
}

TEST_CASE("harmonyVoices: preset with out-of-range interval is silently clamped",
          "[plugin][harmony]")
{
    // concept.md §"Chord and harmony modes": HarmonyVoice.interval ∈
    // {3, 4, 5, 6}. setStateInformation → syncHarmonyVoicesFromTree
    // previously read the integer with no range check, letting a
    // hand-edited or forward-incompatible preset inject e.g. 2 or 99
    // (defined-but-not-spec behaviour in diatonicShift's clamping).
    // ADR 003 §"Post-Phase 4 audit follow-ups" #13 option (A): silent
    // clamp at the load boundary. Mirrors the interval enum bounds.
    struct CopyXmlExposer : public PointsmanProcessor
    {
        using AudioProcessor::copyXmlToBinary;
    };
    CopyXmlExposer src;
    auto state = src.apvts.copyState();
    auto child = state.getOrCreateChildWithName(
        juce::Identifier("PointsmanState"), nullptr);
    child.removeAllChildren(nullptr);
    // Three voices: under-low / above-high / valid, in that order so
    // the assertion catches both out-of-range branches.
    auto add = [&](int interval) {
        juce::ValueTree node(juce::Identifier("HarmonyVoice"));
        node.setProperty(juce::Identifier("interval"), interval, nullptr);
        node.setProperty(juce::Identifier("direction"),
                         juce::String("above"), nullptr);
        child.appendChild(node, nullptr);
    };
    add(2);   // below the 3..6 range → clamp to 3
    add(99);  // above → clamp to 6
    add(5);   // valid → unchanged

    juce::MemoryBlock blob;
    auto xml = state.createXml();
    REQUIRE(xml != nullptr);
    CopyXmlExposer::copyXmlToBinary(*xml, blob);

    PointsmanProcessor dst;
    dst.setStateInformation(blob.getData(), static_cast<int>(blob.getSize()));

    const auto& voices = dst.getHarmonyVoices();
    REQUIRE(voices.size() == 3);
    REQUIRE(voices[0].interval == 3);
    REQUIRE(voices[1].interval == 6);
    REQUIRE(voices[2].interval == 5);
}

TEST_CASE("harmonyVoices: empty round-trip preserves emptiness across "
          "save/reopen",
          "[plugin][harmony]")
{
    // Even though new instances start with a default triad, the user may
    // explicitly clear all voices. The empty state must round-trip
    // through getState/setState so reopening the host project does not
    // resurrect the default triad. PointsmanState child must be present
    // from construction so the host's first save sees a stable shape.
    PointsmanProcessor src;
    src.setHarmonyVoices({});  // user clears all voices
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

TEST_CASE("chord mode: single noteOn expands to diatonic triad "
          "(1 in, 3 out)",
          "[plugin][chord]")
{
    // Per the Phase 5 redesign and user-stated intent ("単音をコードに
    // するモード"): chord mode is 1-in-N-out chord expansion. Each input
    // attack emits the diatonic triad rooted on the input pitch using
    // the current (scale, root) — 1-3-5 along the scale.
    //
    // Default state: scale=major, root=0 (C). Input C4 (MIDI 60) →
    // output {C4, E4, G4} = {60, 64, 67} (1-3-5 of C in C major).
    PointsmanProcessor p;
    p.prepareToPlay(44100.0, 256);
    p.setHostIsPlayingForTest(true);
    setParamRaw(p.apvts, pid::mode, 1.0f);  // chord

    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 60, juce::uint8{100}), 0);
    processOnce(p, midi);

    std::vector<int> emittedPitches;
    for (const auto meta : midi)
    {
        const auto m = meta.getMessage();
        if (m.isNoteOn()) emittedPitches.push_back(m.getNoteNumber());
    }
    std::sort(emittedPitches.begin(), emittedPitches.end());
    REQUIRE(emittedPitches == std::vector<int>{60, 64, 67});
}

TEST_CASE("chord mode: input on a non-tonic degree emits the diatonic "
          "triad of that degree (not always tonic)",
          "[plugin][chord]")
{
    // Each input pitch is the root of its own diatonic triad. In C
    // major: D4 (62) → {D, F, A} = {62, 65, 69} (ii triad).
    PointsmanProcessor p;
    p.prepareToPlay(44100.0, 256);
    p.setHostIsPlayingForTest(true);
    setParamRaw(p.apvts, pid::mode, 1.0f);  // chord

    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 62, juce::uint8{100}), 0);
    processOnce(p, midi);

    std::vector<int> emittedPitches;
    for (const auto meta : midi)
    {
        const auto m = meta.getMessage();
        if (m.isNoteOn()) emittedPitches.push_back(m.getNoteNumber());
    }
    std::sort(emittedPitches.begin(), emittedPitches.end());
    REQUIRE(emittedPitches == std::vector<int>{62, 65, 69});
}

TEST_CASE("chord mode: out-of-scale input is snapped to scale before "
          "the triad is built",
          "[plugin][chord]")
{
    // C# (61) in C major snaps to nearest scale degree first (60 = C,
    // tie-to-lower from {60, 62}), then expansion → {60, 64, 67}.
    PointsmanProcessor p;
    p.prepareToPlay(44100.0, 256);
    p.setHostIsPlayingForTest(true);
    setParamRaw(p.apvts, pid::mode, 1.0f);  // chord

    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 61, juce::uint8{100}), 0);
    processOnce(p, midi);

    std::vector<int> emittedPitches;
    for (const auto meta : midi)
    {
        const auto m = meta.getMessage();
        if (m.isNoteOn()) emittedPitches.push_back(m.getNoteNumber());
    }
    std::sort(emittedPitches.begin(), emittedPitches.end());
    REQUIRE(emittedPitches == std::vector<int>{60, 64, 67});
}

TEST_CASE("chord mode: 3 input noteOns in the same block each expand "
          "into a triad (9 outputs total)",
          "[plugin][chord][gate]")
{
    // Live chord input: user holds a triad (C, E, G). In chord-expansion
    // mode each input attack independently expands → 3 × 3 = 9 output
    // noteOns. All gate-driven by the humanize scheduler with the
    // simultaneous-threshold clamp (so every voice rings audibly).
    constexpr double sampleRate = 44100.0;
    constexpr int    blockSize  = 256;

    PointsmanProcessor p;
    p.prepareToPlay(sampleRate, blockSize);
    p.setHostIsPlayingForTest(true);
    setParamRaw(p.apvts, pid::mode, 1.0f);  // chord

    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 60, juce::uint8{100}), 0); // C
    midi.addEvent(juce::MidiMessage::noteOn(1, 64, juce::uint8{100}), 0); // E
    midi.addEvent(juce::MidiMessage::noteOn(1, 67, juce::uint8{100}), 0); // G
    processOnce(p, midi, blockSize);

    int noteOns = 0, noteOffs = 0;
    for (const auto meta : midi)
    {
        const auto m = meta.getMessage();
        if (m.isNoteOn())  ++noteOns;
        if (m.isNoteOff()) ++noteOffs;
    }
    REQUIRE(noteOns  == 9);  // 3 inputs × triad expansion
    REQUIRE(noteOffs == 0);  // 250 ms first-event gate >> blockSize
}

TEST_CASE("scale mode: single noteOn passes through as a single note "
          "(1 in, 1 out)",
          "[plugin][scale]")
{
    // Counter-test: scale mode stays 1-in-1-out. Pins that chord-mode
    // expansion did not leak into scale mode.
    PointsmanProcessor p;
    p.prepareToPlay(44100.0, 256);
    p.setHostIsPlayingForTest(true);
    // Default mode is already scale (0); no setParamRaw needed.

    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 60, juce::uint8{100}), 0);
    processOnce(p, midi);

    int noteOns = 0;
    for (const auto meta : midi)
        if (meta.getMessage().isNoteOn()) ++noteOns;
    REQUIRE(noteOns == 1);
}

TEST_CASE("seed: new instance gets a random seed in [0, 2^24-1]",
          "[plugin][seed]")
{
    // concept.md §"Per-event humanize": "New plugin instances pick a
    // random seed on construction so two parallel Pointsman instances
    // ... do not produce phase-coherent identical humanize."
    // Probabilistic guard: 16 fresh constructs must not all match —
    // P(all 16 identical) = 1 / 2^(24×15) ≈ 0 for a working RNG.
    std::set<int> seeds;
    for (int i = 0; i < 16; ++i)
    {
        PointsmanProcessor p;
        const int s = getParamRawInt(p.apvts, pid::seed);
        REQUIRE(s >= 0);
        REQUIRE(s <= 0xffffff);
        seeds.insert(s);
    }
    // At least two distinct values across 16 constructs.
    REQUIRE(seeds.size() >= 2);
}

TEST_CASE("seed: round-trips through getState/setState (random init survives save)",
          "[plugin][seed][persistence]")
{
    // The random seed picked at construction must be written into state
    // on save so reopening a project reproduces the exact same humanize
    // draws. The APVTS round-trip is bit-exact because seeds are
    // constrained to [0, 2^24-1] (exactly representable as float32).
    PointsmanProcessor src;
    const int seedBefore = getParamRawInt(src.apvts, pid::seed);

    juce::MemoryBlock blob;
    src.getStateInformation(blob);

    PointsmanProcessor dst;
    dst.setStateInformation(blob.getData(), static_cast<int>(blob.getSize()));
    REQUIRE(getParamRawInt(dst.apvts, pid::seed) == seedBefore);
}

TEST_CASE("setStateInformation: v1 state (with removed pid) is discarded; "
          "defaults are restored",
          "[plugin][state][v1]")
{
    // ADR 003 Phase 5: hard break — no v1 → v2 migration. A v1 state
    // tree (recognised by the presence of any removed pid or by
    // PointsmanState.version != "2") is silently discarded and the
    // processor falls back to default-constructed v2 params.
    //
    // Build a v1-shaped state by hand: an APVTS tree carrying a removed
    // pid (e.g. controlChannel). setStateInformation must detect the
    // pre-v2 marker and refuse to overwrite the live v2 defaults.

    PointsmanProcessor dst;
    const int defaultSeed   = getParamRawInt(dst.apvts, pid::seed);
    const int defaultInputC = getParamRawInt(dst.apvts, pid::inputChannel);

    // Construct a v1 state XML by hand — APVTS layout name matches the
    // live tree's; we attach a single PARAM child for a removed pid.
    juce::ValueTree v1State { dst.apvts.state.getType() };
    {
        juce::ValueTree param { juce::Identifier("PARAM") };
        param.setProperty(juce::Identifier("id"),    "controlChannel", nullptr);
        param.setProperty(juce::Identifier("value"), 7.0f, nullptr);
        v1State.appendChild(param, nullptr);
    }
    auto xml = v1State.createXml();
    REQUIRE(xml != nullptr);
    juce::MemoryBlock blob;
    struct Exposer : public PointsmanProcessor
    { using AudioProcessor::copyXmlToBinary; };
    Exposer::copyXmlToBinary(*xml, blob);

    dst.setStateInformation(blob.getData(), static_cast<int>(blob.getSize()));

    // Live state must NOT have absorbed the v1 control-channel value;
    // the discard restores defaults instead.
    REQUIRE(getParamRawInt(dst.apvts, pid::inputChannel) == defaultInputC);
    REQUIRE(getParamRawInt(dst.apvts, pid::seed)         == defaultSeed);
}

TEST_CASE("chord (voice-stack): voice that clamps to the base pitch is "
          "still emitted (no unison dedup)",
          "[plugin][chord]")
{
    // inboil / m4l engine semantics: when diatonicShift clamps a voice
    // to the same pitch as the base (input near the top/bottom of the
    // scale, interval pushes past the extreme), the voice is still
    // emitted at that pitch. m4l/host/host.ts:184-192 pushes every voice
    // into the pitches array unconditionally. vst must match — a prior
    // `voicePitch == quantized` skip in PluginProcessor.cpp diverged from
    // the cross-target engine contract and was removed.
    PointsmanProcessor p;
    p.prepareToPlay(44100.0, 256);
    p.setHostIsPlayingForTest(true);

    setParamRaw(p.apvts, pid::scale, 0.0f); // Major
    setParamRaw(p.apvts, pid::root,  0.0f); // C
    setParamRaw(p.apvts, pid::mode,  1.0f); // Chord (post-merge, voice-stack-driven)
    p.setHarmonyVoices({
        {3, HarmonyDirection::Above}, // 3rd above; clamps at top of MIDI range
    });

    // MIDI 127 is the last in-scale C-major pitch (G8); diatonicShift
    // 3rd-above (idx + 2) exceeds scalePitches.size() and returns
    // scalePitches.back() = 127. Without the dedup, the processor emits
    // TWO noteOns at 127 (base + clamped voice).
    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 127, static_cast<juce::uint8>(100)), 0);
    processOnce(p, midi);

    int noteOnsAt127 = 0;
    for (const auto meta : midi)
    {
        const auto m = meta.getMessage();
        if (m.isNoteOn() && m.getNoteNumber() == 127) ++noteOnsAt127;
    }
    REQUIRE(noteOnsAt127 == 2);
}

TEST_CASE("humanize default: noteOff fires at noteOn + first-event sourceStep",
          "[plugin][humanize][gate]")
{
    // ADR 003 Phase 4: output gate length is humanize-driven, not input-
    // noteOff-driven. With default humanize (feel=0), the v2 axis routing
    // collapses every humanize amp to 0 → gateFinal = 1.0, so output gate
    // length = 1.0 × sourceStepDuration.
    //
    // First-event source-step fallback = kFirstEventStepMs = 250 ms
    // (mirrors m4l/host/host.ts FIRST_EVENT_STEP_MS). At 44.1 kHz this is
    // exactly 250 × 44.1 = 11025 samples.
    constexpr double sampleRate          = 44100.0;
    constexpr int    blockSize           = 256;
    constexpr int    kSourceStepSamples  = 11025;
    constexpr int    kBlockOfNoteOff     = kSourceStepSamples / blockSize;       // 43
    constexpr int    kRelSampleOff       = kSourceStepSamples - kBlockOfNoteOff * blockSize; // 17

    PointsmanProcessor p;
    p.prepareToPlay(sampleRate, blockSize);
    p.setHostIsPlayingForTest(true);

    juce::AudioBuffer<float> audio(0, blockSize);

    // Block 0: send noteOn at sample 0. NoteOn fires same block, noteOff
    // is queued for sample 11025 → not in block 0.
    juce::MidiBuffer block0;
    block0.addEvent(juce::MidiMessage::noteOn(1, 60, static_cast<juce::uint8>(100)), 0);
    p.processBlock(audio, block0);

    int onCount = 0, offCount = 0;
    for (const auto meta : block0)
    {
        const auto m = meta.getMessage();
        if (m.isNoteOn())  ++onCount;
        if (m.isNoteOff()) ++offCount;
    }
    REQUIRE(onCount  == 1);
    REQUIRE(offCount == 0);

    // Drive empty blocks until the gate elapses. Blocks 1..42 see no
    // noteOff; block 43 sees the noteOff at sample 17.
    int firedAtRelSample = -1;
    for (int b = 1; b <= kBlockOfNoteOff; ++b)
    {
        juce::MidiBuffer mid;
        p.processBlock(audio, mid);
        for (const auto meta : mid)
        {
            const auto m = meta.getMessage();
            if (m.isNoteOff() && m.getChannel() == 1 && m.getNoteNumber() == 60)
            {
                if (b != kBlockOfNoteOff)
                    FAIL("noteOff fired in block " << b << " before sourceStep elapsed");
                firedAtRelSample = meta.samplePosition;
            }
        }
    }
    REQUIRE(firedAtRelSample == kRelSampleOff);
}

TEST_CASE("humanize: input noteOff does not gate output "
          "(gate-driven only, m4l semantics)",
          "[plugin][humanize][gate]")
{
    // m4l/host/host.ts:222-230 ignores input noteOffs for output gating
    // (only chord-context release matters). vst Phase 4 matches this:
    // input noteOff is silently consumed and the output noteOff continues
    // to fire on its humanize-scheduled sample.
    constexpr double sampleRate = 44100.0;
    constexpr int    blockSize  = 256;

    PointsmanProcessor p;
    p.prepareToPlay(sampleRate, blockSize);
    p.setHostIsPlayingForTest(true);

    juce::AudioBuffer<float> audio(0, blockSize);

    juce::MidiBuffer block0;
    block0.addEvent(juce::MidiMessage::noteOn(1, 60, static_cast<juce::uint8>(100)), 0);
    p.processBlock(audio, block0);
    // Output noteOn fires; output noteOff is queued at absolute sample
    // 11025 (~block 43).

    juce::MidiBuffer block1;
    block1.addEvent(juce::MidiMessage::noteOff(1, 60), 0);
    p.processBlock(audio, block1);

    // Block 1 must contain NO output events: the input noteOff is
    // consumed (m4l semantics), and the humanize-scheduled output
    // noteOff is far in the future.
    bool any = false;
    for (const auto meta : block1) { (void) meta; any = true; }
    REQUIRE_FALSE(any);
}

TEST_CASE("humanize: feel=1 shifts output noteOn within ±0.5 sourceStep "
          "(negative clamps to input sample)",
          "[plugin][humanize][timing]")
{
    // composeHumanize draws raw timing in [-1, +1) and multiplies by 0.5
    // (humanize.cpp:50): timingOffset_ms = rawHalf × sourceStepMs ∈
    // [-125, +125) for first-event sourceStep=250ms. Negative offset
    // clamps to immediate (parity with m4l bridge.ts:313 `delay > 0 ?
    // delay : 0`). Upper bound at 44.1 kHz: 0.5 × 250 ms = 125 ms ≈
    // 5512.5 samples; we assert strict inequality to hold the half-open
    // range.
    //
    // Phase 5 routing: feel feeds all three humanize axes; with feel=1
    // the timing-axis amplitude is 1.0, matching the v1 humanizeTiming=1
    // behaviour exactly.
    constexpr double sampleRate = 44100.0;
    constexpr int    blockSize  = 1024;
    constexpr int    kUpperBoundSamples = 5513;

    PointsmanProcessor p;
    p.prepareToPlay(sampleRate, blockSize);
    p.setHostIsPlayingForTest(true);

    setParamRaw(p.apvts, pid::feel, 1.0f);
    setParamRaw(p.apvts, pid::seed, 0.0f);

    juce::AudioBuffer<float> audio(0, blockSize);

    juce::MidiBuffer block0;
    block0.addEvent(juce::MidiMessage::noteOn(1, 60, static_cast<juce::uint8>(100)), 0);
    p.processBlock(audio, block0);

    int absSampleOfNoteOn = -1;
    for (const auto meta : block0)
    {
        const auto m = meta.getMessage();
        if (m.isNoteOn() && m.getChannel() == 1 && m.getNoteNumber() == 60)
            absSampleOfNoteOn = meta.samplePosition;
    }
    if (absSampleOfNoteOn < 0)
    {
        // Offset pushed it past block 0 → keep advancing until found.
        for (int b = 1; b * blockSize < kUpperBoundSamples + blockSize; ++b)
        {
            juce::MidiBuffer mid;
            p.processBlock(audio, mid);
            for (const auto meta : mid)
            {
                const auto m = meta.getMessage();
                if (m.isNoteOn() && m.getChannel() == 1 && m.getNoteNumber() == 60)
                    absSampleOfNoteOn = meta.samplePosition + b * blockSize;
            }
            if (absSampleOfNoteOn >= 0) break;
        }
    }
    REQUIRE(absSampleOfNoteOn >= 0);
    REQUIRE(absSampleOfNoteOn <  kUpperBoundSamples);
}

TEST_CASE("humanize: source-step duration clamped at kMaxSourceStepMs (5 s)",
          "[plugin][humanize][gate]")
{
    // Defensive bound (ADR 003 §"Post-Phase 4 audit follow-ups" #14).
    // A pathologically slow input rate (multi-second gaps between
    // noteOns) would otherwise schedule a default-gate noteOff that far
    // in the future. Threshold (5 s = 5000 ms): half-note at 24 BPM,
    // well outside any normal play context.
    //
    // Setup: noteOn at t=0, then ~10 s of empty blocks, then a second
    // noteOn. With humanize feel=0, gateFinal = 1.0, so the second
    // noteOff is scheduled at sample (current + sourceStepSamples).
    // Without clamp: ~10 s out → not observable inside a 5.5 s search
    // window. With clamp: ~5 s out → observable.
    constexpr double sampleRate    = 44100.0;
    constexpr int    blockSize     = 4096;
    constexpr int    kGapSamples   = static_cast<int>(10.0 * sampleRate);
    constexpr int    kClampSamples = static_cast<int>(5.0  * sampleRate);

    PointsmanProcessor p;
    p.prepareToPlay(sampleRate, blockSize);
    p.setHostIsPlayingForTest(true);

    juce::AudioBuffer<float> audio(0, blockSize);

    // First noteOn at t=0.
    {
        juce::MidiBuffer m;
        m.addEvent(juce::MidiMessage::noteOn(1, 60, juce::uint8{100}), 0);
        p.processBlock(audio, m);
    }

    // Advance ~10 seconds of empty audio.
    const int kGapBlocks = (kGapSamples + blockSize - 1) / blockSize;
    for (int i = 0; i < kGapBlocks; ++i)
    {
        juce::MidiBuffer m;
        p.processBlock(audio, m);
    }

    // Second noteOn at the start of the next block.
    {
        juce::MidiBuffer m;
        m.addEvent(juce::MidiMessage::noteOn(1, 60, juce::uint8{100}), 0);
        p.processBlock(audio, m);
    }

    // Search forward up to ~5.5 s for the second noteOff. With the
    // clamp it lands ≈ 5 s after the second noteOn; without the clamp
    // it would land ≈ 10 s out and the loop exits before observing it.
    const int kSearchBlocks =
        (kClampSamples + blockSize) / blockSize + 4;
    bool sawSecondNoteOff = false;
    for (int b = 0; b < kSearchBlocks && !sawSecondNoteOff; ++b)
    {
        juce::MidiBuffer m;
        p.processBlock(audio, m);
        for (const auto meta : m)
        {
            const auto msg = meta.getMessage();
            if (msg.isNoteOff() && msg.getNoteNumber() == 60)
                sawSecondNoteOff = true;
        }
    }
    REQUIRE(sawSecondNoteOff);
}

TEST_CASE("pulse: lastEmittedPulse advances and carries the emitted pitch",
          "[plugin][pulse]")
{
    // The processor publishes a one-shot pulse signal to the editor on
    // every output noteOn (Batch 3). The version counter monotonically
    // increases so a UI poller can detect new edges; the pitch / vel /
    // channel are packed alongside so unpacking gives the editor enough
    // to colour the right key.
    PointsmanProcessor p;
    p.prepareToPlay(44100.0, 256);
    p.setHostIsPlayingForTest(true);

    const uint64_t before        = p.getLastEmittedPulseForTest();
    const uint32_t versionBefore =
        PointsmanProcessor::unpackPulseVersion(before);

    juce::MidiBuffer midi;
    // Default scale = major / root = 0 → MIDI 60 (C4) is in scale and
    // passes through pitch-unchanged. velocity 100 is in [1, 127].
    midi.addEvent(juce::MidiMessage::noteOn(1, 60, static_cast<juce::uint8>(100)), 0);
    processOnce(p, midi);

    const uint64_t after        = p.getLastEmittedPulseForTest();
    const uint32_t versionAfter =
        PointsmanProcessor::unpackPulseVersion(after);

    REQUIRE(versionAfter > versionBefore);
    REQUIRE(PointsmanProcessor::unpackPulsePitch(after)    == 60);
    REQUIRE(PointsmanProcessor::unpackPulseVelocity(after) == 100);
    REQUIRE(PointsmanProcessor::unpackPulseChannel(after)  == 1);
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
