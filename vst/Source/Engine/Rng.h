// RNG primitives per ADR 003 §"Engine boundary".
// xoshiro128++ (Vigna 2019) with SplitMix64 (Vigna) seeding.
// Cross-target conformance vectors: docs/ai/rng-test-vectors.json — bit-identical
// with m4l/engine/rng.ts.
//
// References:
//   xoshiro128++  https://prng.di.unimi.it/xoshiro128plusplus.c
//   SplitMix64    https://prng.di.unimi.it/splitmix64.c

#pragma once

#include <cstdint>

namespace pointsman
{
    struct RngState
    {
        uint32_t s[4];
    };

    // Seeding convention (canonical, see rng-test-vectors.json meta):
    //   call SplitMix64 twice; split each output u64 into [low32, high32].
    //   state.s = [low(z1), high(z1), low(z2), high(z2)]
    inline RngState seedRng(uint64_t seed) noexcept
    {
        auto splitMix64Next = [](uint64_t state, uint64_t& outZ) -> uint64_t {
            const uint64_t newState = state + 0x9e3779b97f4a7c15ULL;
            uint64_t z = newState;
            z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
            z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
            z = z ^ (z >> 31);
            outZ = z;
            return newState;
        };

        uint64_t st = seed;
        uint64_t z1 = 0, z2 = 0;
        st = splitMix64Next(st, z1);
        st = splitMix64Next(st, z2);

        RngState out{};
        out.s[0] = static_cast<uint32_t>(z1 & 0xFFFFFFFFULL);
        out.s[1] = static_cast<uint32_t>((z1 >> 32) & 0xFFFFFFFFULL);
        out.s[2] = static_cast<uint32_t>(z2 & 0xFFFFFFFFULL);
        out.s[3] = static_cast<uint32_t>((z2 >> 32) & 0xFFFFFFFFULL);
        return out;
    }

    inline uint32_t rotl32(uint32_t x, int k) noexcept
    {
        return (x << k) | (x >> (32 - k));
    }

    // Advances `rng` in place and returns the next u32 sample.
    // Mirrors xoshiro128plusplus.c next(): result = rotl(s0+s3, 7) + s0.
    inline uint32_t nextU32(RngState& rng) noexcept
    {
        const uint32_t result = rotl32(rng.s[0] + rng.s[3], 7) + rng.s[0];
        const uint32_t t = rng.s[1] << 9;

        rng.s[2] ^= rng.s[0];
        rng.s[3] ^= rng.s[1];
        rng.s[1] ^= rng.s[2];
        rng.s[0] ^= rng.s[3];
        rng.s[2] ^= t;
        rng.s[3] = rotl32(rng.s[3], 11);

        return result;
    }
}
