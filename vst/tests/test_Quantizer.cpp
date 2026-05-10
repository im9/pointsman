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
