// Tests for Source/Engine/Rng.h — RNG primitives per ADR 003 §"Engine boundary".
// Vectors live in docs/ai/rng-test-vectors.json (cross-target spec).
// Bit-identical output with the m4l engine is the conformance contract.

#include <catch2/catch_test_macros.hpp>
#include <nlohmann/json.hpp>

#include <cstdint>
#include <fstream>

#include "Engine/Rng.h"

using json = nlohmann::json;
using namespace pointsman;

namespace
{
    json loadVectors()
    {
        std::ifstream in(POINTSMAN_RNG_VECTORS_PATH);
        REQUIRE(in.good());
        json j;
        in >> j;
        return j;
    }
}

TEST_CASE("xoshiro state words after SplitMix64 seeding", "[rng]")
{
    const auto V = loadVectors();
    for (const auto& tc : V.at("splitmix64_init"))
    {
        // Seed JSON uses decimal-as-string to preserve full u64 range.
        const auto seed = static_cast<uint64_t>(std::stoull(
            tc.at("seed").at("decimal").get<std::string>()));
        const auto s = seedRng(seed);
        const auto& expected = tc.at("xoshiro_state_s");
        for (size_t i = 0; i < 4; ++i)
        {
            const auto e = expected.at(i).at("decimal").get<uint32_t>();
            INFO("seed=" << tc.at("seed").at("hex").get<std::string>()
                         << " word=" << i);
            REQUIRE(s.s[i] == e);
        }
    }
}

TEST_CASE("xoshiro128++ first-N draws match vectors", "[rng]")
{
    const auto V = loadVectors();
    for (const auto& tc : V.at("prng"))
    {
        const auto seed = static_cast<uint64_t>(std::stoull(
            tc.at("seed").at("decimal").get<std::string>()));
        auto rng = seedRng(seed);
        const auto& draws = tc.at("draws");
        for (size_t i = 0; i < draws.size(); ++i)
        {
            const auto expected = draws.at(i).at("decimal").get<uint32_t>();
            const auto got = nextU32(rng);
            INFO("seed=" << tc.at("seed").at("hex").get<std::string>()
                         << " draw=" << i);
            REQUIRE(got == expected);
        }
    }
}

TEST_CASE("rotl32: identity rotations are well-defined for k in {0, 32}",
          "[rng]")
{
    // The naive `(x << k) | (x >> (32 - k))` is UB at k=0 (shift count
    // equal to operand width is undefined for unsigned shift in C++).
    // Today's call sites only pass k ∈ {7, 11}, so the bug is latent —
    // this test pins the safety guard so future use of the helper at
    // k=0 / k=32 stays well-defined and a no-op rotation. Threshold:
    // k=0 and k=32 are the only inputs where the unguarded form is UB
    // (boundary of the 0..31 well-defined shift range).
    const uint32_t x = 0xDEADBEEFu;
    REQUIRE(rotl32(x, 0)  == x);
    REQUIRE(rotl32(x, 32) == x);
}

TEST_CASE("xoshiro128++ state advances on each draw", "[rng]")
{
    // Spec sanity: nextU32 must mutate the in/out state. A static state
    // would silently make every draw identical; cheap guard here so the
    // bit-vector tests above can't regress to "always returned constant".
    auto rng = seedRng(42);
    const RngState before = rng;
    (void) nextU32(rng);
    REQUIRE_FALSE((before.s[0] == rng.s[0] && before.s[1] == rng.s[1]
                   && before.s[2] == rng.s[2] && before.s[3] == rng.s[3]));
}
