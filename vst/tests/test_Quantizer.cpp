// Tests for Source/Engine/Quantizer.{h,cpp} — port of m4l/engine/quantizer.ts
// validated against the shared cross-target vectors at
// docs/ai/quantizer-test-vectors.json. Vector parity is the conformance
// contract per ADR 003 §"Engine boundary".

#include <catch2/catch_test_macros.hpp>
#include <nlohmann/json.hpp>

#include <fstream>
#include <vector>
#include <string>

#include "Engine/Quantizer.h"
#include "Engine/State.h"

using json = nlohmann::json;
using namespace pointsman;

namespace
{
    json loadVectors()
    {
        std::ifstream in(POINTSMAN_QUANTIZER_VECTORS_PATH);
        REQUIRE(in.good());
        json j;
        in >> j;
        return j;
    }

    ScaleName parseScale(const std::string& s)
    {
        if (s == "major")              return ScaleName::Major;
        if (s == "minor")              return ScaleName::Minor;
        if (s == "dorian")             return ScaleName::Dorian;
        if (s == "phrygian")           return ScaleName::Phrygian;
        if (s == "lydian")             return ScaleName::Lydian;
        if (s == "mixolydian")         return ScaleName::Mixolydian;
        if (s == "locrian")            return ScaleName::Locrian;
        if (s == "pentatonic")         return ScaleName::Pentatonic;
        if (s == "minor-pentatonic")   return ScaleName::MinorPentatonic;
        if (s == "blues")              return ScaleName::Blues;
        if (s == "harmonic")           return ScaleName::Harmonic;
        if (s == "melodic")            return ScaleName::Melodic;
        if (s == "whole")              return ScaleName::Whole;
        if (s == "chromatic")          return ScaleName::Chromatic;
        if (s == "chromatic-half")     return ScaleName::ChromaticHalf;
        if (s == "phrygian-dominant")  return ScaleName::PhrygianDominant;
        FAIL("unknown scale: " << s);
        return ScaleName::Major;
    }

    HarmonyDirection parseDirection(const std::string& s)
    {
        if (s == "above") return HarmonyDirection::Above;
        if (s == "below") return HarmonyDirection::Below;
        FAIL("unknown harmony direction: " << s);
        return HarmonyDirection::Above;
    }

    // ----- ADR 004 enum/struct parsers ---------------------------------------

    ChordShape parseChordShape(const std::string& s)
    {
        if (s == "maj")    return ChordShape::Maj;
        if (s == "m")      return ChordShape::Min;
        if (s == "dim")    return ChordShape::Dim;
        if (s == "aug")    return ChordShape::Aug;
        if (s == "sus2")   return ChordShape::Sus2;
        if (s == "sus4")   return ChordShape::Sus4;
        if (s == "power")  return ChordShape::Power;
        if (s == "maj7")   return ChordShape::Maj7;
        if (s == "m7")     return ChordShape::Min7;
        if (s == "7")      return ChordShape::Dom7;
        if (s == "m7b5")   return ChordShape::Min7b5;
        if (s == "dim7")   return ChordShape::Dim7;
        if (s == "6")      return ChordShape::Maj6;
        if (s == "m6")     return ChordShape::Min6;
        if (s == "add9")   return ChordShape::Add9;
        if (s == "maj9")   return ChordShape::Maj9;
        if (s == "m9")     return ChordShape::Min9;
        if (s == "9")      return ChordShape::Dom9;
        if (s == "13")     return ChordShape::Dom13;
        if (s == "octave") return ChordShape::Octave;
        FAIL("unknown chord shape: " << s);
        return ChordShape::Maj;
    }

    ArpRate parseArpRateName(const std::string& s)
    {
        if (s == "1/4")   return ArpRate::Q4;
        if (s == "1/4D")  return ArpRate::Q4D;
        if (s == "1/4T")  return ArpRate::Q4T;
        if (s == "1/8")   return ArpRate::Q8;
        if (s == "1/8D")  return ArpRate::Q8D;
        if (s == "1/8T")  return ArpRate::Q8T;
        if (s == "1/16")  return ArpRate::Q16;
        if (s == "1/16D") return ArpRate::Q16D;
        if (s == "1/16T") return ArpRate::Q16T;
        if (s == "1/32")  return ArpRate::Q32;
        FAIL("unknown arp rate: " << s);
        return ArpRate::Q16;
    }

    ArpPattern parseArpPattern(const std::string& s)
    {
        if (s == "up")        return ArpPattern::Up;
        if (s == "down")      return ArpPattern::Down;
        if (s == "up-down")   return ArpPattern::UpDown;
        if (s == "random")    return ArpPattern::Random;
        if (s == "as-played") return ArpPattern::AsPlayed;
        if (s == "strike")    return ArpPattern::Strike;
        FAIL("unknown arp pattern: " << s);
        return ArpPattern::Up;
    }

    ArpState parseArpState(const json& j)
    {
        return {
            j.at("index").get<int>(),
            j.at("round").get<int>(),
            j.at("repeatTick").get<int>(),
            j.at("direction").get<int>(),
        };
    }

    ArpEmission parseArpEmission(const json& j)
    {
        ArpEmission e;
        const auto kind = j.at("kind").get<std::string>();
        if (kind == "rest")
        {
            e.kind = ArpEmissionKind::Rest;
            return e;
        }
        e.kind = ArpEmissionKind::Emit;
        e.pitches = j.at("pitches").get<std::vector<int>>();
        return e;
    }

    ArpVariationResult parseVariationResult(const json& j)
    {
        ArpVariationResult r;
        const auto effect = j.at("effect").get<std::string>();
        if (effect == "rest")           r.effect = ArpVariationEffect::Rest;
        else if (effect == "normal")    r.effect = ArpVariationEffect::Normal;
        else if (effect == "octave_shift") r.effect = ArpVariationEffect::OctaveShift;
        else if (effect == "flam")      r.effect = ArpVariationEffect::Flam;
        else FAIL("unknown variation effect: " << effect);
        if (j.contains("pitches"))
            r.pitches = j.at("pitches").get<std::vector<int>>();
        if (j.contains("semitones"))
            r.semitones = j.at("semitones").get<int>();
        if (j.contains("second_offset_fraction"))
            r.secondOffsetFraction = j.at("second_offset_fraction").get<double>();
        return r;
    }

    // Variation result used as INPUT to applyArpGroove. The JSON cases
    // express its emission as { "effect": "...", "pitches": [...] } sans
    // the auxiliary fields, so this is a thin convenience wrapper.
    ArpVariationResult parseGrooveEmission(const json& j)
    {
        ArpVariationResult r;
        const auto effect = j.at("effect").get<std::string>();
        if (effect == "rest")              r.effect = ArpVariationEffect::Rest;
        else if (effect == "normal")       r.effect = ArpVariationEffect::Normal;
        else if (effect == "octave_shift") r.effect = ArpVariationEffect::OctaveShift;
        else if (effect == "flam")         r.effect = ArpVariationEffect::Flam;
        else FAIL("unknown groove input effect: " << effect);
        if (j.contains("pitches"))
            r.pitches = j.at("pitches").get<std::vector<int>>();
        return r;
    }

    ArpAccentTable parseAccentTable(const json& j)
    {
        const auto v = j.get<std::vector<int>>();
        REQUIRE(v.size() == 16);
        ArpAccentTable t{};
        for (size_t i = 0; i < 16; ++i) t[i] = v[i];
        return t;
    }

    ArpSlideTable parseSlideTable(const json& j)
    {
        const auto v = j.get<std::vector<bool>>();
        REQUIRE(v.size() == 16);
        ArpSlideTable t{};
        for (size_t i = 0; i < 16; ++i) t[i] = v[i];
        return t;
    }
}

TEST_CASE("buildScalePitches matches vectors for every (scale, root) case",
          "[quantizer]")
{
    const auto V = loadVectors();
    for (const auto& tc : V.at("build_scale_pitches"))
    {
        const auto scaleStr = tc.at("scale").get<std::string>();
        const auto scale = parseScale(scaleStr);
        const auto root  = tc.at("root").get<int>();
        const auto got = buildScalePitches(scale, root);
        INFO("scale=" << scaleStr << " root=" << root);

        // chromatic-half uses a compact schema (length + first/last slices)
        // because the full 0..127 enumeration is the identity. See
        // quantizer-test-vectors.json meta.chromatic_half.
        if (tc.contains("pitches"))
        {
            REQUIRE(got == tc.at("pitches").get<std::vector<int>>());
        }
        else
        {
            const auto length = tc.at("pitches_length").get<size_t>();
            const auto first5 = tc.at("pitches_first_5").get<std::vector<int>>();
            const auto last5  = tc.at("pitches_last_5").get<std::vector<int>>();
            REQUIRE(got.size() == length);
            for (size_t i = 0; i < first5.size(); ++i)
                REQUIRE(got[i] == first5[i]);
            for (size_t i = 0; i < last5.size(); ++i)
                REQUIRE(got[got.size() - last5.size() + i] == last5[i]);
        }
    }
}

TEST_CASE("buildScalePitchesInto produces same output as buildScalePitches",
          "[quantizer]")
{
    // Parity check: the audio-thread alloc-free path must produce the same
    // pitches as the return-by-value form for every (scale, root).
    const auto V = loadVectors();
    std::vector<int> buf;
    buf.reserve(128);
    for (const auto& tc : V.at("build_scale_pitches"))
    {
        const auto scale = parseScale(tc.at("scale").get<std::string>());
        const auto root  = tc.at("root").get<int>();
        const auto byVal = buildScalePitches(scale, root);
        buildScalePitchesInto(scale, root, buf);
        REQUIRE(buf == byVal);
    }
}

TEST_CASE("buildScalePitchesInto reuses caller capacity without reallocating",
          "[quantizer]")
{
    // RT-safety contract: after a single reserve(128), repeated rewrites of
    // the same buffer must keep the capacity > 0 (proxy for "did not
    // re-allocate"). std::vector::reserve never shrinks, and clear()
    // followed by push_backs within capacity keep the data() pointer
    // stable on libc++/libstdc++.
    std::vector<int> buf;
    buf.reserve(128);
    const int* originalData = buf.data();
    const auto originalCap = buf.capacity();
    buildScalePitchesInto(ScaleName::Major, 0, buf);
    buildScalePitchesInto(ScaleName::ChromaticHalf, 0, buf);
    buildScalePitchesInto(ScaleName::Pentatonic, 7, buf);
    REQUIRE(buf.capacity() == originalCap);
    REQUIRE(buf.data() == originalData);
}

TEST_CASE("snapToScale matches vectors", "[quantizer]")
{
    const auto V = loadVectors();
    for (const auto& tc : V.at("snap_to_scale"))
    {
        const auto scale = parseScale(tc.at("scale").get<std::string>());
        const auto root  = tc.at("root").get<int>();
        const auto note  = tc.at("note").get<int>();
        const auto expected = tc.at("expected").get<int>();
        const auto pitches = buildScalePitches(scale, root);

        INFO("label=" << tc.at("label").get<std::string>());
        REQUIRE(snapToScale(note, pitches) == expected);
    }
}

TEST_CASE("snapToChordTones matches vectors", "[quantizer]")
{
    const auto V = loadVectors();
    for (const auto& tc : V.at("snap_to_chord_tones"))
    {
        const auto scale = parseScale(tc.at("scale").get<std::string>());
        const auto root  = tc.at("root").get<int>();
        const auto note  = tc.at("note").get<int>();
        const auto chordPcs = tc.at("chord_pcs").get<std::vector<int>>();
        const auto tolerance = tc.at("tolerance").get<int>();
        const auto expected = tc.at("expected").get<int>();
        const auto pitches = buildScalePitches(scale, root);

        INFO("label=" << tc.at("label").get<std::string>());
        REQUIRE(snapToChordTones(note, chordPcs, pitches, tolerance) == expected);
    }
}

TEST_CASE("diatonicShift matches vectors", "[quantizer]")
{
    const auto V = loadVectors();
    for (const auto& tc : V.at("diatonic_shift"))
    {
        const auto scale = parseScale(tc.at("scale").get<std::string>());
        const auto root  = tc.at("root").get<int>();
        const auto note  = tc.at("note").get<int>();
        const auto interval = tc.at("interval").get<int>();
        const auto direction = parseDirection(
            tc.at("direction").get<std::string>());
        const auto expected = tc.at("expected").get<int>();
        const auto pitches = buildScalePitches(scale, root);

        INFO("label=" << tc.at("label").get<std::string>());
        REQUIRE(diatonicShift(note, interval, direction, pitches) == expected);
    }
}

TEST_CASE("buildScalePitches: chromatic-half is 0..127 identity", "[quantizer]")
{
    // Spec: chromatic-half = passthrough sentinel (concept.md §"Scales (v1)",
    // quantizer-test-vectors.json meta.chromatic_half). buildScalePitches must
    // return [0,1,...,127] regardless of root.
    const auto pitches = buildScalePitches(ScaleName::ChromaticHalf, 7);
    REQUIRE(pitches.size() == 128);
    for (int i = 0; i < 128; ++i)
        REQUIRE(pitches[(size_t) i] == i);
}

TEST_CASE("snapToChordTones: empty chord PCs falls back to scale snap",
          "[quantizer]")
{
    // Spec: empty chordPcs → identical to plain snapToScale. Mirrors
    // m4l/engine/quantizer.ts:104. Belt-and-braces over the vector cases.
    const auto pitches = buildScalePitches(ScaleName::Major, 0);
    const std::vector<int> none{};
    REQUIRE(snapToChordTones(63, none, pitches, 2) == snapToScale(63, pitches));
}

// ============================================================================
// ADR 004 — chord shape primitive
// ============================================================================

TEST_CASE("applyChordShape matches vectors", "[quantizer][adr004]")
{
    const auto V = loadVectors();
    for (const auto& tc : V.at("apply_chord_shape"))
    {
        const auto shape = parseChordShape(tc.at("shape_name").get<std::string>());
        const auto root  = tc.at("root").get<int>();
        const auto expected = tc.at("expected").get<std::vector<int>>();

        INFO("label=" << tc.at("label").get<std::string>());
        REQUIRE(applyChordShape(root, shape) == expected);
    }
}

// ============================================================================
// ADR 004 — arpeggiator rate
// ============================================================================

TEST_CASE("parseArpRate matches vectors", "[quantizer][adr004]")
{
    const auto V = loadVectors();
    for (const auto& tc : V.at("parse_arp_rate"))
    {
        const auto rate = parseArpRateName(tc.at("rate_name").get<std::string>());
        const auto& exp = tc.at("expected_quarters");
        const auto expectedNum = exp.at("num").get<int>();
        const auto expectedDen = exp.at("den").get<int>();
        const auto got = parseArpRate(rate);

        INFO("label=" << tc.at("label").get<std::string>());
        REQUIRE(got.num == expectedNum);
        REQUIRE(got.den == expectedDen);
    }
}

// ============================================================================
// ADR 004 — arpeggiator pattern cursor + step resolution
// ============================================================================

TEST_CASE("nextArpIndex matches vectors", "[quantizer][adr004]")
{
    const auto V = loadVectors();
    for (const auto& tc : V.at("next_arp_index"))
    {
        const auto pattern = parseArpPattern(tc.at("pattern").get<std::string>());
        const auto poolSize = tc.at("poolSize").get<int>();
        const auto octaves = tc.at("octaves").get<int>();
        const auto stepRepeats = tc.at("stepRepeats").get<int>();
        const auto label = tc.at("label").get<std::string>();

        if (tc.contains("trace"))
        {
            // Walk from `initial`, advance once per step in `trace[1..]`.
            ArpState st = parseArpState(tc.at("initial"));
            const auto& trace = tc.at("trace");
            const auto initialFromTrace = parseArpState(trace.at(0));
            INFO(label << " — initial");
            REQUIRE(st.index == initialFromTrace.index);
            REQUIRE(st.round == initialFromTrace.round);
            REQUIRE(st.repeatTick == initialFromTrace.repeatTick);
            REQUIRE(st.direction == initialFromTrace.direction);

            for (size_t t = 1; t < trace.size(); ++t)
            {
                st = nextArpIndex(pattern, st, poolSize, octaves, stepRepeats, 0.0);
                const auto expected = parseArpState(trace.at(t));
                INFO(label << " — tick " << t);
                REQUIRE(st.index == expected.index);
                REQUIRE(st.round == expected.round);
                REQUIRE(st.repeatTick == expected.repeatTick);
                REQUIRE(st.direction == expected.direction);
            }
        }
        else
        {
            // Single-step case (random + empty-pool sentinels).
            const auto initial = parseArpState(tc.at("initial"));
            const double rngDraw01 = tc.contains("rngDraw01")
                ? tc.at("rngDraw01").get<double>() : 0.0;
            const auto got = nextArpIndex(pattern, initial, poolSize, octaves,
                                          stepRepeats, rngDraw01);
            const auto expected = parseArpState(tc.at("expected"));
            INFO(label);
            REQUIRE(got.index == expected.index);
            REQUIRE(got.round == expected.round);
            REQUIRE(got.repeatTick == expected.repeatTick);
            REQUIRE(got.direction == expected.direction);
        }
    }
}

TEST_CASE("resolveArpStep matches vectors", "[quantizer][adr004]")
{
    const auto V = loadVectors();
    for (const auto& tc : V.at("resolve_arp_step"))
    {
        const auto pool = tc.at("pool").get<std::vector<int>>();
        const auto index = tc.at("index").get<int>();
        const auto octaveRound = tc.at("octaveRound").get<int>();
        const auto pattern = parseArpPattern(tc.at("pattern").get<std::string>());
        const auto expected = parseArpEmission(tc.at("expected"));
        const auto got = resolveArpStep(pool, index, octaveRound, pattern);

        INFO("label=" << tc.at("label").get<std::string>());
        REQUIRE(static_cast<int>(got.kind) == static_cast<int>(expected.kind));
        REQUIRE(got.pitches == expected.pitches);
    }
}

TEST_CASE("kInitialArpState matches the vectors' canonical first-tick state",
          "[quantizer][adr004]")
{
    // Anchor: every trace case's `initial` field equals this. A future
    // refactor that changes the default state should fail loudly here.
    REQUIRE(kInitialArpState.index == 0);
    REQUIRE(kInitialArpState.round == 0);
    REQUIRE(kInitialArpState.repeatTick == 0);
    REQUIRE(kInitialArpState.direction == 1);
}

// ============================================================================
// ADR 004 — variation cascade
// ============================================================================

TEST_CASE("applyArpVariation matches vectors", "[quantizer][adr004]")
{
    const auto V = loadVectors();
    for (const auto& tc : V.at("apply_arp_variation"))
    {
        const auto emission = parseArpEmission(tc.at("emission"));
        const auto variation = tc.at("variation").get<double>();
        const auto rngDraw01 = tc.at("rngDraw01").get<double>();
        const auto rngDraw02 = tc.at("rngDraw02").get<double>();
        const auto expected = parseVariationResult(tc.at("expected"));
        const auto got = applyArpVariation(emission, variation, rngDraw01, rngDraw02);

        INFO("label=" << tc.at("label").get<std::string>());
        REQUIRE(static_cast<int>(got.effect) == static_cast<int>(expected.effect));
        REQUIRE(got.pitches == expected.pitches);
        REQUIRE(got.semitones == expected.semitones);
        REQUIRE(got.secondOffsetFraction == expected.secondOffsetFraction);
    }
}

// ============================================================================
// ADR 004 — groove cascade
// ============================================================================

TEST_CASE("applyArpGroove matches vectors", "[quantizer][adr004]")
{
    const auto V = loadVectors();
    for (const auto& tc : V.at("apply_arp_groove"))
    {
        const auto emission = parseGrooveEmission(tc.at("emission"));
        const auto tickIndex = tc.at("tickIndex").get<int>();
        const auto accent = parseAccentTable(tc.at("accentTable"));
        const auto slide = parseSlideTable(tc.at("slideTable"));
        const auto swing = tc.at("swing").get<double>();
        const auto sixteenthDur = tc.at("sixteenthDurationSamples").get<double>();
        const auto& expected = tc.at("expected");
        const auto got = applyArpGroove(emission, tickIndex, accent, slide,
                                         swing, sixteenthDur);

        INFO("label=" << tc.at("label").get<std::string>());
        REQUIRE(got.applied == expected.at("applied").get<bool>());
        if (got.applied)
        {
            REQUIRE(got.velocity == expected.at("velocity").get<int>());
            REQUIRE(got.tieToNext == expected.at("tieToNext").get<bool>());
            REQUIRE(got.swingOffsetSamples
                    == expected.at("swingOffsetSamples").get<double>());
        }
    }
}

// ============================================================================
// ADR 004 — slide-aware noteOff scheduling
// ============================================================================

TEST_CASE("scheduleArpNoteOff matches vectors", "[quantizer][adr004]")
{
    const auto V = loadVectors();
    for (const auto& tc : V.at("schedule_arp_note_off"))
    {
        const auto slideOnCurrent = tc.at("slideOnCurrent").get<bool>();
        const auto gateSamples = tc.at("gateSamples").get<double>();
        const auto nextTickSampleOffset =
            tc.at("nextTickSampleOffset").get<double>();
        const auto expected =
            tc.at("expected").at("noteOffSampleOffset").get<double>();
        const auto got = scheduleArpNoteOff(slideOnCurrent, gateSamples,
                                             nextTickSampleOffset);

        INFO("label=" << tc.at("label").get<std::string>());
        REQUIRE(got == expected);
    }
}
