// Tests for Source/Engine/Humanize.{h,cpp} — port of m4l/host/humanize.test.ts.
// Spec: concept.md §"Per-event humanize", ADR 003 §"Engine boundary".
//
// Threshold justification (CLAUDE.md global): every numeric assertion is
// derived inline against the spec or first-principles arithmetic — no values
// fitted to observed implementation output.

#include <catch2/catch_test_macros.hpp>

#include <cmath>

#include "Engine/Humanize.h"
#include "Engine/Rng.h"

using namespace pointsman;

namespace
{
    ComposeArgs defaultArgs()
    {
        ComposeArgs a;
        a.velocity = 0.0;
        a.gate = 0.0;
        a.timing = 0.0;
        a.driftFactor = 0.0;
        a.inputVelocity = 100;
        a.outputLevel = 1.0;
        a.outputGateBase = 1.0;
        a.sourceStepDuration = 100.0; // arbitrary nonzero unit for offset arithmetic
        return a;
    }

    bool driftEqual(const DriftState& a, const DriftState& b) noexcept
    {
        return a.vel == b.vel && a.gate == b.gate && a.time == b.time;
    }
}

// ---------- draw ----------

TEST_CASE("draw — amplitude=0 returns 0; rng still advances", "[humanize]")
{
    // Spec: draw is uniform signed noise on [-amp, +amp]. amp=0 collapses to 0.
    // RNG must still advance for deterministic order across axes (a zero-amp
    // axis still consumes one nextU32 — see compose draw-order test below).
    auto rng = seedRng(42);
    const RngState before = rng;
    const double v = draw(rng, 0.0);
    REQUIRE(v == 0.0);
    REQUIRE_FALSE((before.s[0] == rng.s[0] && before.s[1] == rng.s[1]
                   && before.s[2] == rng.s[2] && before.s[3] == rng.s[3]));
}

TEST_CASE("draw — amplitude=1 yields value in [-1, +1)", "[humanize]")
{
    // Spec: u32/2^31 - 1 lands in [-1, +1). +1 exact is excluded by the
    // half-open upper bound.
    auto rng = seedRng(7);
    const double v = draw(rng, 1.0);
    REQUIRE(v >= -1.0);
    REQUIRE(v < 1.0);
}

TEST_CASE("draw — amplitude=0.25 yields value in [-0.25, +0.25)", "[humanize]")
{
    // Linear scaling of the [-1, +1) base by amplitude.
    auto rng = seedRng(123);
    for (int i = 0; i < 50; ++i)
    {
        const double v = draw(rng, 0.25);
        INFO("iter=" << i << " v=" << v);
        REQUIRE(v >= -0.25);
        REQUIRE(v < 0.25);
    }
}

TEST_CASE("draw — produces both signs across many samples", "[humanize]")
{
    // Sanity: signed noise must visit both half-planes. With 200 uniform
    // samples on [-1, 1), prob of all-positive (or all-negative) is 2^-200.
    auto rng = seedRng(1);
    bool sawPos = false, sawNeg = false;
    for (int i = 0; i < 200; ++i)
    {
        const double v = draw(rng, 1.0);
        if (v > 0.0) sawPos = true;
        if (v < 0.0) sawNeg = true;
    }
    REQUIRE(sawPos);
    REQUIRE(sawNeg);
}

// ---------- drift ----------

TEST_CASE("drift — factor=0 returns raw (no smoothing)", "[humanize]")
{
    // Spec EMA: result = factor*prev + (1-factor)*raw. factor=0 → raw.
    REQUIRE(drift(0.5, 0.2, 0.0) == 0.2);
    REQUIRE(drift(-0.7, 0.4, 0.0) == 0.4);
}

TEST_CASE("drift — factor=1 returns prev (full smoothing)", "[humanize]")
{
    // factor=1 → prev. 1.0 is the documented degenerate freeze (concept.md
    // §"Per-event humanize"); raw is ignored entirely.
    REQUIRE(drift(0.5, 0.2, 1.0) == 0.5);
    REQUIRE(drift(-0.7, 0.4, 1.0) == -0.7);
}

TEST_CASE("drift — factor=0.5 returns midpoint", "[humanize]")
{
    // 0.5*prev + 0.5*raw = algebraic midpoint. IEEE-754 makes 0.5*0.4 + 0.5*0.2
    // round to 0.30000000000000004 not 0.3 — compare with epsilon 1e-12, well
    // above double rounding noise (~2e-16) and well below any musically
    // meaningful drift value.
    REQUIRE(std::fabs(drift(0.4, 0.2, 0.5) - 0.3) < 1e-12);
    REQUIRE(std::fabs(drift(1.0, 0.0, 0.5) - 0.5) < 1e-12);
}

// ---------- composeHumanize ----------

TEST_CASE("composeHumanize — all amplitudes 0 yields identity output",
          "[humanize]")
{
    // rawVel = rawGate = rawTime = 0 → identity:
    //   velocityFinal = round(inputVelocity * 1 * outputLevel) = 100
    //   gateFinal = outputGateBase = 1.0
    //   timingOffset = 0
    auto rng = seedRng(42);
    DriftState d{};
    const auto r = composeHumanize(rng, d, defaultArgs());
    REQUIRE(r.velocityFinal == 100);
    REQUIRE(r.gateFinal == 1.0);
    REQUIRE(r.timingOffset == 0.0);
}

TEST_CASE("composeHumanize — outputLevel scales velocity linearly",
          "[humanize]")
{
    // velocityFinal = round(inputVelocity * (1+0) * outputLevel)
    //               = round(100 * 0.5) = 50
    auto rng = seedRng(42);
    DriftState d{};
    auto args = defaultArgs();
    args.outputLevel = 0.5;
    const auto r = composeHumanize(rng, d, args);
    REQUIRE(r.velocityFinal == 50);
}

TEST_CASE("composeHumanize — velocity clamps to 127 ceiling", "[humanize]")
{
    // inputVel=127 + smoothedVel=0.5 (drifted to constant via factor=1) →
    //   raw = 127 * 1.5 * 1 = 190.5 → round 191 → clamp 127.
    // Threshold 127 = MIDI velocity max (concept.md §"Parameter surface").
    auto rng = seedRng(42);
    DriftState d{};
    d.vel = 0.5;
    auto args = defaultArgs();
    args.inputVelocity = 127;
    args.driftFactor = 1.0;
    const auto r = composeHumanize(rng, d, args);
    REQUIRE(r.velocityFinal == 127);
}

TEST_CASE("composeHumanize — velocity clamps to 1 floor (never 0)",
          "[humanize]")
{
    // outputLevel=0 → arithmetic = 0; clamp lifts to 1 so the device never
    // emits a velocity-0 noteOn (which is a noteOff in MIDI).
    // Threshold 1 = MIDI velocity floor for noteOn.
    auto rng = seedRng(42);
    DriftState d{};
    auto args = defaultArgs();
    args.outputLevel = 0.0;
    const auto r = composeHumanize(rng, d, args);
    REQUIRE(r.velocityFinal == 1);
}

TEST_CASE("composeHumanize — gate clamped to [0, 1]", "[humanize]")
{
    // Pre-drift smoothedGate=0.7 + outputGateBase=1.0 → 1.7 → clamp 1.0.
    // Pre-drift smoothedGate=-1.5 + outputGateBase=1.0 → -0.5 → clamp 0.0.
    auto rngHi = seedRng(42);
    DriftState dHi{};
    dHi.gate = 0.7;
    auto args = defaultArgs();
    args.driftFactor = 1.0;
    const auto rHi = composeHumanize(rngHi, dHi, args);
    REQUIRE(rHi.gateFinal == 1.0);

    auto rngLo = seedRng(42);
    DriftState dLo{};
    dLo.gate = -1.5;
    const auto rLo = composeHumanize(rngLo, dLo, args);
    REQUIRE(rLo.gateFinal == 0.0);
}

TEST_CASE("composeHumanize — timing scaled by 0.5 step then sourceStepDuration",
          "[humanize]")
{
    // Spec: rawTime = draw(rng, timing) * 0.5  (range ±0.5 step)
    //       timingOffset = rawTime * sourceStepDuration
    // Verify against manually-replayed third draw from the same seed.
    const uint64_t seed = 42;

    // Manually replay the three nextU32 calls compose makes (vel, gate, time).
    auto manual = seedRng(seed);
    (void) nextU32(manual);
    (void) nextU32(manual);
    const uint32_t u3 = nextU32(manual);
    const double rawTimeBase = static_cast<double>(u3) / 2147483648.0 - 1.0;
    const double expectedRawTime = rawTimeBase * 1.0 * 0.5; // amp=1, ±0.5 step
    const double expectedOffset = expectedRawTime * 250.0;  // sourceStepDuration

    auto rng = seedRng(seed);
    DriftState d{};
    auto args = defaultArgs();
    args.timing = 1.0;
    args.sourceStepDuration = 250.0;
    const auto r = composeHumanize(rng, d, args);

    REQUIRE(r.timingOffset == expectedOffset);
}

TEST_CASE("composeHumanize — draw order is velocity → gate → timing",
          "[humanize]")
{
    // Binding for cross-target reproducibility. Verify by comparing the
    // velocity axis against the FIRST u32 sample, the gate axis against the
    // SECOND, timing against the THIRD.
    const uint64_t seed = 99;

    auto manual = seedRng(seed);
    const uint32_t a = nextU32(manual);
    const uint32_t b = nextU32(manual);
    const uint32_t c = nextU32(manual);
    const double aSigned = static_cast<double>(a) / 2147483648.0 - 1.0;
    const double bSigned = static_cast<double>(b) / 2147483648.0 - 1.0;
    const double cSigned = static_cast<double>(c) / 2147483648.0 - 1.0;

    auto rng = seedRng(seed);
    DriftState d{};
    auto args = defaultArgs();
    args.velocity = 1.0;
    args.gate = 1.0;
    args.timing = 1.0;
    args.inputVelocity = 100;
    args.outputGateBase = 1.0;
    args.sourceStepDuration = 100.0;
    const auto r = composeHumanize(rng, d, args);

    // Match jsMathRound (half toward +inf) on the C++ side.
    const auto roundJs = [](double x) {
        return static_cast<int>(std::floor(x + 0.5));
    };
    const int expectedVel = std::max(1, std::min(127,
        roundJs(100.0 * (1.0 + aSigned))));
    const double expectedGate = std::max(0.0, std::min(1.0, 1.0 * (1.0 + bSigned)));
    const double expectedOffset = cSigned * 0.5 * 100.0;

    REQUIRE(r.velocityFinal == expectedVel);
    REQUIRE(r.gateFinal == expectedGate);
    REQUIRE(r.timingOffset == expectedOffset);
}

TEST_CASE("composeHumanize — driftFactor=0 still updates drift state",
          "[humanize]")
{
    // Spec: drift state advances even when factor=0 so toggling the dial
    // mid-session does not desync (concept.md §"Per-event humanize").
    // After one call with factor=0, EMA = raw, and the probability all three
    // raw draws are exactly 0 is 2^-96.
    auto rng = seedRng(11);
    DriftState d{};
    auto args = defaultArgs();
    args.velocity = 1.0;
    args.gate = 1.0;
    args.timing = 1.0;
    args.driftFactor = 0.0;
    (void) composeHumanize(rng, d, args);

    const bool moved = (d.vel != 0.0) || (d.gate != 0.0) || (d.time != 0.0);
    REQUIRE(moved);
}

TEST_CASE("composeHumanize — driftFactor=1 with neutral drift outputs identity",
          "[humanize]")
{
    // factor=1 → smoothed = prev (= 0 for neutral) regardless of raw.
    // Output collapses to the identity case (same as all-amp-zero).
    auto rng = seedRng(42);
    DriftState d{};
    auto args = defaultArgs();
    args.velocity = 1.0;
    args.gate = 1.0;
    args.timing = 1.0;
    args.driftFactor = 1.0;
    const auto r = composeHumanize(rng, d, args);
    REQUIRE(r.velocityFinal == 100);
    REQUIRE(r.gateFinal == 1.0);
    REQUIRE(r.timingOffset == 0.0);
}

TEST_CASE("composeHumanize — reproducibility: same inputs yield same outputs",
          "[humanize]")
{
    // Determinism is a binding contract for cross-target test vectors.
    auto rngA = seedRng(42);
    DriftState dA{};
    auto args = defaultArgs();
    args.velocity = 0.5;
    args.gate = 0.5;
    args.timing = 0.5;
    args.driftFactor = 0.3;
    const auto a = composeHumanize(rngA, dA, args);

    auto rngB = seedRng(42);
    DriftState dB{};
    const auto b = composeHumanize(rngB, dB, args);

    REQUIRE(a.velocityFinal == b.velocityFinal);
    REQUIRE(a.gateFinal == b.gateFinal);
    REQUIRE(a.timingOffset == b.timingOffset);
    REQUIRE(driftEqual(dA, dB));
}

TEST_CASE("composeHumanize — rng advances by exactly 3 draws per call",
          "[humanize]")
{
    // velocity / gate / timing are three independent nextU32 consumptions.
    const uint64_t seed = 5;
    auto rng = seedRng(seed);
    DriftState d{};
    auto args = defaultArgs();
    args.velocity = 1.0;
    args.gate = 1.0;
    args.timing = 1.0;
    (void) composeHumanize(rng, d, args);

    auto manual = seedRng(seed);
    (void) nextU32(manual);
    (void) nextU32(manual);
    (void) nextU32(manual);

    REQUIRE(rng.s[0] == manual.s[0]);
    REQUIRE(rng.s[1] == manual.s[1]);
    REQUIRE(rng.s[2] == manual.s[2]);
    REQUIRE(rng.s[3] == manual.s[3]);
}

TEST_CASE("composeHumanize — driftFactor approaches 1: EMA convergence",
          "[humanize]")
{
    // Spec: factor close to 1 (e.g. 0.95-0.99) produces slow drift. After
    // many calls with constant args, EMA(usedVel) should converge — its
    // variance across recent calls should drop below the per-draw variance.
    //
    // Threshold derivation: with factor=0.95, the EMA's effective sample
    // size is ~ (1+factor)/(1-factor) ≈ 39. So after a long run the
    // sample-to-sample step size should be ~ 1/sqrt(39) ≈ 0.16x the per-draw
    // std-dev (which is ~0.577 for U(-1,+1) — sqrt(1/3)). So step variance
    // ≈ (0.577/sqrt(39))^2 ≈ 0.0085. We assert max consecutive |delta| < 0.5
    // — a 60σ envelope, leaving ample headroom against accidental regression
    // while still failing if smoothing breaks (e.g. degenerates to factor=0).
    auto rng = seedRng(31);
    DriftState d{};
    auto args = defaultArgs();
    args.velocity = 1.0;
    args.gate = 0.0;
    args.timing = 0.0;
    args.driftFactor = 0.95;

    double prev = 0.0;
    double maxDelta = 0.0;
    // Burn-in 50 calls so EMA has settled before we measure step sizes.
    for (int i = 0; i < 50; ++i) (void) composeHumanize(rng, d, args);
    prev = d.vel;
    for (int i = 0; i < 200; ++i)
    {
        (void) composeHumanize(rng, d, args);
        const double delta = std::fabs(d.vel - prev);
        if (delta > maxDelta) maxDelta = delta;
        prev = d.vel;
    }
    INFO("max |EMA step| = " << maxDelta);
    REQUIRE(maxDelta < 0.5);
}

TEST_CASE("composeHumanize — driftFactor=1.0 freezes EMA exactly (concept.md)",
          "[humanize]")
{
    // Documented degenerate case: factor=1.0 means new draws never blend in,
    // so the EMA stays at its starting value forever. Initial drift = 0 →
    // every output is identity (already covered above); start non-zero and
    // verify the EMA doesn't move.
    auto rng = seedRng(8);
    DriftState d{};
    d.vel = 0.42;
    d.gate = -0.13;
    d.time = 0.07;
    auto args = defaultArgs();
    args.velocity = 1.0;
    args.gate = 1.0;
    args.timing = 1.0;
    args.driftFactor = 1.0;

    for (int i = 0; i < 100; ++i) (void) composeHumanize(rng, d, args);

    // Equality is the spec — factor=1.0 is exact freeze, no rounding noise.
    REQUIRE(d.vel == 0.42);
    REQUIRE(d.gate == -0.13);
    REQUIRE(d.time == 0.07);
}
