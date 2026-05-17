// Pointsman humanize layer — v2 single-amp (feel) surface.
//
// concept.md §"Per-event humanize":
//   - feel (0..1): one amplitude drives signed uniform noise on three
//     independently-drawn axes (velocity, gate, timing). Single control
//     instead of three lets the user dial "how much human" without
//     balancing three sliders.
//   - drift (0..1): EMA smoothing applied per-axis (not collapsed —
//     would phase-lock and sound artificial). 1.0 freezes the layer.
//
// Timing offset is bounded to ±0.5 × source step length.

import { nextU32, type RngState } from "../engine/rng.ts";

export interface DriftState {
  vel: number;  // smoothed velocity offset, signed
  gate: number; // smoothed gate offset, signed
  time: number; // smoothed timing offset, signed (in step-fractions, ±0.5 max)
}

export const NEUTRAL_DRIFT: DriftState = { vel: 0, gate: 0, time: 0 };

// Uniform signed noise in [-amplitude, +amplitude). Half-open at the upper
// bound because the underlying u32 → [-1, +1) remap excludes +1 exactly.
// Always consumes one nextU32 — even amplitude=0 advances the RNG, so the
// per-axis draw order in composeHumanize stays deterministic regardless of
// which amplitudes are zero.
export function draw(
  rng: RngState,
  amplitude: number,
): { value: number; state: RngState } {
  const u = nextU32(rng);
  const signed = u.value / 0x80000000 - 1; // [-1, +1)
  return { value: signed * amplitude, state: u.state };
}

// EMA smoothing: factor*prev + (1-factor)*raw. Single-pole low-pass over the
// per-event raw draws, parameterized by the drift dial.
export function drift(prev: number, raw: number, factor: number): number {
  return factor * prev + (1 - factor) * raw;
}

export interface ComposeArgs {
  feel: number;                // 0..1 single amplitude
  drift: number;               // 0..1 EMA factor per-axis
  inputVelocity: number;       // 1..127
  sourceStepDuration: number;  // ms
}

export interface ComposeResult {
  velocityFinal: number; // 1..127 integer
  gateFinal: number;     // 0..1
  timingOffset: number;  // ms (signed)
  rng: RngState;
  driftState: DriftState;
}

// Per-event composition. Draw order: velocity → gate → timing (binding for
// cross-target reproducibility against vst Source/Engine/Humanize). Drift
// state always advances even when drift factor = 0, so toggling the dial
// mid-session does not desync.
export function composeHumanize(
  rng: RngState,
  driftState: DriftState,
  args: ComposeArgs,
): ComposeResult {
  const dv = draw(rng, args.feel);
  const dg = draw(dv.state, args.feel);
  const dt = draw(dg.state, args.feel);

  const rawVel = dv.value;
  const rawGate = dg.value;
  const rawTime = dt.value * 0.5; // concept.md §"Per-event humanize": ±0.5 step

  const newDrift: DriftState = {
    vel: drift(driftState.vel, rawVel, args.drift),
    gate: drift(driftState.gate, rawGate, args.drift),
    time: drift(driftState.time, rawTime, args.drift),
  };

  const usedVel = args.drift > 0 ? newDrift.vel : rawVel;
  const usedGate = args.drift > 0 ? newDrift.gate : rawGate;
  const usedTime = args.drift > 0 ? newDrift.time : rawTime;

  const velRaw = Math.round(args.inputVelocity * (1 + usedVel));
  const velocityFinal = clamp1to127(velRaw);
  // outputGateBase was always 1.0 in v1; inlined here for the single
  // remaining gate-final formula.
  const gateFinal = clamp01(1.0 * (1 + usedGate));
  const timingRaw = usedTime * args.sourceStepDuration;
  // Normalize -0 → +0 so callers / tests can compare with strict equality.
  const timingOffset = timingRaw === 0 ? 0 : timingRaw;

  return {
    velocityFinal,
    gateFinal,
    timingOffset,
    rng: dt.state,
    driftState: newDrift,
  };
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function clamp1to127(x: number): number {
  if (x < 1) return 1;
  if (x > 127) return 127;
  return x;
}
