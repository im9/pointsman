// scripts/gen-test-vectors/prng.mjs
//
// PRNG reference implementation: SplitMix64 (seeding) + xoshiro128++.
// Pure, deterministic. Produces the canonical bit-exact values that
// m4l/engine/rng.ts and vst/Source/<rng>.cpp must reproduce.
//
// References:
//   xoshiro128++  https://prng.di.unimi.it/xoshiro128plusplus.c
//   SplitMix64    https://prng.di.unimi.it/splitmix64.c

const U64 = (1n << 64n) - 1n;
const U32_BIG = (1n << 32n) - 1n;

export function splitMix64Next(state) {
  // state: bigint u64. Returns { value: u64, state: u64 } both as bigint.
  const newState = (state + 0x9e3779b97f4a7c15n) & U64;
  let z = newState;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & U64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & U64;
  z = (z ^ (z >> 31n)) & U64;
  return { value: z, state: newState };
}

// Seeding convention (CANONICAL — see meta in rng-test-vectors.json):
//   call SplitMix64 twice, splitting each u64 into [low32, high32]:
//     s = [low(z1), high(z1), low(z2), high(z2)]
export function xoshiroSeed(seedU64) {
  let st = seedU64 & U64;
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

function rotl32(x, k) {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

// Pure: takes state, returns new { value, state }. Does not mutate input.
export function xoshiroNext(s) {
  const result = ((rotl32((s[0] + s[3]) >>> 0, 7) + s[0]) >>> 0);
  const t = (s[1] << 9) >>> 0;
  const ns = [s[0], s[1], s[2], s[3]];
  ns[2] = (ns[2] ^ ns[0]) >>> 0;
  ns[3] = (ns[3] ^ ns[1]) >>> 0;
  ns[1] = (ns[1] ^ ns[2]) >>> 0;
  ns[0] = (ns[0] ^ ns[3]) >>> 0;
  ns[2] = (ns[2] ^ t) >>> 0;
  ns[3] = rotl32(ns[3], 11);
  return { value: result, state: ns };
}

// ============================================================
// Hex / seed formatting helpers (used by case-emission JSON)
// ============================================================

export function hexU32(n) {
  return "0x" + (n >>> 0).toString(16).padStart(8, "0");
}
export function hexU64(big) {
  return "0x" + (big & U64).toString(16).padStart(16, "0");
}
export function seedField(big) {
  return { decimal: big.toString(), hex: hexU64(big) };
}

// ============================================================
// PRNG case generators
// ============================================================

const SEEDS = [0n, 1n, 0xdeadbeefn, 0x123456789abcdef0n];

export function genSplitMix64InitCases() {
  return SEEDS.map((seed) => {
    const r1 = splitMix64Next(seed);
    const r2 = splitMix64Next(r1.state);
    const sm_outputs = [
      { value_hex: hexU64(r1.value), value_decimal: r1.value.toString() },
      { value_hex: hexU64(r2.value), value_decimal: r2.value.toString() },
    ];
    const s = xoshiroSeed(seed);
    return {
      seed: seedField(seed),
      splitmix64_outputs: sm_outputs,
      xoshiro_state_s: s.map((w) => ({ hex: hexU32(w), decimal: w })),
    };
  });
}

export function genPrngCases() {
  const N_DRAWS = 8;
  return SEEDS.map((seed) => {
    let s = xoshiroSeed(seed);
    const draws = [];
    for (let i = 0; i < N_DRAWS; i++) {
      const r = xoshiroNext(s);
      s = r.state;
      draws.push({ hex: hexU32(r.value), decimal: r.value });
    }
    return { seed: seedField(seed), draws };
  });
}
