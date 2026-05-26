// scripts/gen-test-vectors/arp.mjs
//
// ADR 004 arpeggiator: rate parsing, pattern cursor advancement, step
// resolution, plus (TODO) the variation cascade, the groove cascade,
// and the slide-aware noteOff scheduler.
//
// All functions are pure — no globals, no RNG state, no allocation
// beyond return objects. The arpeggiator clock and pool maintenance
// (mid-hold rebuilds, mode-switch panics) live in the host integration
// layer, not here.

// ============================================================
// Arpeggiator rate
// ============================================================

// Append-only enum. Order is the on-disk index used by APVTS / live.menu.
// Each rate is a step duration expressed in **quarter notes**:
//   base = { "1/4": 1.0, "1/8": 0.5, "1/16": 0.25, "1/32": 0.125 }
//   dotted (D) = base × 1.5
//   triplet (T) = base × 2/3
// Triplet values are rationals — kept as exact fractions in JSON so the
// target engines avoid float-precision drift when reconstructing the
// sample-count per tick at runtime.
export const ARP_RATES = [
  { name: "1/4",   quarters_num: 1, quarters_den: 1 },   //  0
  { name: "1/4D",  quarters_num: 3, quarters_den: 2 },   //  1
  { name: "1/4T",  quarters_num: 2, quarters_den: 3 },   //  2
  { name: "1/8",   quarters_num: 1, quarters_den: 2 },   //  3
  { name: "1/8D",  quarters_num: 3, quarters_den: 4 },   //  4
  { name: "1/8T",  quarters_num: 1, quarters_den: 3 },   //  5
  { name: "1/16",  quarters_num: 1, quarters_den: 4 },   //  6 — default
  { name: "1/16D", quarters_num: 3, quarters_den: 8 },   //  7
  { name: "1/16T", quarters_num: 1, quarters_den: 6 },   //  8
  { name: "1/32",  quarters_num: 1, quarters_den: 8 },   //  9
];

// Pure: returns { num, den } rational of quarter notes per arp step.
export function parseArpRate(rate) {
  const entry = typeof rate === "number" ? ARP_RATES[rate] :
                ARP_RATES.find((r) => r.name === rate);
  if (!entry) throw new Error(`unknown arp rate: ${rate}`);
  return { num: entry.quarters_num, den: entry.quarters_den };
}

export function genParseArpRateCases() {
  const cases = [];
  for (let i = 0; i < ARP_RATES.length; i++) {
    const e = ARP_RATES[i];
    cases.push({
      label: e.name,
      rate_index: i,
      rate_name: e.name,
      expected_quarters: { num: e.quarters_num, den: e.quarters_den },
      // Also include the decimal form for human-readable diffs. Target
      // engines must derive from the fraction, not the decimal.
      decimal_reference: e.quarters_num / e.quarters_den,
    });
  }
  return cases;
}

// ============================================================
// Arpeggiator pattern index + step resolution
// ============================================================

// Append-only enum. Index used by APVTS / live.menu.
export const ARP_PATTERNS = ["up", "down", "up-down", "random", "as-played", "strike"];

// Pure: advances the arp cursor by one tick.
//
// Inputs:
//   pattern      — one of ARP_PATTERNS
//   state        — { index, round, repeatTick, direction }
//                  direction is +1 or -1, used only by up-down
//   poolSize     — current pool size (number of voices)
//   octaves      — arpOctaves (1..4)
//   stepRepeats  — arpStepRepeats (1..8)
//   rngDraw01    — a [0, 1) RNG draw; consumed only by pattern == "random"
//
// Output: the new state. Initial state is
//   { index: 0, round: 0, repeatTick: 0, direction: +1 }
// and the FIRST tick after transport-start consumes pattern position
// `index = 0, round = 0`; this function is called to advance AFTER
// the emission at the current state has been scheduled. So the
// emission sequence is: emit(state) → state = nextArpIndex(...) →
// emit(state) → ...
//
// Edge cases:
//   - poolSize == 0: state is returned unchanged (no advance). The
//     caller is expected to short-circuit to "rest" emission.
//   - stepRepeats == 0: treated as 1 (defensive — UI clamps to 1..8).
//   - For strike, index is always 0 (only one position per cycle).
//     The round still advances after each stepRepeats group of ticks.
export function nextArpIndex(pattern, state, poolSize, octaves, stepRepeats, rngDraw01) {
  if (poolSize === 0) return { ...state };
  const sr = Math.max(1, stepRepeats);
  const oc = Math.max(1, octaves);

  // Sub-tick within the held step.
  const nextRepeat = state.repeatTick + 1;
  if (nextRepeat < sr) {
    return { index: state.index, round: state.round, repeatTick: nextRepeat,
             direction: state.direction };
  }

  // Step boundary — advance the pattern position.
  let newIndex = state.index;
  let newRound = state.round;
  let newDirection = state.direction;

  switch (pattern) {
    case "up": {
      newIndex = state.index + 1;
      if (newIndex >= poolSize) {
        newIndex = 0;
        newRound = (state.round + 1) % oc;
      }
      break;
    }
    case "down": {
      newIndex = state.index - 1;
      if (newIndex < 0) {
        newIndex = poolSize - 1;
        newRound = (state.round + 1) % oc;
      }
      break;
    }
    case "up-down": {
      // Endpoints visited once per excursion: 0,1,...,N-1,N-2,...,1,0,1,...
      // direction flips at endpoints. Pool size 1 → always index 0,
      // direction unchanged.
      if (poolSize === 1) {
        newIndex = 0;
        // Round advances every tick (a 1-voice pool's cycle is 1 tick).
        newRound = (state.round + 1) % oc;
        break;
      }
      let candidate = state.index + state.direction;
      if (candidate >= poolSize) {
        // Bounce down off the top: index -> N-2, direction -> -1.
        candidate = poolSize - 2;
        newDirection = -1;
      } else if (candidate < 0) {
        // Bounce up off the bottom: index -> 1, direction -> +1.
        // Also: completing a full excursion (top → bottom → next-step-up)
        // is when the round advances.
        candidate = 1;
        newDirection = 1;
        newRound = (state.round + 1) % oc;
      }
      newIndex = candidate;
      break;
    }
    case "random": {
      // Uses the supplied [0, 1) draw to pick uniformly over pool size.
      newIndex = Math.min(poolSize - 1, Math.floor(rngDraw01 * poolSize));
      // Random has no positional structure; the octave round counter is
      // managed by the caller (e.g. tick-count modulo poolSize) and is
      // explicitly out of scope for nextArpIndex.
      break;
    }
    case "as-played": {
      // Identical advancement to "up" — the pool's insertion order is
      // baked in by the caller before this function sees the pool.
      newIndex = state.index + 1;
      if (newIndex >= poolSize) {
        newIndex = 0;
        newRound = (state.round + 1) % oc;
      }
      break;
    }
    case "strike": {
      // Index always 0; round advances every step boundary.
      newIndex = 0;
      newRound = (state.round + 1) % oc;
      break;
    }
    default:
      throw new Error(`unknown arp pattern: ${pattern}`);
  }

  return { index: newIndex, round: newRound, repeatTick: 0,
           direction: newDirection };
}

// Pure: resolves the current cursor to a set of emission pitches.
// Returns { kind: "emit", pitches: [...] } or { kind: "rest" }.
//
// For traversal patterns (up / down / up-down / random / as-played),
// returns a single voice — pool[index] shifted by octaveRound × 12.
// For "strike", returns the entire pool shifted uniformly.
//
// Any emission pitch above 127 is dropped (silent step rather than
// clamped — preserves chord shape integrity per ADR 004). If the
// resulting pitches array is empty (pool empty OR all voices shifted
// out of range), returns kind:rest.
export function resolveArpStep(pool, index, octaveRound, pattern) {
  if (pool.length === 0) return { kind: "rest" };
  const shift = octaveRound * 12;
  if (pattern === "strike") {
    const pitches = pool.map((p) => p + shift).filter((p) => p >= 0 && p <= 127);
    if (pitches.length === 0) return { kind: "rest" };
    return { kind: "emit", pitches };
  }
  const i = ((index % pool.length) + pool.length) % pool.length;
  const v = pool[i] + shift;
  if (v < 0 || v > 127) return { kind: "rest" };
  return { kind: "emit", pitches: [v] };
}

// ============================================================
// Arpeggiator pattern / resolution case generators
// ============================================================

export function genNextArpIndexCases() {
  const cases = [];
  const initial = { index: 0, round: 0, repeatTick: 0, direction: 1 };

  // (a) up, pool=3, octaves=1, sr=1 — one full cycle.
  {
    let st = { ...initial };
    const trace = [{ ...st }];
    for (let t = 0; t < 6; t++) {
      st = nextArpIndex("up", st, 3, 1, 1, 0);
      trace.push({ ...st });
    }
    cases.push({
      label: "up, pool=3, oct=1, sr=1 — 7-tick trace",
      pattern: "up", poolSize: 3, octaves: 1, stepRepeats: 1,
      initial: { ...initial },
      trace,
    });
  }
  // (b) up, pool=3, octaves=2, sr=1 — round advances 0→1→0 over 6 ticks.
  {
    let st = { ...initial };
    const trace = [{ ...st }];
    for (let t = 0; t < 7; t++) {
      st = nextArpIndex("up", st, 3, 2, 1, 0);
      trace.push({ ...st });
    }
    cases.push({
      label: "up, pool=3, oct=2, sr=1 — round wraps after 6 ticks",
      pattern: "up", poolSize: 3, octaves: 2, stepRepeats: 1,
      initial: { ...initial },
      trace,
    });
  }
  // (c) up, pool=3, sr=2 — each index held for 2 ticks.
  {
    let st = { ...initial };
    const trace = [{ ...st }];
    for (let t = 0; t < 7; t++) {
      st = nextArpIndex("up", st, 3, 1, 2, 0);
      trace.push({ ...st });
    }
    cases.push({
      label: "up, pool=3, oct=1, sr=2 — ratchet (each step held 2 ticks)",
      pattern: "up", poolSize: 3, octaves: 1, stepRepeats: 2,
      initial: { ...initial },
      trace,
    });
  }
  // (d) down, pool=3 — mirror of up.
  {
    let st = { index: 2, round: 0, repeatTick: 0, direction: 1 };
    const trace = [{ ...st }];
    for (let t = 0; t < 5; t++) {
      st = nextArpIndex("down", st, 3, 1, 1, 0);
      trace.push({ ...st });
    }
    cases.push({
      label: "down, pool=3, starts at index=2 — 6-tick trace",
      pattern: "down", poolSize: 3, octaves: 1, stepRepeats: 1,
      initial: { index: 2, round: 0, repeatTick: 0, direction: 1 },
      trace,
    });
  }
  // (e) up-down, pool=4 — endpoints visited once per excursion.
  // Sequence from index=0,direction=+1:
  //   tick0: index=0 (initial)
  //   advance: 1, 2, 3, 2, 1, 0, 1, ... (round advances at the "0,1" bounce)
  {
    let st = { ...initial };
    const trace = [{ ...st }];
    for (let t = 0; t < 8; t++) {
      st = nextArpIndex("up-down", st, 4, 1, 1, 0);
      trace.push({ ...st });
    }
    cases.push({
      label: "up-down, pool=4 — 9-tick trace, bounces at endpoints",
      pattern: "up-down", poolSize: 4, octaves: 1, stepRepeats: 1,
      initial: { ...initial },
      trace,
    });
  }
  // (f) up-down, pool=1 — degenerate, always index 0.
  {
    let st = { ...initial };
    const trace = [{ ...st }];
    for (let t = 0; t < 3; t++) {
      st = nextArpIndex("up-down", st, 1, 2, 1, 0);
      trace.push({ ...st });
    }
    cases.push({
      label: "up-down, pool=1, oct=2 — degenerate, round still advances",
      pattern: "up-down", poolSize: 1, octaves: 2, stepRepeats: 1,
      initial: { ...initial },
      trace,
    });
  }
  // (g) random — single-tick test with known draws.
  // poolSize=5, draws 0.0 / 0.2 / 0.99 → indices 0, 1, 4.
  cases.push({
    label: "random, pool=5, draw=0.00 → index=0",
    pattern: "random", poolSize: 5, octaves: 1, stepRepeats: 1,
    initial: { ...initial }, rngDraw01: 0.0,
    expected: nextArpIndex("random", initial, 5, 1, 1, 0.0),
  });
  cases.push({
    label: "random, pool=5, draw=0.2 → index=1",
    pattern: "random", poolSize: 5, octaves: 1, stepRepeats: 1,
    initial: { ...initial }, rngDraw01: 0.2,
    expected: nextArpIndex("random", initial, 5, 1, 1, 0.2),
  });
  cases.push({
    label: "random, pool=5, draw=0.99 → index=4",
    pattern: "random", poolSize: 5, octaves: 1, stepRepeats: 1,
    initial: { ...initial }, rngDraw01: 0.99,
    expected: nextArpIndex("random", initial, 5, 1, 1, 0.99),
  });
  // (h) strike, pool=3 — index stays 0, round advances each tick.
  {
    let st = { ...initial };
    const trace = [{ ...st }];
    for (let t = 0; t < 5; t++) {
      st = nextArpIndex("strike", st, 3, 2, 1, 0);
      trace.push({ ...st });
    }
    cases.push({
      label: "strike, pool=3, oct=2 — index=0 fixed, round wraps every tick",
      pattern: "strike", poolSize: 3, octaves: 2, stepRepeats: 1,
      initial: { ...initial },
      trace,
    });
  }
  // (i) pool=0 — state unchanged.
  cases.push({
    label: "empty pool — state unchanged",
    pattern: "up", poolSize: 0, octaves: 1, stepRepeats: 1,
    initial: { index: 5, round: 2, repeatTick: 3, direction: -1 },
    expected: nextArpIndex(
      "up", { index: 5, round: 2, repeatTick: 3, direction: -1 },
      0, 1, 1, 0),
  });
  return cases;
}

export function genResolveArpStepCases() {
  const cases = [];
  const pool = [60, 64, 67]; // C major triad
  // (a) traversal, round 0 — pool[index].
  cases.push({
    label: "up, pool=C major triad, index=0, round=0 → emit [60]",
    pool, index: 0, octaveRound: 0, pattern: "up",
    expected: resolveArpStep(pool, 0, 0, "up"),
  });
  cases.push({
    label: "up, pool=C major triad, index=2, round=0 → emit [67]",
    pool, index: 2, octaveRound: 0, pattern: "up",
    expected: resolveArpStep(pool, 2, 0, "up"),
  });
  // (b) traversal, round 1 — pitch +12.
  cases.push({
    label: "up, pool=C major triad, index=1, round=1 → emit [76]",
    pool, index: 1, octaveRound: 1, pattern: "up",
    expected: resolveArpStep(pool, 1, 1, "up"),
  });
  // (c) strike — whole pool emitted at the octave.
  cases.push({
    label: "strike, pool=C major triad, round=0 → emit [60,64,67]",
    pool, index: 0, octaveRound: 0, pattern: "strike",
    expected: resolveArpStep(pool, 0, 0, "strike"),
  });
  cases.push({
    label: "strike, pool=C major triad, round=1 → emit [72,76,79]",
    pool, index: 0, octaveRound: 1, pattern: "strike",
    expected: resolveArpStep(pool, 0, 1, "strike"),
  });
  // (d) pitch > 127 → rest (silent step).
  cases.push({
    label: "up, pool=[127], round=1 → rest (127+12 out of range)",
    pool: [127], index: 0, octaveRound: 1, pattern: "up",
    expected: resolveArpStep([127], 0, 1, "up"),
  });
  // (e) strike with partial overflow — surviving voices emit.
  cases.push({
    label: "strike, pool=[120, 125], round=1 → emit [] (both overflow) → rest",
    pool: [120, 125], index: 0, octaveRound: 1, pattern: "strike",
    expected: resolveArpStep([120, 125], 0, 1, "strike"),
  });
  cases.push({
    label: "strike, pool=[100, 120], round=1 → emit [112] (120+12 overflows, 100+12 ok)",
    pool: [100, 120], index: 0, octaveRound: 1, pattern: "strike",
    expected: resolveArpStep([100, 120], 0, 1, "strike"),
  });
  // (f) empty pool → rest regardless of index/round.
  cases.push({
    label: "empty pool → rest",
    pool: [], index: 0, octaveRound: 0, pattern: "up",
    expected: resolveArpStep([], 0, 0, "up"),
  });
  // (g) index modulo behaviour — index 5 against poolSize 3 wraps to 2.
  cases.push({
    label: "up, pool=3, index=5 wraps to 2",
    pool, index: 5, octaveRound: 0, pattern: "up",
    expected: resolveArpStep(pool, 5, 0, "up"),
  });
  return cases;
}
