// Tests for the Pointsman APVTS / processor surface per ADR 003 Phase 5
// (parameter surface v2) + ADR 004 Phase 2 (chord shape primitive +
// schema v3 break + arp parameter surface). Covers APVTS round-trip,
// chord-mode intervallic expansion (concept.md §"Chord and harmony
// modes"; ADR 004 §"Chord shape primitive"), arp params + groove
// pattern (accent / slide) ValueTree round-trip, panic on transport
// stop, random-seed init, legacy (v1, v2) state discard.
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
          "[plugin][apvts][adr004]")
{
    PointsmanProcessor src;
    src.prepareToPlay(44100.0, 256);

    // Mutate every native pid to a non-default value. Choices use indices
    // matched to the ADR §"Parameter persistence" table; Ints / Floats use
    // mid-range values that cannot collide with the constructor defaults.
    setParamRaw(src.apvts, pid::scale,        7.0f);  // Pentatonic
    setParamRaw(src.apvts, pid::root,         5.0f);
    setParamRaw(src.apvts, pid::mode,         2.0f);  // Arp (ADR 004)
    setParamRaw(src.apvts, pid::feel,         0.42f);
    setParamRaw(src.apvts, pid::drift,        0.95f);
    setParamRaw(src.apvts, pid::inputChannel, 3.0f);
    // Test seed value chosen below 2^24 so it is exactly representable as
    // float32 — APVTS stores parameter values as float32, so any test value
    // above 2^24 would lose bits in the legitimate save → reopen path.
    // (Parameter range itself is also clamped to [0, 0xffffff] for the same
    // reason — see Parameters.cpp.)
    setParamRaw(src.apvts, pid::seed,         12345678.0f);
    // ADR 004 pids (schema v3).
    setParamRaw(src.apvts, pid::chordShape,    8.0f);   // Min7
    setParamRaw(src.apvts, pid::arpPattern,    2.0f);   // UpDown
    setParamRaw(src.apvts, pid::arpRate,       6.0f);   // 1/16 (default; pick non-default below)
    setParamRaw(src.apvts, pid::arpRate,       9.0f);   // 1/32
    setParamRaw(src.apvts, pid::arpOctaves,    3.0f);
    setParamRaw(src.apvts, pid::arpStepRepeats, 4.0f);
    setParamRaw(src.apvts, pid::arpGate,       0.75f);
    setParamRaw(src.apvts, pid::arpVariation,  0.40f);
    setParamRaw(src.apvts, pid::arpLatch,      1.0f);
    setParamRaw(src.apvts, pid::arpSwing,      0.55f);

    juce::MemoryBlock blob;
    src.getStateInformation(blob);

    PointsmanProcessor dst;
    dst.setStateInformation(blob.getData(), static_cast<int>(blob.getSize()));

    REQUIRE(getParamRawInt(dst.apvts,   pid::scale)         == 7);
    REQUIRE(getParamRawInt(dst.apvts,   pid::root)          == 5);
    REQUIRE(getParamRawInt(dst.apvts,   pid::mode)          == 2);
    REQUIRE(getParamRawFloat(dst.apvts, pid::feel)          == 0.42f);
    REQUIRE(getParamRawFloat(dst.apvts, pid::drift)         == 0.95f);
    REQUIRE(getParamRawInt(dst.apvts,   pid::inputChannel)  == 3);
    REQUIRE(getParamRawInt(dst.apvts,   pid::seed)          == 12345678);
    REQUIRE(getParamRawInt(dst.apvts,   pid::chordShape)    == 8);
    REQUIRE(getParamRawInt(dst.apvts,   pid::arpPattern)    == 2);
    REQUIRE(getParamRawInt(dst.apvts,   pid::arpRate)       == 9);
    REQUIRE(getParamRawInt(dst.apvts,   pid::arpOctaves)    == 3);
    REQUIRE(getParamRawInt(dst.apvts,   pid::arpStepRepeats) == 4);
    REQUIRE(getParamRawFloat(dst.apvts, pid::arpGate)       == 0.75f);
    REQUIRE(getParamRawFloat(dst.apvts, pid::arpVariation)  == 0.40f);
    REQUIRE(getParamRawInt(dst.apvts,   pid::arpLatch)      == 1);
    REQUIRE(getParamRawFloat(dst.apvts, pid::arpSwing)      == 0.55f);
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

// ADR 004 Phase 2: harmonyVoices ValueTree round-trip removed — chord
// expansion now goes through `chordShape` (intervallic). The in-memory
// setHarmonyVoices / getHarmonyVoices stub remains as a vestige API the
// editor's HARMONY group still pokes at (Phase 4 deletes both); see the
// "schema v2 → v3 discard" test below for the persistence side.

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

// ADR 004 Phase 2: harmonyVoices preset-clamp-on-load and out-of-range
// clamp and empty-round-trip tests removed — schema v3 no longer carries
// HarmonyVoice children, so the load path no longer ingests them. v2
// state with HarmonyVoice children is detected and discarded by the
// "schema v2 → v3 discard" test further down.

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

TEST_CASE("chord mode: default chordShape=Maj expands C4 to major triad "
          "(1 in, 3 out)",
          "[plugin][chord][adr004]")
{
    // ADR 004: chord mode is 1-in-N-out chord expansion driven by the
    // `chordShape` enum. Default chordShape = Maj = [0, 4, 7].
    // Input C4 (MIDI 60) in mode=chord → {60, 64, 67} (C major triad).
    // No scale dependency on the chord voices — see "intervallic, not
    // diatonic" test below.
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

TEST_CASE("chord mode: intervallic semantics — chordShape is applied "
          "from the input root regardless of scale degree",
          "[plugin][chord][adr004]")
{
    // ADR 004 §"Chord shape primitive": intervals are absolute semitones
    // from the snapped root, NOT scale degrees. D4 (62) in C major with
    // chordShape=Maj → {62, 66, 69} (D major triad: D-F#-A), NOT
    // {62, 65, 69} (ii diatonic D-F-A). The F# is out of C major; the
    // chord emits it deliberately — borrowed-chord material is the
    // chord-voicing freedom this design buys.
    PointsmanProcessor p;
    p.prepareToPlay(44100.0, 256);
    p.setHostIsPlayingForTest(true);
    setParamRaw(p.apvts, pid::scale,      0.0f); // Major
    setParamRaw(p.apvts, pid::root,       0.0f); // C
    setParamRaw(p.apvts, pid::mode,       1.0f); // chord
    setParamRaw(p.apvts, pid::chordShape, 0.0f); // Maj

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
    REQUIRE(emittedPitches == std::vector<int>{62, 66, 69});
}

TEST_CASE("chord mode: out-of-scale input is snapped to scale before "
          "the chord shape is applied",
          "[plugin][chord][adr004]")
{
    // C# (61) in C major snaps to nearest scale degree first (60 = C,
    // tie-to-lower from {60, 62}), then chordShape=Maj expansion →
    // {60, 64, 67}.
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

TEST_CASE("inputChannel: non-matching channel passes through untouched "
          "(MPE per-note channel carry)",
          "[plugin][routing]")
{
    // With IN CH set to a master channel (e.g. 1), MPE per-note channels
    // 2..15 still carry pitch bend / pressure / timbre to the downstream
    // MPE instrument. Pointsman must NOT drop them — pass-through is
    // the load-bearing semantic here (concept.md §"Input handling").
    PointsmanProcessor p;
    p.prepareToPlay(44100.0, 256);
    p.setHostIsPlayingForTest(true);

    setParamRaw(p.apvts, pid::inputChannel, 1.0f);
    setParamRaw(p.apvts, pid::mode,         1.0f);  // chord

    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(5, 60, juce::uint8{100}), 0);
    processOnce(p, midi);

    // Channel 5 noteOn (NOT matching IN CH = 1) must reach output
    // unchanged.
    bool sawNonMatchingNoteOn = false;
    for (const auto meta : midi)
    {
        const auto m = meta.getMessage();
        if (m.isNoteOn() && m.getChannel() == 5 && m.getNoteNumber() == 60)
            sawNonMatchingNoteOn = true;
    }
    REQUIRE(sawNonMatchingNoteOn);
}

TEST_CASE("inputChannel: matching channel produces chord-expansion output",
          "[plugin][routing]")
{
    // Counter-test for the pass-through test above: when channel DOES
    // match IN CH, chord mode produces its 3-note triad as usual.
    PointsmanProcessor p;
    p.prepareToPlay(44100.0, 256);
    p.setHostIsPlayingForTest(true);

    setParamRaw(p.apvts, pid::inputChannel, 5.0f);
    setParamRaw(p.apvts, pid::mode,         1.0f);

    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(5, 60, juce::uint8{100}), 0);
    processOnce(p, midi);

    int noteOns = 0;
    for (const auto meta : midi)
        if (meta.getMessage().isNoteOn()) ++noteOns;
    REQUIRE(noteOns == 3);
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

TEST_CASE("setStateInformation: legacy state (v1 removed pid) is discarded; "
          "defaults are restored",
          "[plugin][state][legacy]")
{
    // ADR 003 Phase 5: hard v1→v2 break (no migrator). ADR 004 Phase 2:
    // additional hard v2→v3 break (no migrator). A legacy state tree —
    // either v1 (any removed pid present, e.g. controlChannel) or v2
    // (PointsmanState.version="2" or HarmonyVoice children present) —
    // is silently discarded and the processor falls back to default-
    // constructed v3 params.
    //
    // This case covers v1; the next case covers v2.

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

TEST_CASE("setStateInformation: schema v2 state (PointsmanState.version=\"2\" "
          "+ HarmonyVoice children) is discarded; live v3 defaults survive",
          "[plugin][state][legacy][adr004]")
{
    // ADR 004 Phase 2: schema v2 → v3 hard break, no migrator. v2 is
    // detected by the PointsmanState.version property; HarmonyVoice
    // children alone do NOT trigger discard because v3 also mirrors
    // them (vestige editor wiring, see syncHarmonyVoicesToTree). On
    // discard, the live state is preserved untouched — the v2 file's
    // values are silently dropped, leaving whatever the host had loaded
    // at construction time.
    PointsmanProcessor dst;
    const int defaultChordShape = getParamRawInt(dst.apvts, pid::chordShape);
    const int defaultInputC     = getParamRawInt(dst.apvts, pid::inputChannel);

    struct Exposer : public PointsmanProcessor
    { using AudioProcessor::copyXmlToBinary; };

    juce::ValueTree v2State { dst.apvts.state.getType() };
    {
        // v2 tree carries a non-default chordShape would-be value via
        // a PARAM child, plus the legacy PointsmanState.version=2
        // marker that triggers the discard.
        juce::ValueTree param { juce::Identifier("PARAM") };
        param.setProperty(juce::Identifier("id"),    "chordShape", nullptr);
        param.setProperty(juce::Identifier("value"), 5.0f, nullptr); // Sus4
        v2State.appendChild(param, nullptr);

        juce::ValueTree paramInCh { juce::Identifier("PARAM") };
        paramInCh.setProperty(juce::Identifier("id"),    "inputChannel", nullptr);
        paramInCh.setProperty(juce::Identifier("value"), 4.0f, nullptr);
        v2State.appendChild(paramInCh, nullptr);

        juce::ValueTree ps { juce::Identifier("PointsmanState") };
        ps.setProperty(juce::Identifier("version"), 2, nullptr);
        juce::ValueTree hv { juce::Identifier("HarmonyVoice") };
        hv.setProperty(juce::Identifier("interval"),  3,                nullptr);
        hv.setProperty(juce::Identifier("direction"), juce::String("above"), nullptr);
        ps.appendChild(hv, nullptr);
        v2State.appendChild(ps, nullptr);
    }
    auto xml = v2State.createXml();
    REQUIRE(xml != nullptr);
    juce::MemoryBlock blob;
    Exposer::copyXmlToBinary(*xml, blob);

    dst.setStateInformation(blob.getData(), static_cast<int>(blob.getSize()));

    // Discard kicked in (version=2 marker), so the v2 file's values
    // for chordShape (5) and inputChannel (4) did NOT overwrite the
    // live state. The processor retains its construction-time defaults.
    REQUIRE(getParamRawInt(dst.apvts, pid::inputChannel) == defaultInputC);
    REQUIRE(getParamRawInt(dst.apvts, pid::chordShape)   == defaultChordShape);
}

TEST_CASE("chord mode: voices that exceed MIDI 127 are dropped, not clamped",
          "[plugin][chord][adr004]")
{
    // ADR 004 §"Chord shape primitive": voices that would exceed [0, 127]
    // are dropped (not clamped, not wrapped). MIDI 127 with chordShape=Maj
    // would produce [127, 131, 134]; the 131 and 134 are dropped, leaving
    // only [127]. This differs from the v0.1 diatonicShift behaviour which
    // clamped to scalePitches.back() and produced duplicate-at-127 voices.
    PointsmanProcessor p;
    p.prepareToPlay(44100.0, 256);
    p.setHostIsPlayingForTest(true);
    setParamRaw(p.apvts, pid::scale,      0.0f); // Major
    setParamRaw(p.apvts, pid::root,       0.0f); // C
    setParamRaw(p.apvts, pid::mode,       1.0f); // chord
    setParamRaw(p.apvts, pid::chordShape, 0.0f); // Maj

    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 127, static_cast<juce::uint8>(100)), 0);
    processOnce(p, midi);

    std::vector<int> emittedPitches;
    for (const auto meta : midi)
    {
        const auto m = meta.getMessage();
        if (m.isNoteOn()) emittedPitches.push_back(m.getNoteNumber());
    }
    // Only the root (127) survives; the +4 and +7 voices are out of range
    // and silently dropped.
    REQUIRE(emittedPitches == std::vector<int>{127});
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

TEST_CASE("scheduler overflow: pathological input rate stays alive and bounded",
          "[plugin][rt-safety]")
{
    // Audio-thread RT-safety: pending_ / sounding_ are reserved at
    // kMaxPending / kMaxSounding in prepareToPlay; the noteOn handler
    // drops new emits if pushing the pair would exceed kMaxPending so
    // the vector never reallocates on the audio thread under
    // pathological input loads. This test stresses the path: 4× more
    // noteOns than the cap can hold (chord mode emits 4 events per
    // input × 1024 input noteOns ≈ 8192 entries) while sustaining a
    // long gate so noteOffs never fire and pending fills.
    //
    // Pass condition: no crash / no UB, and the host receives at least
    // some output (the drop semantics are graceful, not "drop
    // everything").
    PointsmanProcessor p;
    p.prepareToPlay(44100.0, 256);
    p.setHostIsPlayingForTest(true);

    // Chord mode → 4 emits per input (1 quantized + 3 harmony voices
    // when the default 2-voice triad is extended). Default voices = 2,
    // so 3 emits per input — still well above the immediate-fire path.
    setParamRaw(p.apvts, pid::mode,
                static_cast<float>(ModeChoice::Chord));

    // Stack many noteOns into a single block. The block-internal
    // ordering still fires immediate noteOns within the same drain,
    // but the noteOffs (gateLen × sourceStep ahead) remain pending,
    // pushing pending_.size() past the reserved cap. With the V3
    // guard the excess noteOns are silently dropped.
    juce::MidiBuffer midi;
    for (int i = 0; i < 1024; ++i)
    {
        const int pitch = 36 + (i % 36);
        midi.addEvent(juce::MidiMessage::noteOn(1, pitch,
                                                static_cast<juce::uint8>(80)),
                      i % 256);
    }

    // Must not crash, must not allocate beyond the cap (verified
    // implicitly: heap allocation on the audio thread would not
    // crash but would defeat the RT-safety contract; the cap guard
    // makes a realloc impossible here).
    REQUIRE_NOTHROW(processOnce(p, midi));
    // Some output reached the host — the dropper does not silence
    // everything.
    REQUIRE(midi.getNumEvents() > 0);
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

// =====================================================================
// ADR 004 Phase 2 — chord shape per-preset coverage, arp param surface,
// arpGroovePattern ValueTree round-trip, mode=Arp placeholder.
// =====================================================================

namespace
{
    // Run a single noteOn through chord mode with the given chordShape
    // and return the sorted set of emitted pitches.
    std::vector<int> chordModeEmit(int rootMidi, int chordShapeIdx)
    {
        PointsmanProcessor p;
        p.prepareToPlay(44100.0, 256);
        p.setHostIsPlayingForTest(true);
        setParamRaw(p.apvts, pid::scale,      0.0f);
        setParamRaw(p.apvts, pid::root,       0.0f);
        setParamRaw(p.apvts, pid::mode,       1.0f);                // chord
        setParamRaw(p.apvts, pid::chordShape, (float) chordShapeIdx);

        juce::MidiBuffer midi;
        midi.addEvent(juce::MidiMessage::noteOn(1, rootMidi,
                                                static_cast<juce::uint8>(100)),
                      0);
        juce::AudioBuffer<float> audio(0, 256);
        p.processBlock(audio, midi);

        std::vector<int> pitches;
        for (const auto meta : midi)
        {
            const auto m = meta.getMessage();
            if (m.isNoteOn()) pitches.push_back(m.getNoteNumber());
        }
        std::sort(pitches.begin(), pitches.end());
        return pitches;
    }
}

TEST_CASE("chord mode: chordShape presets emit the documented intervallic "
          "voices from a C4 root",
          "[plugin][chord][adr004]")
{
    // Coverage of the canonical preset table (ADR 004 §"Chord shape
    // primitive"). C4 = MIDI 60. Each row asserts the full voice set
    // produced by chord mode with the given chordShape index.
    REQUIRE(chordModeEmit(60,  0) == std::vector<int>{60, 64, 67});       // Maj
    REQUIRE(chordModeEmit(60,  1) == std::vector<int>{60, 63, 67});       // Min
    REQUIRE(chordModeEmit(60,  6) == std::vector<int>{60, 67});           // Power
    REQUIRE(chordModeEmit(60,  7) == std::vector<int>{60, 64, 67, 71});   // Maj7
    REQUIRE(chordModeEmit(60,  8) == std::vector<int>{60, 63, 67, 70});   // Min7
    REQUIRE(chordModeEmit(60,  9) == std::vector<int>{60, 64, 67, 70});   // Dom7
    REQUIRE(chordModeEmit(60, 11) == std::vector<int>{60, 63, 66, 69});   // Dim7
    REQUIRE(chordModeEmit(60, 18) == std::vector<int>{60, 64, 67, 70, 74, 81}); // Dom13
    REQUIRE(chordModeEmit(60, 19) == std::vector<int>{60, 72});           // Octave
}

TEST_CASE("chord mode: 4-voice chordShape (Maj7) produces 4 noteOns per input",
          "[plugin][chord][adr004]")
{
    // Counter-test: chord-shape voice count is preset-dependent, not
    // fixed at 3 like the v0.1 default triad. Maj7 has 4 voices.
    PointsmanProcessor p;
    p.prepareToPlay(44100.0, 256);
    p.setHostIsPlayingForTest(true);
    setParamRaw(p.apvts, pid::mode,       1.0f); // chord
    setParamRaw(p.apvts, pid::chordShape, 7.0f); // Maj7

    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 60, juce::uint8{100}), 0);
    processOnce(p, midi);

    int noteOns = 0;
    for (const auto meta : midi)
        if (meta.getMessage().isNoteOn()) ++noteOns;
    REQUIRE(noteOns == 4);
}

TEST_CASE("mode=Arp: first block of play emits one pool voice at tick 0",
          "[plugin][arp][adr004]")
{
    // ADR 004 Phase 2-B: in mode=Arp, a held C4 + chordShape=Maj builds
    // a pool of [60, 64, 67]; the default arpPattern=Up emits the
    // pool's first voice at tick 0. Because the default 1/16 rate at
    // 120 BPM × 44.1 kHz = 5512.5 samples per tick and the test block
    // is only 256 samples, only the first tick fires in this block.
    PointsmanProcessor p;
    p.prepareToPlay(44100.0, 256);
    p.setHostIsPlayingForTest(true);
    p.setBpmForTest(120.0);
    setParamRaw(p.apvts, pid::mode,       2.0f); // Arp
    setParamRaw(p.apvts, pid::chordShape, 0.0f); // Maj

    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 60, juce::uint8{100}), 0);
    processOnce(p, midi);

    std::vector<int> noteOnPitches;
    for (const auto meta : midi)
    {
        const auto m = meta.getMessage();
        if (m.isNoteOn()) noteOnPitches.push_back(m.getNoteNumber());
    }
    REQUIRE(noteOnPitches.size() == 1);
    REQUIRE(noteOnPitches[0] == 60); // first voice of pool {60, 64, 67}
}

TEST_CASE("arpGroovePattern: default state has all-100 accent and all-off slide",
          "[plugin][arp][adr004]")
{
    // ADR 004 §"Persistence": "A schema-v3 state missing arpGroovePattern
    // (e.g. a partial-schema-v3 preset) loads the default all-100 accent /
    // all-off slide pattern." New-instance defaults match this so the
    // out-of-the-box arp produces a flat groove (v0.1-equivalent
    // velocity profile, no ties).
    PointsmanProcessor p;
    const auto accent = p.getArpAccent();
    const auto slide  = p.getArpSlide();
    REQUIRE(accent.size() == 16);
    REQUIRE(slide.size()  == 16);
    for (int i = 0; i < 16; ++i)
    {
        REQUIRE(accent[(std::size_t) i] == 100);
        REQUIRE(slide[(std::size_t) i] == false);
    }
}

TEST_CASE("arpGroovePattern: ValueTree round-trip preserves all 32 cells",
          "[plugin][arp][adr004][persistence]")
{
    // 16-step accent and slide patterns round-trip through getState /
    // setState bit-exact. ADR 004 §"Persistence" pins these as a
    // sibling ValueTree child (arpGroovePattern) rather than 32
    // automatable APVTS pids.
    PointsmanProcessor src;
    pointsman::ArpAccentTable accent{};
    pointsman::ArpSlideTable  slide{};
    for (int i = 0; i < 16; ++i)
    {
        accent[(std::size_t) i] = (i * 8 + 7) & 0x7f; // 7, 15, 23, ..., 127
        slide[(std::size_t) i]  = (i % 3) == 0;       // every third step
    }
    src.setArpAccent(accent);
    src.setArpSlide(slide);

    juce::MemoryBlock blob;
    src.getStateInformation(blob);

    PointsmanProcessor dst;
    dst.setStateInformation(blob.getData(), static_cast<int>(blob.getSize()));

    const auto loadedAccent = dst.getArpAccent();
    const auto loadedSlide  = dst.getArpSlide();
    REQUIRE(loadedAccent == accent);
    REQUIRE(loadedSlide  == slide);
}

TEST_CASE("arpGroovePattern: setArpAccent clamps each cell to [0, 127]",
          "[plugin][arp][adr004]")
{
    // Defensive bound at the in-memory setter. The accent values
    // ultimately become MIDI velocity bytes; out-of-range input from
    // a corrupt preset or hand-edited XML must clamp to 0..127 rather
    // than wrap or trigger UB downstream.
    PointsmanProcessor p;
    pointsman::ArpAccentTable raw{};
    for (int i = 0; i < 16; ++i) raw[(std::size_t) i] = -10 + i * 30;
    p.setArpAccent(raw);
    const auto clamped = p.getArpAccent();
    for (int i = 0; i < 16; ++i)
    {
        REQUIRE(clamped[(std::size_t) i] >= 0);
        REQUIRE(clamped[(std::size_t) i] <= 127);
    }
    // First two raw entries underflow (-10, 20) — should clamp to 0 and 20.
    REQUIRE(clamped[0] == 0);
    REQUIRE(clamped[1] == 20);
}

// =====================================================================
// ADR 004 Phase 2-B arp clock — pool traversal, octaves, step repeats,
// groove (accent / slide / swing), latch, chordShape rebuild, mode switch.
// =====================================================================

namespace
{
    // Convenience: collect every noteOn pitch the block emitted, in
    // sample-position order (so traversal patterns can be asserted as a
    // sequence, not just a set).
    std::vector<int> collectNoteOnPitchesInOrder(const juce::MidiBuffer& midi)
    {
        std::vector<std::pair<int,int>> pairs; // (sample, pitch)
        for (const auto meta : midi)
        {
            const auto m = meta.getMessage();
            if (m.isNoteOn())
                pairs.emplace_back(meta.samplePosition, m.getNoteNumber());
        }
        std::sort(pairs.begin(), pairs.end(),
            [](const auto& a, const auto& b){ return a.first < b.first; });
        std::vector<int> pitches;
        pitches.reserve(pairs.size());
        for (const auto& kv : pairs) pitches.push_back(kv.second);
        return pitches;
    }

    // Default-tuned arp processor: 120 BPM at 44.1 kHz makes a 1/16
    // step = 5512.5 samples; blockSize 22050 fits 4 ticks per block.
    // PointsmanProcessor is non-copyable so the helper mutates an
    // existing instance in place.
    void configureArpProcessor(PointsmanProcessor& p,
                               int blockSize = 22050,
                               int chordShapeIdx = 0)
    {
        p.prepareToPlay(44100.0, blockSize);
        p.setHostIsPlayingForTest(true);
        p.setBpmForTest(120.0);
        setParamRaw(p.apvts, pid::scale,      0.0f);  // Major
        setParamRaw(p.apvts, pid::root,       0.0f);  // C
        setParamRaw(p.apvts, pid::mode,       2.0f);  // Arp
        setParamRaw(p.apvts, pid::chordShape, (float) chordShapeIdx);
    }

    void pressNote(juce::MidiBuffer& midi, int pitch, int sample = 0,
                   int channel = 1, int velocity = 100)
    {
        midi.addEvent(juce::MidiMessage::noteOn(
            channel, pitch, static_cast<juce::uint8>(velocity)), sample);
    }

    void releaseNote(juce::MidiBuffer& midi, int pitch, int sample = 0,
                     int channel = 1)
    {
        midi.addEvent(juce::MidiMessage::noteOff(channel, pitch), sample);
    }
}

TEST_CASE("arp: pattern=Up traverses the pool ascending across ticks",
          "[plugin][arp][adr004]")
{
    // BPM=120 / 1/16 / 44.1 kHz → 5512.5 samples/tick; blockSize 22050
    // captures 4 ticks. Pool = [60, 64, 67]; Up emits 60, 64, 67, 60,
    // wrapping after one full cycle.
    PointsmanProcessor p; configureArpProcessor(p, 22050);
    juce::MidiBuffer midi;
    pressNote(midi, 60);
    juce::AudioBuffer<float> audio(0, 22050);
    p.processBlock(audio, midi);

    const auto pitches = collectNoteOnPitchesInOrder(midi);
    REQUIRE(pitches.size() == 4);
    REQUIRE(pitches[0] == 60);
    REQUIRE(pitches[1] == 64);
    REQUIRE(pitches[2] == 67);
    REQUIRE(pitches[3] == 60);
}

TEST_CASE("arp: pattern=Down traverses the pool descending",
          "[plugin][arp][adr004]")
{
    PointsmanProcessor p; configureArpProcessor(p, 22050);
    setParamRaw(p.apvts, pid::arpPattern, 1.0f); // Down

    juce::MidiBuffer midi;
    pressNote(midi, 60);
    juce::AudioBuffer<float> audio(0, 22050);
    p.processBlock(audio, midi);

    // Down starts at the LAST pool index (initial state.index = 0 →
    // ArpState{0,0,0,1}; nextArpIndex advances 0 → -1 → wraps to N-1).
    // Engine convention: first emission uses state.index = 0 = first
    // pool entry. For Down pattern, that means the bottom note fires
    // first, then we descend by wrap-around (60 → 67 → 64 → 60).
    const auto pitches = collectNoteOnPitchesInOrder(midi);
    REQUIRE(pitches.size() == 4);
    REQUIRE(pitches[0] == 60);  // initial index = 0 = pool[0]
    REQUIRE(pitches[1] == 67);  // wrapped to pool[N-1]
    REQUIRE(pitches[2] == 64);
    REQUIRE(pitches[3] == 60);
}

TEST_CASE("arp: pattern=Strike emits every pool voice per tick",
          "[plugin][arp][adr004]")
{
    PointsmanProcessor p; configureArpProcessor(p, 22050);
    setParamRaw(p.apvts, pid::arpPattern, 5.0f); // Strike

    juce::MidiBuffer midi;
    pressNote(midi, 60);
    juce::AudioBuffer<float> audio(0, 22050);
    p.processBlock(audio, midi);

    // 4 ticks × 3 voices = 12 noteOns; per-tick pitches all simultaneous.
    int noteOns = 0;
    for (const auto meta : midi)
        if (meta.getMessage().isNoteOn()) ++noteOns;
    REQUIRE(noteOns == 12);
}

TEST_CASE("arp: arpOctaves=2 plays the pool, then the same pool +12 semitones",
          "[plugin][arp][adr004]")
{
    PointsmanProcessor p; configureArpProcessor(p, 44100); // 8 ticks
    setParamRaw(p.apvts, pid::arpOctaves, 2.0f);

    juce::MidiBuffer midi;
    pressNote(midi, 60);
    juce::AudioBuffer<float> audio(0, 44100);
    p.processBlock(audio, midi);

    // 6 ticks (3 × 2 octaves) per full cycle, then wraps.
    // Expected sequence: 60, 64, 67, 72, 76, 79, 60, 64...
    const auto pitches = collectNoteOnPitchesInOrder(midi);
    REQUIRE(pitches.size() >= 6);
    REQUIRE(pitches[0] == 60);
    REQUIRE(pitches[1] == 64);
    REQUIRE(pitches[2] == 67);
    REQUIRE(pitches[3] == 72);
    REQUIRE(pitches[4] == 76);
    REQUIRE(pitches[5] == 79);
}

TEST_CASE("arp: arpStepRepeats=2 emits each voice twice before advancing",
          "[plugin][arp][adr004]")
{
    PointsmanProcessor p; configureArpProcessor(p, 33075); // 6 ticks
    setParamRaw(p.apvts, pid::arpStepRepeats, 2.0f);

    juce::MidiBuffer midi;
    pressNote(midi, 60);
    juce::AudioBuffer<float> audio(0, 33075);
    p.processBlock(audio, midi);

    // Pool [60, 64, 67] × stepRepeats=2: 60, 60, 64, 64, 67, 67
    const auto pitches = collectNoteOnPitchesInOrder(midi);
    REQUIRE(pitches.size() == 6);
    REQUIRE(pitches == std::vector<int>{60, 60, 64, 64, 67, 67});
}

TEST_CASE("arp: arpAccent[i mod 16] overrides per-step noteOn velocity",
          "[plugin][arp][adr004]")
{
    PointsmanProcessor p; configureArpProcessor(p, 22050);

    // Custom accent: step 0 = 127, step 1 = 40, step 2 = 80, others = 100.
    pointsman::ArpAccentTable accent{};
    for (int i = 0; i < 16; ++i) accent[(std::size_t) i] = 100;
    accent[0] = 127;
    accent[1] = 40;
    accent[2] = 80;
    p.setArpAccent(accent);

    juce::MidiBuffer midi;
    pressNote(midi, 60);
    juce::AudioBuffer<float> audio(0, 22050);
    p.processBlock(audio, midi);

    // Collect (sample, vel) pairs of noteOns to verify ordering + velocity.
    std::vector<std::pair<int,int>> events;
    for (const auto meta : midi)
    {
        const auto m = meta.getMessage();
        if (m.isNoteOn()) events.emplace_back(meta.samplePosition, m.getVelocity());
    }
    std::sort(events.begin(), events.end());
    REQUIRE(events.size() == 4);
    REQUIRE(events[0].second == 127); // tick 0
    REQUIRE(events[1].second == 40);  // tick 1
    REQUIRE(events[2].second == 80);  // tick 2
    REQUIRE(events[3].second == 100); // tick 3
}

TEST_CASE("arp: arpSlide ties the noteOff to the next tick's noteOn sample",
          "[plugin][arp][adr004]")
{
    PointsmanProcessor p; configureArpProcessor(p, 22050);

    // Slide on step 0 only.
    pointsman::ArpSlideTable slide{};
    for (int i = 0; i < 16; ++i) slide[(std::size_t) i] = false;
    slide[0] = true;
    p.setArpSlide(slide);

    juce::MidiBuffer midi;
    pressNote(midi, 60);
    juce::AudioBuffer<float> audio(0, 22050);
    p.processBlock(audio, midi);

    // Find tick 0's noteOn (pitch 60) and its noteOff.
    int noteOnSample = -1, noteOffSample = -1;
    int tick1NoteOnSample = -1;
    for (const auto meta : midi)
    {
        const auto m = meta.getMessage();
        if (m.isNoteOn() && m.getNoteNumber() == 60 && noteOnSample < 0)
            noteOnSample = meta.samplePosition;
        else if (m.isNoteOff() && m.getNoteNumber() == 60 && noteOffSample < 0)
            noteOffSample = meta.samplePosition;
        else if (m.isNoteOn() && m.getNoteNumber() == 64 && tick1NoteOnSample < 0)
            tick1NoteOnSample = meta.samplePosition;
    }
    REQUIRE(noteOnSample == 0);
    REQUIRE(tick1NoteOnSample > 0);
    // Slide-tied noteOff fires exactly at the next tick's noteOn sample.
    REQUIRE(noteOffSample == tick1NoteOnSample);
}

TEST_CASE("arp: arpLatch off + all keys released → pool clears, ticks stop",
          "[plugin][arp][adr004]")
{
    PointsmanProcessor p; configureArpProcessor(p, 22050);

    // Block 1: hold C — first tick fires.
    {
        juce::MidiBuffer midi;
        pressNote(midi, 60);
        juce::AudioBuffer<float> audio(0, 22050);
        p.processBlock(audio, midi);
        REQUIRE(p.getArpPoolSizeForTest() == 3);
    }

    // Block 2: release C — pool empties (latch is off), no further ticks.
    {
        juce::MidiBuffer midi;
        releaseNote(midi, 60);
        juce::AudioBuffer<float> audio(0, 22050);
        p.processBlock(audio, midi);
        REQUIRE(p.getArpPoolSizeForTest() == 0);
        int noteOns = 0;
        for (const auto meta : midi)
            if (meta.getMessage().isNoteOn()) ++noteOns;
        REQUIRE(noteOns == 0);
    }
}

TEST_CASE("arp: arpLatch on retains the pool past all-released",
          "[plugin][arp][adr004]")
{
    PointsmanProcessor p; configureArpProcessor(p, 22050);
    setParamRaw(p.apvts, pid::arpLatch, 1.0f);

    // Block 1: hold + release C in the same block (latch keeps pool).
    juce::MidiBuffer midi1;
    pressNote(midi1, 60, /*sample*/0);
    releaseNote(midi1, 60, /*sample*/100);
    juce::AudioBuffer<float> audio(0, 22050);
    p.processBlock(audio, midi1);
    REQUIRE(p.getArpPoolSizeForTest() == 3); // pool stays under latch

    // Block 2: no input — ticks continue from latched pool.
    juce::MidiBuffer midi2;
    p.processBlock(audio, midi2);
    int noteOns = 0;
    for (const auto meta : midi2)
        if (meta.getMessage().isNoteOn()) ++noteOns;
    REQUIRE(noteOns >= 3); // multiple ticks from the latched pool
}

TEST_CASE("arp: chordShape change mid-hold rebuilds the pool",
          "[plugin][arp][adr004]")
{
    PointsmanProcessor p; configureArpProcessor(p, 22050, /*chordShape*/ 0); // Maj

    // Block 1: build pool with Maj triad.
    juce::MidiBuffer midi1;
    pressNote(midi1, 60);
    juce::AudioBuffer<float> audio(0, 22050);
    p.processBlock(audio, midi1);
    REQUIRE(p.getArpPoolSizeForTest() == 3);

    // Block 2: switch to Min7 — rebuild expected, pool grows to 4.
    setParamRaw(p.apvts, pid::chordShape, 8.0f); // Min7
    juce::MidiBuffer midi2;
    p.processBlock(audio, midi2);
    REQUIRE(p.getArpPoolSizeForTest() == 4); // pool rebuilt with Min7
}

TEST_CASE("arp: switching mode away from Arp emits panic and clears the pool",
          "[plugin][arp][adr004]")
{
    PointsmanProcessor p; configureArpProcessor(p, 22050);

    // Block 1: build a pool + emit a tick.
    juce::MidiBuffer midi1;
    pressNote(midi1, 60);
    juce::AudioBuffer<float> audio(0, 22050);
    p.processBlock(audio, midi1);
    REQUIRE(p.getArpPoolSizeForTest() == 3);

    // Block 2: switch to Chord mode — panic flushes sounding voices,
    // pool empties.
    setParamRaw(p.apvts, pid::mode, 1.0f); // Chord
    juce::MidiBuffer midi2;
    p.processBlock(audio, midi2);
    REQUIRE(p.getArpPoolSizeForTest() == 0);
}

TEST_CASE("arp: MPE per-note channels pass through unchanged",
          "[plugin][arp][adr004]")
{
    // Setup: master channel = 1, MPE per-note channel = 5. The off-channel
    // noteOn should reach the output untouched in arp mode (same MPE
    // pass-through contract as chord / scale).
    PointsmanProcessor p; configureArpProcessor(p, 22050);
    setParamRaw(p.apvts, pid::inputChannel, 1.0f);

    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(5, 72, juce::uint8{100}), 0);
    juce::AudioBuffer<float> audio(0, 22050);
    p.processBlock(audio, midi);

    bool sawOffChannel = false;
    for (const auto meta : midi)
    {
        const auto m = meta.getMessage();
        if (m.isNoteOn() && m.getChannel() == 5 && m.getNoteNumber() == 72)
            sawOffChannel = true;
    }
    REQUIRE(sawOffChannel);
    REQUIRE(p.getArpPoolSizeForTest() == 0); // off-channel did NOT enter pool
}

TEST_CASE("arp: empty pool produces no emission",
          "[plugin][arp][adr004]")
{
    PointsmanProcessor p; configureArpProcessor(p, 22050);

    juce::MidiBuffer midi; // no input
    juce::AudioBuffer<float> audio(0, 22050);
    p.processBlock(audio, midi);

    int noteOns = 0;
    for (const auto meta : midi)
        if (meta.getMessage().isNoteOn()) ++noteOns;
    REQUIRE(noteOns == 0);
}

TEST_CASE("arp: transport stop flushes sounding arp voices via panic",
          "[plugin][arp][adr004]")
{
    // Use 1/8 rate + full gate so each tick spans exactly one tick of
    // ringing. With blockSize 22050 and rate 1/8 (= 11025 samples), two
    // ticks fire (sample 0 and 11025) and the second tick's noteOff
    // lands at sample 22050 = blockEnd, which drainPendingInto does NOT
    // emit (strict <), leaving its voice sounding for the panic flush.
    PointsmanProcessor p; configureArpProcessor(p, 22050);
    setParamRaw(p.apvts, pid::arpRate, 3.0f); // 1/8
    setParamRaw(p.apvts, pid::arpGate, 1.0f);

    juce::MidiBuffer midi1;
    pressNote(midi1, 60);
    juce::AudioBuffer<float> audio(0, 22050);
    p.processBlock(audio, midi1);

    p.setHostIsPlayingForTest(false);
    juce::MidiBuffer midi2;
    p.processBlock(audio, midi2);

    bool sawNoteOff = false;
    for (const auto meta : midi2)
        if (meta.getMessage().isNoteOff()) sawNoteOff = true;
    REQUIRE(sawNoteOff);
}
