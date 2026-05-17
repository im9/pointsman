// Tests for host/humanize.ts — Phase 5 v2 feel/drift contract.
// Spec: docs/ai/concept.md §"Per-event humanize"
//
// v2 collapses humanizeVelocity/Gate/Timing into a single `feel` amplitude
// driving three independent draws (velocity / gate / timing axes). drift is
// the EMA factor applied per-axis (no shared smoothing — would phase-lock).
//
// Threshold derivation rule (CLAUDE.md global): every numeric assertion is
// justified inline against the spec or first-principles derivation.

import { test } from "node:test";
import assert from "node:assert/strict";

import { nextU32, seedRng, type RngState } from "../engine/rng.ts";
import {
  composeHumanize,
  draw,
  drift,
  NEUTRAL_DRIFT,
  type DriftState,
  type ComposeArgs,
} from "./humanize.ts";

// ---------- draw ----------

test("draw — amplitude=0 returns exactly 0; rng still advances", () => {
  // Spec: draw is uniform signed noise on [-amp, +amp]. amp=0 collapses to 0.
  // RNG must still advance for deterministic order across axes (a zero-amp
  // axis still consumes one nextU32 — see composeHumanize draw-order test).
  const rng0: RngState = seedRng(42n);
  const r = draw(rng0, 0);
  assert.equal(r.value, 0);
  assert.notDeepEqual(r.state, rng0);
});

test("draw — amplitude=1 yields value in [-1, +1)", () => {
  // Spec: uniform signed noise in [-amp, +amp]. Half-open upper bound
  // because the underlying u32 range is [0, 2^32) and the linear remap
  // (u/2^31 - 1) lands in [-1, +1).
  const rng = seedRng(7n);
  const r = draw(rng, 1);
  assert.ok(r.value >= -1 && r.value < 1, `value ${r.value} out of [-1,1)`);
});

test("draw — amplitude=0.25 yields value in [-0.25, +0.25)", () => {
  // Linear scaling of the [-1, +1) base by amplitude.
  let rng = seedRng(123n);
  for (let i = 0; i < 50; i++) {
    const r = draw(rng, 0.25);
    assert.ok(
      r.value >= -0.25 && r.value < 0.25,
      `iter ${i}: value ${r.value} out of [-0.25, 0.25)`,
    );
    rng = r.state;
  }
});

test("draw — produces both signs across many samples", () => {
  // Sanity: signed noise must visit both half-planes. With 200 uniform
  // samples on [-1, 1), prob of all-positive is 2^-200 ≈ 6e-61.
  let rng = seedRng(1n);
  let sawPos = false;
  let sawNeg = false;
  for (let i = 0; i < 200; i++) {
    const r = draw(rng, 1);
    if (r.value > 0) sawPos = true;
    if (r.value < 0) sawNeg = true;
    rng = r.state;
  }
  assert.ok(sawPos, "expected at least one positive sample");
  assert.ok(sawNeg, "expected at least one negative sample");
});

// ---------- drift ----------

test("drift — factor=0 returns raw (no smoothing)", () => {
  // Spec EMA: result = factor*prev + (1-factor)*raw. factor=0 → raw.
  assert.equal(drift(0.5, 0.2, 0), 0.2);
  assert.equal(drift(-0.7, 0.4, 0), 0.4);
});

test("drift — factor=1 returns prev (full smoothing, raw ignored)", () => {
  // factor=1 → prev. concept.md §"Per-event humanize": 1.0 exactly is
  // degenerate (EMA never blends a new draw, layer freezes); useful contract
  // here is just that the math is symmetric.
  assert.equal(drift(0.5, 0.2, 1), 0.5);
  assert.equal(drift(-0.7, 0.4, 1), -0.7);
});

test("drift — factor=0.5 returns midpoint", () => {
  // 0.5*prev + 0.5*raw — algebraic midpoint. Compare with FP epsilon since
  // the IEEE-754 result of 0.5*0.4 + 0.5*0.2 is 0.30000000000000004, not 0.3.
  // Threshold 1e-12 is well above double-precision rounding noise (~2e-16)
  // and well below any musically-meaningful drift value.
  assert.ok(Math.abs(drift(0.4, 0.2, 0.5) - 0.3) < 1e-12);
  assert.ok(Math.abs(drift(1.0, 0.0, 0.5) - 0.5) < 1e-12);
});

// ---------- composeHumanize ----------

function defaultArgs(overrides: Partial<ComposeArgs> = {}): ComposeArgs {
  return {
    feel: 0,
    drift: 0,
    inputVelocity: 100,
    sourceStepDuration: 100, // ms — arbitrary nonzero unit for offset arithmetic
    ...overrides,
  };
}

test("composeHumanize — feel=0 yields identity-ish output", () => {
  // rawVel = rawGate = rawTime = 0 → smoothed = 0 → identity composition:
  //   velocityFinal = inputVelocity
  //   gateFinal     = 1.0 (full gate, the v1 outputGateBase)
  //   timingOffset  = 0
  const rng = seedRng(42n);
  const r = composeHumanize(rng, NEUTRAL_DRIFT, defaultArgs());
  assert.equal(r.velocityFinal, 100);
  assert.equal(r.gateFinal, 1.0);
  assert.equal(r.timingOffset, 0);
});

test("composeHumanize — velocity clamps to 127 ceiling", () => {
  // inputVel=127 + smoothedVel=0.5 (drifted to constant via factor=1) →
  //   raw arithmetic = 127 * 1.5 = 190.5 → round 191 → clamp 127.
  const rng = seedRng(42n);
  const drifted: DriftState = { vel: 0.5, gate: 0, time: 0 };
  const r = composeHumanize(
    rng,
    drifted,
    defaultArgs({ inputVelocity: 127, drift: 1 }),
  );
  // Threshold 127 = MIDI velocity max (concept.md §"MIDI semantics").
  assert.equal(r.velocityFinal, 127);
});

test("composeHumanize — velocity clamps to 1 floor (never 0)", () => {
  // inputVel=1 with smoothedVel=-0.99 → raw arithmetic = 1 * 0.01 = 0.01
  // → round 0 → clamp 1. v=0 in MIDI is a noteOff, so noteOn must lift to 1.
  const rng = seedRng(42n);
  const drifted: DriftState = { vel: -0.99, gate: 0, time: 0 };
  const r = composeHumanize(
    rng,
    drifted,
    defaultArgs({ inputVelocity: 1, drift: 1 }),
  );
  // Threshold 1 = MIDI velocity floor for noteOn (concept.md §"MIDI semantics").
  assert.equal(r.velocityFinal, 1);
});

test("composeHumanize — gate clamped to [0, 1]", () => {
  // Pre-drift smoothedGate=0.7 + outputGateBase=1.0 → 1.7 → clamp 1.0.
  // Pre-drift smoothedGate=-1.5 + outputGateBase=1.0 → -0.5 → clamp 0.0.
  const rng = seedRng(42n);
  const high: DriftState = { vel: 0, gate: 0.7, time: 0 };
  const r1 = composeHumanize(rng, high, defaultArgs({ drift: 1 }));
  assert.equal(r1.gateFinal, 1.0);

  const low: DriftState = { vel: 0, gate: -1.5, time: 0 };
  const r2 = composeHumanize(rng, low, defaultArgs({ drift: 1 }));
  assert.equal(r2.gateFinal, 0);
});

test("composeHumanize — timing scaled by 0.5 step then sourceStepDuration", () => {
  // Spec: timing range is ±0.5 × source step length (concept.md §"Per-event
  // humanize"). rawTime = draw(rng, feel) * 0.5, timingOffset = rawTime
  // * sourceStepDuration. Verify against manually-computed third draw from
  // the same RNG seed (compose draws velocity then gate then timing).
  const seed = 42n;

  // Manually replay the three nextU32 calls compose makes.
  let manualRng = seedRng(seed);
  const u1 = nextU32(manualRng); manualRng = u1.state; // velocity
  const u2 = nextU32(manualRng); manualRng = u2.state; // gate
  const u3 = nextU32(manualRng); manualRng = u3.state; // timing
  // draw() maps u32 → [-1, +1) via (u / 2^31) - 1.
  const rawTimeBase = u3.value / 0x80000000 - 1;
  const expectedRawTime = rawTimeBase * 1.0 * 0.5; // feel=1, then ±0.5 step scale
  const expectedOffset = expectedRawTime * 250;    // sourceStepDuration

  const r = composeHumanize(
    seedRng(seed),
    NEUTRAL_DRIFT,
    defaultArgs({ feel: 1, sourceStepDuration: 250 }),
  );
  assert.equal(r.timingOffset, expectedOffset);
});

test("composeHumanize — draw order is velocity → gate → timing", () => {
  // Binding for cross-target reproducibility (vst Source/Engine/Humanize
  // matches this order). Verify by comparing the velocity-axis perturbation
  // against the FIRST nextU32 sample, gate against SECOND, timing against
  // THIRD. v2 uses a single `feel` amp scaling all three.
  const seed = 99n;

  // Manual replay.
  let m = seedRng(seed);
  const a = nextU32(m); m = a.state;
  const b = nextU32(m); m = b.state;
  const c = nextU32(m); m = c.state;
  const aSigned = a.value / 0x80000000 - 1;
  const bSigned = b.value / 0x80000000 - 1;
  const cSigned = c.value / 0x80000000 - 1;

  // feel=1, neutral drift, drift=0 → output uses raw values directly.
  // velocityFinal = round(inputVelocity * (1 + aSigned))
  // gateFinal     = clamp01(1.0 * (1 + bSigned))
  // timingOffset  = (cSigned * 0.5) * sourceStepDuration
  const r = composeHumanize(
    seedRng(seed),
    NEUTRAL_DRIFT,
    defaultArgs({
      feel: 1,
      inputVelocity: 100,
      sourceStepDuration: 100,
    }),
  );

  const expectedVel = Math.max(1, Math.min(127, Math.round(100 * (1 + aSigned))));
  const expectedGate = Math.max(0, Math.min(1, 1.0 * (1 + bSigned)));
  const expectedOffset = cSigned * 0.5 * 100;

  assert.equal(r.velocityFinal, expectedVel);
  assert.equal(r.gateFinal, expectedGate);
  assert.equal(r.timingOffset, expectedOffset);
});

test("composeHumanize — drift=0 still updates drift state (desync safety)", () => {
  // Spec: drift state advances even when factor=0 so toggling the dial
  // mid-session does not desync. Output uses the raw value.
  const rng = seedRng(11n);
  const r1 = composeHumanize(
    rng,
    NEUTRAL_DRIFT,
    defaultArgs({ feel: 1, drift: 0 }),
  );
  // After one call, driftState reflects the raw draws (since factor=0
  // EMA = raw). Probability all three draws are exactly 0 is 2^-96.
  const moved =
    r1.driftState.vel !== 0 ||
    r1.driftState.gate !== 0 ||
    r1.driftState.time !== 0;
  assert.ok(moved, "drift state must advance even when factor=0");
});

test("composeHumanize — drift=1 with neutral drift outputs identity", () => {
  // factor=1 → smoothed = prev (= 0 for NEUTRAL_DRIFT) regardless of raw.
  // Output collapses to the identity case (same as feel=0).
  // concept.md notes 1.0 is degenerate ("layer freezes at current value");
  // starting from NEUTRAL_DRIFT and factor=1 it freezes at neutral = identity.
  const rng = seedRng(42n);
  const r = composeHumanize(
    rng,
    NEUTRAL_DRIFT,
    defaultArgs({ feel: 1, drift: 1 }),
  );
  assert.equal(r.velocityFinal, 100);
  assert.equal(r.gateFinal, 1.0);
  assert.equal(r.timingOffset, 0);
});

test("composeHumanize — feel=0 collapses all three axes (no perturbation)", () => {
  // The single-amp collapse: feel=0 means no humanize, period — regardless of
  // drift factor. Identity output, same as the all-amp-zero v1 case.
  const rng = seedRng(13n);
  const r = composeHumanize(
    rng,
    NEUTRAL_DRIFT,
    defaultArgs({ feel: 0, drift: 0.5, inputVelocity: 80 }),
  );
  assert.equal(r.velocityFinal, 80);
  assert.equal(r.gateFinal, 1.0);
  assert.equal(r.timingOffset, 0);
});

test("composeHumanize — three axes draw independently (not phase-locked)", () => {
  // concept.md §"Per-event humanize": axes are not collapsed to a single
  // shared draw — that would phase-lock and sound artificial. Verify the
  // velocity / gate / timing perturbations are NOT proportional to each
  // other across a single call (would indicate one draw scaled three ways).
  const seed = 31n;
  const r = composeHumanize(
    seedRng(seed),
    NEUTRAL_DRIFT,
    defaultArgs({ feel: 1, inputVelocity: 100, sourceStepDuration: 1000 }),
  );
  // Recover the three signed raws from outputs (each axis has its own
  // scaling). If all three came from one draw d:
  //   rawVel = d, rawGate = d, rawTime = d
  // Then velocityFinal/100 - 1 ≈ d, gateFinal - 1 ≈ d, timingOffset/500 = d.
  // Compute and check they DO NOT all equal d.
  const rawVel = (r.velocityFinal / 100) - 1;          // approximate, integer round noise
  const rawGate = r.gateFinal - 1;
  const rawTime = r.timingOffset / 500;                 // /(0.5 * 1000)
  // Threshold 0.01: integer-round on velocity introduces ~1/100 = 0.01
  // error vs exact, so a single-draw scenario would have the three values
  // agree within 0.01. Independent draws diverge by orders of magnitude
  // more than that w.h.p. (3 uniform draws on [-1,1) agree to 0.01 with
  // prob ≈ (0.02)^2 = 4e-4).
  const agreeVelGate = Math.abs(rawVel - rawGate) < 0.01;
  const agreeGateTime = Math.abs(rawGate - rawTime) < 0.01;
  assert.ok(!(agreeVelGate && agreeGateTime),
    `axes appear phase-locked: vel=${rawVel} gate=${rawGate} time=${rawTime}`);
});

test("composeHumanize — reproducibility: same inputs yield same outputs", () => {
  // Determinism is a binding contract for cross-target test vectors.
  const a = composeHumanize(
    seedRng(42n),
    { ...NEUTRAL_DRIFT },
    defaultArgs({ feel: 0.5, drift: 0.3 }),
  );
  const b = composeHumanize(
    seedRng(42n),
    { ...NEUTRAL_DRIFT },
    defaultArgs({ feel: 0.5, drift: 0.3 }),
  );
  assert.deepEqual(a, b);
});

test("composeHumanize — rng advances by exactly 3 draws per call", () => {
  // velocity / gate / timing are three independent nextU32 consumptions.
  // Verify the returned rng matches a hand-rolled 3-step advance.
  const seed = 5n;
  const r = composeHumanize(
    seedRng(seed),
    NEUTRAL_DRIFT,
    defaultArgs({ feel: 1 }),
  );
  let m = seedRng(seed);
  m = nextU32(m).state;
  m = nextU32(m).state;
  m = nextU32(m).state;
  assert.deepEqual(r.rng, m);
});
