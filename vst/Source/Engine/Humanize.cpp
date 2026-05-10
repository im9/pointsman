#include "Humanize.h"

#include <cmath>

namespace pointsman
{
    namespace
    {
        // JS Math.round: "half toward positive infinity". std::round is
        // "half away from zero", which differs for negative half-cases.
        // Match JS exactly to keep cross-target reproducibility intact even
        // when raw arithmetic dips negative (it shouldn't for velocity, but
        // the contract is explicit so we don't accidentally diverge later).
        inline int jsMathRound(double x) noexcept
        {
            return static_cast<int>(std::floor(x + 0.5));
        }

        inline double clamp01(double x) noexcept
        {
            if (x < 0.0) return 0.0;
            if (x > 1.0) return 1.0;
            return x;
        }

        inline int clamp1to127(int x) noexcept
        {
            if (x < 1) return 1;
            if (x > 127) return 127;
            return x;
        }
    }

    double draw(RngState& rng, double amplitude) noexcept
    {
        const uint32_t u = nextU32(rng);
        // Linear remap u32 → [-1, +1). 0x80000000 = 2^31.
        const double signed01 = static_cast<double>(u) / 2147483648.0 - 1.0;
        return signed01 * amplitude;
    }

    ComposeResult composeHumanize(RngState& rng,
                                  DriftState& driftState,
                                  const ComposeArgs& args) noexcept
    {
        const double rawVel  = draw(rng, args.velocity);
        const double rawGate = draw(rng, args.gate);
        const double rawTime = draw(rng, args.timing) * 0.5; // ±0.5 step

        DriftState newDrift{};
        newDrift.vel  = drift(driftState.vel,  rawVel,  args.driftFactor);
        newDrift.gate = drift(driftState.gate, rawGate, args.driftFactor);
        newDrift.time = drift(driftState.time, rawTime, args.driftFactor);

        const double usedVel  = (args.driftFactor > 0.0) ? newDrift.vel  : rawVel;
        const double usedGate = (args.driftFactor > 0.0) ? newDrift.gate : rawGate;
        const double usedTime = (args.driftFactor > 0.0) ? newDrift.time : rawTime;

        driftState = newDrift;

        ComposeResult r{};
        const double velRaw =
            static_cast<double>(args.inputVelocity) * (1.0 + usedVel) * args.outputLevel;
        r.velocityFinal = clamp1to127(jsMathRound(velRaw));
        r.gateFinal = clamp01(args.outputGateBase * (1.0 + usedGate));
        const double timingRaw = usedTime * args.sourceStepDuration;
        // Normalize -0 → +0 so callers / tests can compare with strict equality.
        r.timingOffset = (timingRaw == 0.0) ? 0.0 : timingRaw;
        return r;
    }
}
