// scripts/gen-test-vectors/arp.mjs
//
// ADR 004 arpeggiator: rate parsing, pattern cursor advancement, step
// resolution, variation cascade (rest / octave shift / flam), groove
// cascade (per-step accent / slide / swing), and the slide-aware
// noteOff scheduler.
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

// ============================================================
// Arpeggiator variation cascade
// ============================================================

// Pure: applies the variation cascade to one tick's would-be emission.
//
// Inputs:
//   emission    — { kind: "emit", pitches } | { kind: "rest" } from resolveArpStep
//   variation   — arpVariation 0..1 (clamped)
//   rngDraw01   — bucket selector, [0, 1)
//   rngDraw02   — octave-shift sign selector, [0, 1) (consumed only when bucket = octave shift)
//
// Probability cascade at v = clamp(variation, 0, 1):
//   [0,       0.30·v):  Rest          — tick emits nothing
//   [0.30·v,  0.50·v):  Octave shift  — ±12 semitones (sign from rngDraw02)
//   [0.50·v,  0.65·v):  Flam          — emit twice; second at +0.5 step
//   [0.65·v,  1.0):     Normal        — emission unchanged
//
// At v = 1.0: 30% rest, 20% oct, 15% flam, 35% normal.
//
// Octave shift fall-through: if the ±12 shift would put any pitch outside
// [0, 127], the variation falls through to "normal" (preserves chord-shape
// integrity for `strike` — all voices shift together or none).
//
// Output kinds:
//   { effect: "rest" }
//   { effect: "normal",       pitches }
//   { effect: "octave_shift", pitches, semitones }
//   { effect: "flam",         pitches, second_offset_fraction }
//
// Rest emissions pass through unchanged (no variation on a tick that
// resolveArpStep already determined produces no audio).
export function applyArpVariation(emission, variation, rngDraw01, rngDraw02) {
  if (emission.kind === "rest") return { effect: "rest" };
  const v = Math.max(0, Math.min(1, variation));
  if (v === 0 || rngDraw01 >= 0.65 * v) {
    return { effect: "normal", pitches: [...emission.pitches] };
  }
  if (rngDraw01 < 0.30 * v) {
    return { effect: "rest" };
  }
  if (rngDraw01 < 0.50 * v) {
    const semitones = rngDraw02 < 0.5 ? -12 : 12;
    const shifted = emission.pitches.map((p) => p + semitones);
    if (shifted.some((p) => p < 0 || p > 127)) {
      return { effect: "normal", pitches: [...emission.pitches] };
    }
    return { effect: "octave_shift", pitches: shifted, semitones };
  }
  return { effect: "flam", pitches: [...emission.pitches], second_offset_fraction: 0.5 };
}

// ============================================================
// Arpeggiator groove cascade
// ============================================================

// Pure: applies the deterministic groove layer to a post-variation emission.
//
// Inputs:
//   emission                  — post-variation result of applyArpVariation
//   tickIndex                 — global tick counter (0 at transport start, +1 per arp tick)
//   accentTable               — 16-int (0..127) velocity per 16th-grid position
//   slideTable                — 16-bool tie per 16th-grid position
//   swing                     — 0..0.75 (clamped on use; spec caps at 0.75)
//   sixteenthDurationSamples  — samples per 16th note at current host BPM
//
// Output:
//   { applied: false }                                          — rest emissions
//   { applied: true, velocity, tieToNext, swingOffsetSamples }  — emit-bearing
//
// Rules (ADR 004 §Groove layer):
//   - Indexing: tickIndex mod 16 (NOT base-pattern step) — the 16-step grid is
//     the rhythm cycle, decoupled from the harmonic pattern's cycle.
//   - velocity            = accentTable[tickIndex mod 16]
//   - tieToNext           = slideTable[tickIndex mod 16]
//   - swingOffsetSamples  = swing × (sixteenthDurationSamples / 2) when the
//                           arp tick lands on an off-beat position (tickIndex
//                           is odd); 0 otherwise. Magnitude is in 16th-grid
//                           units (rate-independent per "Independent of arpRate").
//   - Rest emissions short-circuit: groove is not applied to rests.
//
// Flam interaction (caller-handled, not encoded here): when variation produced
// a flam emission and the current step is slide-on, only the SECOND flam
// emission inherits tieToNext. The first flam emission gets its normal
// noteOff. applyArpGroove returns the tick's tieToNext flag; the host
// scheduler applies it to the appropriate emission.
export function applyArpGroove(emission, tickIndex, accentTable, slideTable, swing, sixteenthDurationSamples) {
  if (emission.effect === "rest") return { applied: false };
  const i = ((tickIndex % 16) + 16) % 16;
  const velocity = accentTable[i];
  const tieToNext = !!slideTable[i];
  const swingOffsetSamples = (tickIndex % 2 === 1)
    ? swing * (sixteenthDurationSamples / 2)
    : 0;
  return { applied: true, velocity, tieToNext, swingOffsetSamples };
}

// ============================================================
// Slide-aware noteOff scheduling
// ============================================================

// Pure: computes the sample offset at which the current emission's noteOff
// should fire, relative to the tick's base noteOn.
//
// Inputs:
//   slideOnCurrent        — tieToNext for THIS emission. Caller applies the
//                           flam convention (first flam emission gets
//                           slideOnCurrent=false; the second inherits the
//                           tick's tieToNext from applyArpGroove).
//   gateSamples           — arpGate × stepDurationSamples (staccato gate)
//   nextTickSampleOffset  — distance from this tick's noteOn to the next
//                           tick's boundary (positive samples). If the next
//                           tick is a rest, the caller still passes the
//                           boundary offset — slide does not extend past it.
//
// Output:
//   { noteOffSampleOffset }
//
// Rules:
//   - Non-slide: noteOff at gateSamples.
//   - Slide:     noteOff at nextTickSampleOffset (arpGate overridden; slide
//                implies full overlap into the next tick's noteOn — the
//                receiver synth glides between pitches).
//   - Slide across rate change: nextTickSampleOffset is already computed
//     under the new rate by the caller; this function does no
//     re-quantisation.
export function scheduleArpNoteOff(slideOnCurrent, gateSamples, nextTickSampleOffset) {
  return {
    noteOffSampleOffset: slideOnCurrent ? nextTickSampleOffset : gateSamples,
  };
}

// ============================================================
// Variation / groove / noteOff case generators
// ============================================================

export function genApplyArpVariationCases() {
  const cases = [];
  const emit = { kind: "emit", pitches: [60, 64, 67] };
  const rest = { kind: "rest" };

  // (a) variation=0 → always normal, RNG draws ignored.
  cases.push({
    label: "variation=0, draw=0.0 → normal",
    emission: emit, variation: 0, rngDraw01: 0, rngDraw02: 0,
    expected: applyArpVariation(emit, 0, 0, 0),
  });
  cases.push({
    label: "variation=0, draw=0.99 → normal (draws ignored at v=0)",
    emission: emit, variation: 0, rngDraw01: 0.99, rngDraw02: 0.5,
    expected: applyArpVariation(emit, 0, 0.99, 0.5),
  });

  // (b) variation=1 — full-range buckets.
  cases.push({
    label: "variation=1, draw=0.10 (in [0, 0.30)) → rest",
    emission: emit, variation: 1, rngDraw01: 0.10, rngDraw02: 0,
    expected: applyArpVariation(emit, 1, 0.10, 0),
  });
  cases.push({
    label: "variation=1, draw=0.30 (boundary) → octave shift",
    emission: emit, variation: 1, rngDraw01: 0.30, rngDraw02: 0.0,
    expected: applyArpVariation(emit, 1, 0.30, 0.0),
  });
  cases.push({
    label: "variation=1, draw=0.40, draw02=0.0 → octave shift -12",
    emission: emit, variation: 1, rngDraw01: 0.40, rngDraw02: 0.0,
    expected: applyArpVariation(emit, 1, 0.40, 0.0),
  });
  cases.push({
    label: "variation=1, draw=0.40, draw02=0.7 → octave shift +12",
    emission: emit, variation: 1, rngDraw01: 0.40, rngDraw02: 0.7,
    expected: applyArpVariation(emit, 1, 0.40, 0.7),
  });
  cases.push({
    label: "variation=1, draw=0.50 (boundary) → flam",
    emission: emit, variation: 1, rngDraw01: 0.50, rngDraw02: 0,
    expected: applyArpVariation(emit, 1, 0.50, 0),
  });
  cases.push({
    label: "variation=1, draw=0.60 → flam",
    emission: emit, variation: 1, rngDraw01: 0.60, rngDraw02: 0,
    expected: applyArpVariation(emit, 1, 0.60, 0),
  });
  cases.push({
    label: "variation=1, draw=0.65 (boundary) → normal",
    emission: emit, variation: 1, rngDraw01: 0.65, rngDraw02: 0,
    expected: applyArpVariation(emit, 1, 0.65, 0),
  });
  cases.push({
    label: "variation=1, draw=0.99 → normal",
    emission: emit, variation: 1, rngDraw01: 0.99, rngDraw02: 0,
    expected: applyArpVariation(emit, 1, 0.99, 0),
  });

  // (c) variation=0.5 — scaled boundaries: rest [0, 0.15), oct [0.15, 0.25),
  // flam [0.25, 0.325), normal [0.325, 1.0). 67.5% normal at half variation.
  cases.push({
    label: "variation=0.5, draw=0.10 → rest",
    emission: emit, variation: 0.5, rngDraw01: 0.10, rngDraw02: 0,
    expected: applyArpVariation(emit, 0.5, 0.10, 0),
  });
  cases.push({
    label: "variation=0.5, draw=0.20 → octave shift +12",
    emission: emit, variation: 0.5, rngDraw01: 0.20, rngDraw02: 0.7,
    expected: applyArpVariation(emit, 0.5, 0.20, 0.7),
  });
  cases.push({
    label: "variation=0.5, draw=0.30 → flam",
    emission: emit, variation: 0.5, rngDraw01: 0.30, rngDraw02: 0,
    expected: applyArpVariation(emit, 0.5, 0.30, 0),
  });
  cases.push({
    label: "variation=0.5, draw=0.50 → normal",
    emission: emit, variation: 0.5, rngDraw01: 0.50, rngDraw02: 0,
    expected: applyArpVariation(emit, 0.5, 0.50, 0),
  });

  // (d) Octave shift overflow → fall-through to normal.
  const high = { kind: "emit", pitches: [124] };
  cases.push({
    label: "variation=1, draw=0.40, draw02=0.7, emit=[124] → +12 overflow → normal",
    emission: high, variation: 1, rngDraw01: 0.40, rngDraw02: 0.7,
    expected: applyArpVariation(high, 1, 0.40, 0.7),
  });
  const low = { kind: "emit", pitches: [3] };
  cases.push({
    label: "variation=1, draw=0.40, draw02=0.2, emit=[3] → -12 underflow → normal",
    emission: low, variation: 1, rngDraw01: 0.40, rngDraw02: 0.2,
    expected: applyArpVariation(low, 1, 0.40, 0.2),
  });
  const mixed = { kind: "emit", pitches: [60, 124, 67] };
  cases.push({
    label: "strike chord variation=1, +12 overflows one voice → normal (chord integrity)",
    emission: mixed, variation: 1, rngDraw01: 0.40, rngDraw02: 0.7,
    expected: applyArpVariation(mixed, 1, 0.40, 0.7),
  });

  // (e) Rest emission passes through.
  cases.push({
    label: "rest emission, variation=1 → rest",
    emission: rest, variation: 1, rngDraw01: 0.40, rngDraw02: 0,
    expected: applyArpVariation(rest, 1, 0.40, 0),
  });

  return cases;
}

export function genApplyArpGrooveCases() {
  const cases = [];
  const flatAccent = Array(16).fill(100);
  const flatSlide = Array(16).fill(false);
  const normal = { effect: "normal", pitches: [60] };
  const rest = { effect: "rest" };

  // (a) Flat tables, no swing — defaults reproduce v0.1 behaviour.
  cases.push({
    label: "flat tables, swing=0, tick=0 → vel 100, no tie, no swing",
    emission: normal, tickIndex: 0,
    accentTable: flatAccent, slideTable: flatSlide,
    swing: 0, sixteenthDurationSamples: 1000,
    expected: applyArpGroove(normal, 0, flatAccent, flatSlide, 0, 1000),
  });
  cases.push({
    label: "flat tables, swing=0, tick=7 → vel 100, no tie, no swing",
    emission: normal, tickIndex: 7,
    accentTable: flatAccent, slideTable: flatSlide,
    swing: 0, sixteenthDurationSamples: 1000,
    expected: applyArpGroove(normal, 7, flatAccent, flatSlide, 0, 1000),
  });

  // (b) Accent step 0=127, others 60 — classic acid downbeat.
  const acidAccent = Array(16).fill(60); acidAccent[0] = 127;
  cases.push({
    label: "acid accent (step 0=127), tick=0 → vel 127",
    emission: normal, tickIndex: 0,
    accentTable: acidAccent, slideTable: flatSlide,
    swing: 0, sixteenthDurationSamples: 1000,
    expected: applyArpGroove(normal, 0, acidAccent, flatSlide, 0, 1000),
  });
  cases.push({
    label: "acid accent (step 0=127), tick=1 → vel 60",
    emission: normal, tickIndex: 1,
    accentTable: acidAccent, slideTable: flatSlide,
    swing: 0, sixteenthDurationSamples: 1000,
    expected: applyArpGroove(normal, 1, acidAccent, flatSlide, 0, 1000),
  });
  cases.push({
    label: "acid accent (step 0=127), tick=16 → wraps to vel 127",
    emission: normal, tickIndex: 16,
    accentTable: acidAccent, slideTable: flatSlide,
    swing: 0, sixteenthDurationSamples: 1000,
    expected: applyArpGroove(normal, 16, acidAccent, flatSlide, 0, 1000),
  });

  // (c) Slide on at steps {3, 7} — tieToNext follows pattern.
  const slidePat = Array(16).fill(false); slidePat[3] = true; slidePat[7] = true;
  cases.push({
    label: "slide on at step 3, tick=3 → tieToNext true",
    emission: normal, tickIndex: 3,
    accentTable: flatAccent, slideTable: slidePat,
    swing: 0, sixteenthDurationSamples: 1000,
    expected: applyArpGroove(normal, 3, flatAccent, slidePat, 0, 1000),
  });
  cases.push({
    label: "slide on at step 3, tick=4 → tieToNext false",
    emission: normal, tickIndex: 4,
    accentTable: flatAccent, slideTable: slidePat,
    swing: 0, sixteenthDurationSamples: 1000,
    expected: applyArpGroove(normal, 4, flatAccent, slidePat, 0, 1000),
  });

  // (d) Swing — odd ticks delayed by swing × (16thDur / 2).
  cases.push({
    label: "swing=0.5, 16thDur=1000, tick=0 → offset 0 (even tick)",
    emission: normal, tickIndex: 0,
    accentTable: flatAccent, slideTable: flatSlide,
    swing: 0.5, sixteenthDurationSamples: 1000,
    expected: applyArpGroove(normal, 0, flatAccent, flatSlide, 0.5, 1000),
  });
  cases.push({
    label: "swing=0.5, 16thDur=1000, tick=1 → offset 250 (odd tick, half × half-16th)",
    emission: normal, tickIndex: 1,
    accentTable: flatAccent, slideTable: flatSlide,
    swing: 0.5, sixteenthDurationSamples: 1000,
    expected: applyArpGroove(normal, 1, flatAccent, flatSlide, 0.5, 1000),
  });
  cases.push({
    label: "swing=0.75, 16thDur=1000, tick=3 → offset 375 (cap)",
    emission: normal, tickIndex: 3,
    accentTable: flatAccent, slideTable: flatSlide,
    swing: 0.75, sixteenthDurationSamples: 1000,
    expected: applyArpGroove(normal, 3, flatAccent, flatSlide, 0.75, 1000),
  });

  // (e) Rest emission — groove not applied (short-circuit).
  cases.push({
    label: "rest emission → applied=false (groove short-circuits)",
    emission: rest, tickIndex: 5,
    accentTable: acidAccent, slideTable: slidePat,
    swing: 0.5, sixteenthDurationSamples: 1000,
    expected: applyArpGroove(rest, 5, acidAccent, slidePat, 0.5, 1000),
  });

  return cases;
}

export function genScheduleArpNoteOffCases() {
  const cases = [];

  // (a) Non-slide: gate-driven.
  cases.push({
    label: "non-slide, gate=500, nextTick=1000 → noteOff at 500",
    slideOnCurrent: false, gateSamples: 500, nextTickSampleOffset: 1000,
    expected: scheduleArpNoteOff(false, 500, 1000),
  });
  cases.push({
    label: "non-slide, gate=1000 (full step), nextTick=1000 → noteOff at 1000",
    slideOnCurrent: false, gateSamples: 1000, nextTickSampleOffset: 1000,
    expected: scheduleArpNoteOff(false, 1000, 1000),
  });

  // (b) Slide: gate overridden, noteOff deferred to next tick.
  cases.push({
    label: "slide, gate=500 (ignored), nextTick=1000 → noteOff at 1000",
    slideOnCurrent: true, gateSamples: 500, nextTickSampleOffset: 1000,
    expected: scheduleArpNoteOff(true, 500, 1000),
  });
  cases.push({
    label: "slide, gate=999 (ignored), nextTick=1000 → noteOff at 1000",
    slideOnCurrent: true, gateSamples: 999, nextTickSampleOffset: 1000,
    expected: scheduleArpNoteOff(true, 999, 1000),
  });
  // Slide across a rate change: nextTickSampleOffset reflects the new rate.
  cases.push({
    label: "slide across rate change, nextTick=2000 → noteOff at 2000",
    slideOnCurrent: true, gateSamples: 500, nextTickSampleOffset: 2000,
    expected: scheduleArpNoteOff(true, 500, 2000),
  });

  return cases;
}
