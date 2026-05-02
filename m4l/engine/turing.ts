// Turing Machine engine — pure functions per ADR 001.
// xoshiro128++ PRNG with SplitMix64 seeding (Vigna).
// Cross-target conformance vectors: docs/ai/turing-test-vectors.json

export type RegisterBits = number; // u32, low `length` bits hold the state
export type Length = number; // 2..32
export type RngState = readonly [number, number, number, number]; // u32 quad

const U64 = (1n << 64n) - 1n;
const U32_BIG = (1n << 32n) - 1n;

function maskBits(length: Length): number {
  if (length >= 32) return 0xffffffff;
  return ((1 << length) - 1) >>> 0;
}

// ============================================================
// SplitMix64 (Vigna) — used only for seeding.
// ============================================================

function splitMix64Next(state: bigint): { value: bigint; state: bigint } {
  const newState = (state + 0x9e3779b97f4a7c15n) & U64;
  let z = newState;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & U64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & U64;
  z = (z ^ (z >> 31n)) & U64;
  return { value: z, state: newState };
}

// Seeding convention (canonical, see turing-test-vectors.json meta):
//   call SplitMix64 twice; split each output u64 into [low32, high32].
//   s = [low(z1), high(z1), low(z2), high(z2)]
export function seedRng(seed: bigint): RngState {
  let st = seed & U64;
  const r1 = splitMix64Next(st);
  st = r1.state;
  const r2 = splitMix64Next(st);
  return [
    Number(r1.value & U32_BIG),
    Number((r1.value >> 32n) & U32_BIG),
    Number(r2.value & U32_BIG),
    Number((r2.value >> 32n) & U32_BIG),
  ];
}

// ============================================================
// xoshiro128++ (Vigna 2019)
// ============================================================

function rotl32(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function nextU32(rng: RngState): { value: number; state: RngState } {
  const result = ((rotl32((rng[0] + rng[3]) >>> 0, 7) + rng[0]) >>> 0);
  const t = (rng[1] << 9) >>> 0;
  let s0 = rng[0], s1 = rng[1], s2 = rng[2], s3 = rng[3];
  s2 = (s2 ^ s0) >>> 0;
  s3 = (s3 ^ s1) >>> 0;
  s1 = (s1 ^ s2) >>> 0;
  s0 = (s0 ^ s3) >>> 0;
  s2 = (s2 ^ t) >>> 0;
  s3 = rotl32(s3, 11);
  return { value: result, state: [s0, s1, s2, s3] };
}

// Probability threshold for u32-space comparison.
// rawU32 < threshold ⇔ (rawU32 / 2^32) < probability
function probabilityThreshold(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 0x100000000;
  return Math.floor(p * 0x100000000);
}

// ============================================================
// TM core
// ============================================================

export function createRegister(
  length: Length,
  rng: RngState,
): { register: RegisterBits; state: RngState } {
  const r = nextU32(rng);
  return { register: (r.value & maskBits(length)) >>> 0, state: r.state };
}

export function shiftAndFlip(
  register: RegisterBits,
  length: Length,
  lock: number,
  rng: RngState,
): { register: RegisterBits; state: RngState } {
  const tail = register & 1;
  const draw = nextU32(rng);
  const threshold = probabilityThreshold(1 - lock);
  const flip = draw.value < threshold;
  const writeBit = flip ? (tail ^ 1) : tail;
  const shifted = register >>> 1;
  const result = (shifted | (writeBit << (length - 1))) & maskBits(length);
  return { register: result >>> 0, state: draw.state };
}

export function shiftAndForce(
  register: RegisterBits,
  length: Length,
  forceBit: 0 | 1,
): RegisterBits {
  const shifted = register >>> 1;
  return ((shifted | ((forceBit & 1) << (length - 1))) & maskBits(length)) >>> 0;
}

export function registerToFraction(
  register: RegisterBits,
  length: Length,
): { num: number; den: number } {
  const den = length >= 32 ? 0xffffffff : (((1 << length) - 1) >>> 0);
  return { num: register, den };
}

// floor(lo + (num/den) × (hi - lo + 1)), clamped to hi.
// Computed as (num × span) / den (integer-first) to avoid float drift.
export function mapToNote(
  num: number,
  den: number,
  lo: number,
  hi: number,
): number {
  const span = hi - lo + 1;
  const offset = Math.floor((num * span) / den);
  return Math.min(lo + offset, hi);
}

// ============================================================
// Step composition
// ============================================================

export interface TmState {
  register: RegisterBits;
  rng: RngState;
}

export interface TmParams {
  length: Length;
  lock: number;
  density: number;
  range: readonly [number, number];
}

export interface TmStepResult {
  state: TmState;
  output: { note: number; active: boolean };
}

export function tmStep(state: TmState, params: TmParams): TmStepResult {
  const f = registerToFraction(state.register, params.length);
  const note = mapToNote(f.num, f.den, params.range[0], params.range[1]);
  // Density draw FIRST, then flip draw — fixed for cross-target reproducibility.
  const dDraw = nextU32(state.rng);
  const dThreshold = probabilityThreshold(params.density);
  const active = dDraw.value < dThreshold;
  const sf = shiftAndFlip(state.register, params.length, params.lock, dDraw.state);
  return {
    state: { register: sf.register, rng: sf.state },
    output: { note, active },
  };
}
