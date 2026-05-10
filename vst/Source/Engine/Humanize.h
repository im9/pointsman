// Pointsman humanize layer per ADR 003 §"Engine boundary" and concept.md
// §"Per-event humanize". Composes per-event velocity / gate / timing
// perturbations from a single shared RNG, with optional EMA drift smoothing.
//
// Behavioral parity with m4l/host/humanize.ts is the binding contract; the
// API differs only in C++ idiom (mutable references vs. functional state-pair
// returns).

#pragma once

#include "Rng.h"

namespace pointsman
{
    // Per-axis EMA accumulators, signed. Reset on transport start
    // (concept.md §"Per-event humanize"). Transport stop does NOT touch
    // drift state (per concept.md "Transport stop does not touch drift state").
    struct DriftState
    {
        double vel  = 0.0;
        double gate = 0.0;
        double time = 0.0; // step-fraction units, ±0.5 max
    };

    // Uniform signed noise in [-amplitude, +amplitude). Half-open at the
    // upper bound because the underlying u32 → [-1, +1) remap excludes +1
    // exactly. Always consumes one nextU32 — even amplitude=0 advances the
    // RNG, so the per-axis draw order in composeHumanize stays deterministic
    // regardless of which amplitudes are zero.
    double draw(RngState& rng, double amplitude) noexcept;

    // Single-pole low-pass over per-event raw draws.
    //   result = factor*prev + (1-factor)*raw.
    inline double drift(double prev, double raw, double factor) noexcept
    {
        return factor * prev + (1.0 - factor) * raw;
    }

    struct ComposeArgs
    {
        double velocity      = 0.0;  // amp 0..1
        double gate          = 0.0;  // amp 0..1
        double timing        = 0.0;  // amp 0..1
        double driftFactor   = 0.0;  // 0..1
        int    inputVelocity = 100;  // 1..127
        double outputLevel   = 1.0;  // 0..1
        double outputGateBase = 1.0; // v1 always 1.0
        double sourceStepDuration = 0.0; // ms
    };

    struct ComposeResult
    {
        int    velocityFinal = 0; // 1..127 integer
        double gateFinal     = 0.0; // 0..1
        double timingOffset  = 0.0; // ms (signed)
    };

    // Per-event composition. Draw order: velocity → gate → timing (binding for
    // cross-target reproducibility). `drift` always advances even when
    // driftFactor=0, so toggling the dial mid-session does not desync.
    // `rng` and `drift` are mutated in place.
    ComposeResult composeHumanize(RngState& rng,
                                  DriftState& drift,
                                  const ComposeArgs& args) noexcept;
}
