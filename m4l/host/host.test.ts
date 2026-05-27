// Tests for host/host.ts — v3 surface (ADR 004 Phase 3-A).
//
// State-machine tests, no Max API, no timers. nowMs is injected per
// noteIn call so tests deliver deterministic time deltas.
//
// v3 surface (concept.md §"Parameter surface (canonical)" + ADR 004):
//   scale | root | mode("scale"|"chord"|"arp") | chordShape |
//   feel | drift | inputChannel | seed |
//   arpPattern | arpRate | arpOctaves | arpStepRepeats | arpGate |
//   arpVariation | arpLatch | arpSwing | arpAccent[16] | arpSlide[16]
//
// Removed in v3: harmonyVoices (replaced by chordShape — intervallic
// presets, ADR 004 §Chord shape primitive). The chord-mode call site
// no longer iterates a HarmonyVoice[] through diatonicShift; it consumes
// a single ChordShape enum through applyChordShape.
//
// 3-A scope: chord-mode swap + param surface only. arp clock + pool
// maintenance + groove cascade land in Phase 3-B. In 3-A, mode=arp
// shares the chord-mode emission branch as a placeholder so the
// chordShape primitive is audible end-to-end while the clock arrives.
//
// Threshold derivation rule (CLAUDE.md global): every numeric assertion
// is justified inline against the spec or first-principles derivation.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ARP_PATTERN_STEPS,
  DEFAULT_PARAMS,
  FIRST_EVENT_STEP_MS,
  PointsmanHost,
  type NoteEvent,
  type PointsmanParams,
} from "./host.ts";
import {
  applyChordShape,
  buildScalePitches,
} from "../engine/quantizer.ts";
import { nextU32, seedRng } from "../engine/rng.ts";

function makeHost(overrides: Partial<PointsmanParams> = {}): PointsmanHost {
  // Default seed=0 makes most tests deterministic. Tests that exercise
  // random-seed-per-instance pass no overrides explicitly.
  return new PointsmanHost({ seed: 0, ...overrides });
}

function partition(events: NoteEvent[]): {
  noteOns: NoteEvent[];
  noteOffs: NoteEvent[];
  pulses: NoteEvent[];
} {
  return {
    noteOns: events.filter((e) => e.type === "noteOn"),
    noteOffs: events.filter((e) => e.type === "noteOff"),
    pulses: events.filter((e) => e.type === "notePulse"),
  };
}

// ---------- constructor / state init ----------

test("DEFAULT_PARAMS — v3 surface (ADR 004 §Decision)", () => {
  // Defaults pinned by concept.md §"Parameter surface (canonical)" and
  // ADR 004's parameter table. Default mode is `scale`; default
  // chordShape is "maj" so `chord` ships "single note becomes a 1-3-5
  // triad" out of the box. feel/drift default to 0 (no humanize).
  assert.equal(DEFAULT_PARAMS.scale, "major");
  assert.equal(DEFAULT_PARAMS.root, 0);
  assert.equal(DEFAULT_PARAMS.mode, "scale");
  assert.equal(DEFAULT_PARAMS.feel, 0);
  assert.equal(DEFAULT_PARAMS.drift, 0);
  assert.equal(DEFAULT_PARAMS.inputChannel, 0);
  // ADR 004 §Chord shape primitive: "maj" is the spec-default.
  assert.equal(DEFAULT_PARAMS.chordShape, "maj");
});

test("DEFAULT_PARAMS — arp defaults (ADR 004 §Arpeggiator parameters)", () => {
  // Each value pinned to the ADR parameter table.
  assert.equal(DEFAULT_PARAMS.arpPattern, "up");
  assert.equal(DEFAULT_PARAMS.arpRate, "1/16");
  assert.equal(DEFAULT_PARAMS.arpOctaves, 1);
  assert.equal(DEFAULT_PARAMS.arpStepRepeats, 1);
  assert.equal(DEFAULT_PARAMS.arpGate, 0.5);
  assert.equal(DEFAULT_PARAMS.arpVariation, 0.0);
  assert.equal(DEFAULT_PARAMS.arpLatch, false);
  assert.equal(DEFAULT_PARAMS.arpSwing, 0.0);
  // Groove tables: all-100 accent (matches v0.1 typical output velocity)
  // + all-off slide. ADR 004 §Groove layer pinning.
  assert.equal(DEFAULT_PARAMS.arpAccent.length, ARP_PATTERN_STEPS);
  assert.equal(DEFAULT_PARAMS.arpSlide.length, ARP_PATTERN_STEPS);
  assert.ok(DEFAULT_PARAMS.arpAccent.every((v) => v === 100),
    "accent default must be all-100");
  assert.ok(DEFAULT_PARAMS.arpSlide.every((v) => v === false),
    "slide default must be all-off");
});

test("constructor — explicit seed is honoured (preset-load path)", () => {
  // initialParams.seed present → that exact value lands in host.params.
  const host = new PointsmanHost({ seed: 12345 });
  assert.equal(host.getParams().seed, 12345);
});

test("constructor — no seed override draws random in [0, 2^24-1]", () => {
  // concept.md §"Per-event humanize": "New plugin instances pick a random
  // seed on construction so two parallel Pointsman instances on
  // double-tracked parts do not produce phase-coherent identical humanize."
  // Range bound 2^24 = float32 exact-representation upper edge.
  const seeds = new Set<number>();
  for (let i = 0; i < 32; i++) {
    const h = new PointsmanHost(); // no overrides → random seed path
    const s = h.getParams().seed;
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffff,
      `seed ${s} out of [0, 2^24-1]`);
    seeds.add(s);
  }
  // Statistical sanity: 32 uniform draws on [0, 2^24) collide entirely
  // (all equal) with prob (1/2^24)^31 ≈ 4e-225. >16 distinct is a
  // comfortable lower bound (P(<16 distinct) ≈ 0 within float precision).
  assert.ok(seeds.size > 16,
    `expected > 16 distinct seeds across 32 fresh constructs, got ${seeds.size}`);
});

test("constructor — scalePitches matches buildScalePitches(scale, root)", () => {
  const host = makeHost({ scale: "minor", root: 9 });
  const expected = buildScalePitches("minor", 9);
  assert.deepEqual(host.getScalePitches(), expected);
});

test("constructor — arp tables are defensive-copied (mutation isolation)", () => {
  // The bridge's bulk-set path passes the same array reference into the
  // host. Mutating it from the bridge side must not silently shift the
  // host's stored pattern (parity with the harmonyVoices defensive-copy
  // boundary in v2 — same correctness need, different shape).
  const accent = Array.from({ length: 16 }, () => 80);
  const slide = Array.from({ length: 16 }, () => true);
  const host = makeHost({ arpAccent: accent, arpSlide: slide });
  accent[0] = 1; // mutate the input post-construct
  slide[0] = false;
  // Threshold: host's stored value is what was passed at construct time,
  // NOT what the caller mutated afterward.
  assert.equal(host.getParams().arpAccent[0], 80);
  assert.equal(host.getParams().arpSlide[0], true);
});

test("constructor — arp accent values clamp to MIDI velocity range", () => {
  // Out-of-range input is silently clamped at the boundary (the bridge
  // is the user-facing range-rejection layer, but the host validates
  // independently as defense-in-depth — mirrors the vst processor's
  // setArpAccent clamp at the persistence boundary).
  const host = makeHost({
    arpAccent: [
      -10, 0, 64, 127, 200,
      100, 100, 100, 100, 100,
      100, 100, 100, 100, 100, 100,
    ],
  });
  const a = host.getParams().arpAccent;
  // Threshold: MIDI velocity is 0..127, clamping is two-sided.
  assert.equal(a[0], 0);
  assert.equal(a[3], 127);
  assert.equal(a[4], 127);
});

// ---------- chord mode (intervallic, ADR 004 §Chord shape primitive) ----------
//
// ADR 004 swap: chord mode no longer iterates a HarmonyVoice[]. It applies
// a single ChordShape preset via applyChordShape — intervallic offsets
// from the snapped root. Out-of-scale voices are deliberate (borrowed-
// chord material). Voice order matches the CHORD_SHAPES preset table.

test("chord mode — default chordShape='maj' emits 1-3-5 triad on C in C major", () => {
  // Defaults: chordShape="maj" → intervals [0, 4, 7]. Input C(60), C
  // major → snap to 60 → [60, 64, 67]. Same result as v0.1 default
  // harmonyVoices for in-scale roots in major keys; the swap is
  // silent for the default case.
  const host = makeHost({ mode: "chord", scale: "major", root: 0 });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.deepEqual(r.noteOns.map((e) => e.pitch), [60, 64, 67]);
});

test("chord mode — intervallic shape ignores scale (m on C in C major)", () => {
  // ADR 004 §Scale-snap is input-only: chord voices are intervallic
  // and may go out-of-scale. chordShape="m" → [0, 3, 7] on snapped
  // C(60) → [60, 63, 67]. The Eb is out of C major scale — deliberate
  // borrowed-chord material.
  const host = makeHost({
    mode: "chord", scale: "major", root: 0, chordShape: "m",
  });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.deepEqual(r.noteOns.map((e) => e.pitch), [60, 63, 67]);
});

test("chord mode — non-tonic input gets the rooted intervallic chord (D, maj)", () => {
  // Input D(62), C major. snap to 62 (in-scale). chordShape="maj" →
  // intervallic [0, 4, 7] → [62, 66, 69]. NOTE: this is NOT the v0.1
  // diatonic behaviour ([62, 65, 69] = D-F-A) — the intervallic shape
  // gives D-F#-A regardless of scale, which is the ADR's stated design
  // departure (§Decision §Intervallic semantics).
  const host = makeHost({ mode: "chord", scale: "major", root: 0 });
  const r = partition(host.noteIn(62, 100, 1, 0));
  assert.deepEqual(r.noteOns.map((e) => e.pitch), [62, 66, 69]);
});

test("chord mode — out-of-scale input snaps first then chord-expands", () => {
  // ADR 004 §Scale-snap is input-only: "scale-snap applies only to
  // incoming MIDI (chord roots)". C#(61) → snap to C(60) → chordShape
  // "maj" → [60, 64, 67].
  const host = makeHost({ mode: "chord", scale: "major", root: 0 });
  const r = partition(host.noteIn(61, 100, 1, 0));
  assert.deepEqual(r.noteOns.map((e) => e.pitch), [60, 64, 67]);
});

test("chord mode — chordShape preset table order is preserved in output", () => {
  // ADR 004 spec: chord shape order is append-only and the emission
  // order matches the preset's interval order. Dom13 [0, 4, 7, 10, 14,
  // 21] on snapped C(60) → [60, 64, 67, 70, 74, 81].
  const host = makeHost({
    mode: "chord", scale: "major", root: 0, chordShape: "13",
  });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.deepEqual(r.noteOns.map((e) => e.pitch), [60, 64, 67, 70, 74, 81]);
});

test("chord mode — power chord shape emits 2 voices", () => {
  // power = [0, 7] → root + 5th only.
  const host = makeHost({
    mode: "chord", scale: "major", root: 0, chordShape: "power",
  });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.deepEqual(r.noteOns.map((e) => e.pitch), [60, 67]);
});

test("chord mode — MIDI-127 overflow voices are dropped (not clamped)", () => {
  // ADR 004 §Chord shape primitive: voices exceeding MIDI 127 are
  // dropped rather than clamped — preserves chord-shape integrity.
  // maj7 [0, 4, 7, 11] on snapped 124 (B above middle C, ish) →
  // [124, 128, 131, 135] → drop overflows → [124] only.
  // Note: input 124 + C major snap → 124 (B7 is in C major).
  const host = makeHost({
    mode: "chord", scale: "major", root: 0, chordShape: "maj7",
  });
  const expected = applyChordShape(124, "maj7"); // engine ground truth
  assert.deepEqual(expected, [124]); // sanity on the engine table
  const r = partition(host.noteIn(124, 100, 1, 0));
  assert.equal(r.noteOns.length, 1);
  assert.equal(r.noteOns[0].pitch, 124);
});

test("chord mode — output channel preserves input channel for all voices", () => {
  const host = makeHost({ mode: "chord", scale: "major", root: 0 });
  const r = partition(host.noteIn(60, 100, 7, 0));
  for (const e of r.noteOns) assert.equal(e.channel, 7);
  for (const e of r.noteOffs) assert.equal(e.channel, 7);
});

test("chord mode — all voices share noteOn delayMs (one humanize draw)", () => {
  // Voices are different pitches of the *same* musical event; one humanize
  // draw covers them all so timing is lockstep.
  const host = makeHost({
    mode: "chord", scale: "major", root: 0,
    feel: 1, seed: 13,
    chordShape: "maj",
  });
  // Establish prior input so sourceStepDuration > 0 → timingOffset can
  // actually deflect non-zero.
  host.noteIn(60, 100, 1, 0);
  const r = partition(host.noteIn(60, 100, 1, 200));
  assert.equal(r.noteOns.length, 3); // maj triad
  const d0 = r.noteOns[0].delayMs;
  assert.equal(r.noteOns[1].delayMs, d0);
  assert.equal(r.noteOns[2].delayMs, d0);
});

test("chord mode — all voices share velocity (one humanize draw)", () => {
  const host = makeHost({
    mode: "chord", scale: "major", root: 0,
    feel: 0.5, seed: 7, chordShape: "maj",
  });
  const r = partition(host.noteIn(60, 100, 1, 0));
  const v0 = r.noteOns[0].velocity;
  for (const e of r.noteOns) assert.equal(e.velocity, v0);
});

test("chord mode — notePulse fires for every voiced note", () => {
  // Keyboard should highlight every sounded key, not just the root.
  const host = makeHost({
    mode: "chord", scale: "major", root: 0, chordShape: "maj",
  });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.pulses.length, r.noteOns.length);
  assert.deepEqual(
    [...r.pulses.map((e) => e.pitch)].sort((a, b) => a - b),
    [...r.noteOns.map((e) => e.pitch)].sort((a, b) => a - b),
  );
});

// ---------- arp mode (Phase 3-B — pool + transportTick) ----------
//
// ADR 004 §Held-note pool: arp mode noteIn populates the held-note pool
// (chord-shape voices added) and does NOT emit immediately — emission is
// tick-driven by transportTick. The bridge polls transport position +
// BPM at DEFAULT_TRANSPORT_POLL_MS cadence and feeds them in; the host
// computes the next due tick(s) relative to the current position and
// returns scheduled events.

test("arp mode — noteIn populates pool, emits no immediate notes", () => {
  // ADR §Held-note pool: input C(60) with chordShape=maj → snap to 60
  // → expand to {60, 64, 67} → pool has 3 entries. No noteOn emitted at
  // this point; the next transportTick will start the cycle.
  const host = makeHost({
    mode: "arp", scale: "major", root: 0, chordShape: "maj",
  });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.noteOns.length, 0,
    "arp noteIn must not emit synchronously");
  assert.equal(r.noteOffs.length, 0);
  assert.equal(r.pulses.length, 0);
  // Threshold 3: maj triad → 3 pool voices.
  assert.equal(host.getArpPoolForTest().length, 3);
  assert.deepEqual(
    host.getArpPoolForTest().map((e) => e.pitch),
    [60, 64, 67],
  );
});

test("arp mode — noteOff removes contributed voices (no latch)", () => {
  const host = makeHost({
    mode: "arp", scale: "major", root: 0, chordShape: "maj",
  });
  host.noteIn(60, 100, 1, 0);
  assert.equal(host.getArpPoolForTest().length, 3);
  host.noteOff(60, 1);
  // Threshold 0: voices from the only held source are gone.
  assert.equal(host.getArpPoolForTest().length, 0);
  assert.equal(host.getArpHeldKeysCountForTest(), 0);
});

test("arp mode — multiple held notes accumulate pool voices", () => {
  // C major: input C(60) → {60, 64, 67}; input E(64) → {64, 68, 71}.
  // The 64 collides with the C-contributed entry — dedup drops it.
  // Net pool: {60, 64, 67, 68, 71} = 5 voices.
  const host = makeHost({
    mode: "arp", scale: "major", root: 0, chordShape: "maj",
  });
  host.noteIn(60, 100, 1, 0);
  host.noteIn(64, 100, 1, 100);
  const pool = host.getArpPoolForTest();
  // Threshold 5: 3 + 3 voices with one dedup collision.
  assert.equal(pool.length, 5);
  assert.deepEqual(
    pool.map((e) => e.pitch).sort((a, b) => a - b),
    [60, 64, 67, 68, 71],
  );
});

test("arp mode — arpLatch preserves voices after noteOff", () => {
  const host = makeHost({
    mode: "arp", scale: "major", root: 0, chordShape: "maj",
    arpLatch: true,
  });
  host.noteIn(60, 100, 1, 0);
  assert.equal(host.getArpPoolForTest().length, 3);
  host.noteOff(60, 1);
  // Threshold 3: latch retains voices even with no held keys.
  assert.equal(host.getArpPoolForTest().length, 3);
  assert.equal(host.getArpHeldKeysCountForTest(), 0);
});

test("arp mode — arpLatch + new noteOn after release replaces pool", () => {
  // ADR §Held-note pool: latch holds the pool until a new noteOn after
  // all keys release — that noteOn REPLACES (not adds to) the pool.
  const host = makeHost({
    mode: "arp", scale: "major", root: 0, chordShape: "maj",
    arpLatch: true,
  });
  host.noteIn(60, 100, 1, 0);   // pool = {60, 64, 67}
  host.noteOff(60, 1);          // latched
  host.noteIn(67, 100, 1, 100); // replace
  const pool = host.getArpPoolForTest().map((e) => e.pitch).sort((a, b) => a - b);
  // Threshold 3: G(67) maj triad = {67, 71, 74}.
  assert.deepEqual(pool, [67, 71, 74]);
});

test("arp mode — chordShape change mid-hold rebuilds pool", () => {
  // ADR §Held-note pool: chordShape change in arp mode rebuilds from
  // currently-held keys with the new shape. C(60) held → switch maj
  // (3 voices) to m (3 voices, different middle).
  const host = makeHost({
    mode: "arp", scale: "major", root: 0, chordShape: "maj",
  });
  host.noteIn(60, 100, 1, 0);
  assert.deepEqual(
    host.getArpPoolForTest().map((e) => e.pitch),
    [60, 64, 67],
  );
  host.setParam("chordShape", "m");
  assert.deepEqual(
    host.getArpPoolForTest().map((e) => e.pitch),
    [60, 63, 67],
  );
});

test("arp mode — mode switch out of arp clears pool + held keys", () => {
  const host = makeHost({
    mode: "arp", scale: "major", root: 0, chordShape: "maj",
  });
  host.noteIn(60, 100, 1, 0);
  assert.equal(host.getArpPoolForTest().length, 3);
  host.setParam("mode", "scale");
  // Threshold 0: arp state evacuates so re-entry starts clean.
  assert.equal(host.getArpPoolForTest().length, 0);
  assert.equal(host.getArpHeldKeysCountForTest(), 0);
});

// ---------- arp mode — transportTick clock ----------

test("transportTick — empty pool emits nothing", () => {
  const host = makeHost({ mode: "arp" });
  const out = host.transportTick(0, 120, 0);
  assert.deepEqual(out, []);
});

test("transportTick — non-arp mode emits nothing", () => {
  const host = makeHost({ mode: "scale" });
  host.noteIn(60, 100, 1, 0); // emits but irrelevant here
  const out = host.transportTick(0, 120, 0);
  assert.deepEqual(out, []);
});

test("transportTick — first tick at position=0 fires with delayMs=0", () => {
  // ADR §Transport semantics §Start: pattern begins on the next clock
  // tick. position=0 lands on the 1/16 grid (0 mod 0.25 == 0), so the
  // first tick fires immediately. Default arpPattern=up, chordShape=maj,
  // pool sorted ascending {60, 64, 67} → first emission is the lowest
  // voice (60).
  const host = makeHost({
    mode: "arp", scale: "major", root: 0,
    chordShape: "maj", seed: 0,
    feel: 0, // no humanize jitter so timing is bit-exact for assertion
    arpAccent: Array.from({ length: 16 }, () => 100),
    arpSwing: 0,
  });
  host.noteIn(60, 100, 1, 0);
  const out = host.transportTick(0, 120, 0);
  const noteOns = out.filter((e) => e.type === "noteOn");
  // Threshold 1: `up` pattern → one voice per tick.
  assert.equal(noteOns.length, 1);
  // Threshold 60: the lowest pool pitch (root of maj triad).
  assert.equal(noteOns[0].pitch, 60);
  // Threshold 0: position-aligned tick, no swing, no humanize → fires
  // immediately.
  assert.equal(noteOns[0].delayMs, 0);
});

test("transportTick — successive ticks advance the up pattern", () => {
  // Run a sequence of transportTicks at increasing position. The bridge
  // polls every ~16 ms; at BPM 120 (msPerBeat=500), one 1/16 = 125 ms =
  // 0.25 ppq. We'll step position by 0.25 ppq each call to land exactly
  // one tick per call.
  const host = makeHost({
    mode: "arp", scale: "major", root: 0,
    chordShape: "maj", seed: 0, feel: 0,
    arpSwing: 0,
  });
  host.noteIn(60, 100, 1, 0);
  const pitches: number[] = [];
  for (let i = 0; i < 3; i++) {
    // Pass pollIntervalMs=0 so lookahead is just the safety margin (5
    // ms) — this isolates the test from lookahead's pre-scheduling.
    const out = host.transportTick(i * 0.25, 120, i * 125, 0);
    for (const ev of out) {
      if (ev.type === "noteOn") pitches.push(ev.pitch);
    }
  }
  // Threshold [60, 64, 67]: up pattern over the 3-voice maj triad pool.
  assert.deepEqual(pitches, [60, 64, 67]);
});

test("transportTick — pattern wraps after one full pool cycle", () => {
  const host = makeHost({
    mode: "arp", scale: "major", root: 0,
    chordShape: "maj", seed: 0, feel: 0, arpSwing: 0,
  });
  host.noteIn(60, 100, 1, 0);
  const pitches: number[] = [];
  for (let i = 0; i < 4; i++) {
    const out = host.transportTick(i * 0.25, 120, i * 125, 0);
    for (const ev of out) {
      if (ev.type === "noteOn") pitches.push(ev.pitch);
    }
  }
  // Threshold [60, 64, 67, 60]: 3-voice pool wraps after 3 ticks.
  assert.deepEqual(pitches, [60, 64, 67, 60]);
});

test("transportTick — arpRate change re-anchors next tick", () => {
  const host = makeHost({
    mode: "arp", scale: "major", root: 0,
    chordShape: "maj", seed: 0, feel: 0, arpSwing: 0,
    arpRate: "1/16",
  });
  host.noteIn(60, 100, 1, 0);
  host.transportTick(0, 120, 0, 0);
  // Switch rate mid-flight; next tick should align to the new rate's
  // grid, NOT continue at 0.25 ppq (the old grid). Position 0.3 ppq —
  // not on either grid. Next 1/8 boundary at 0.5 ppq = 100 ms ahead at
  // BPM 120. Use pollIntervalMs=150 → lookahead 155 ms = 0.31 ppq,
  // covers the 0.2 ppq gap to the next 1/8 tick.
  host.setParam("arpRate", "1/8"); // 1/8 = 0.5 quarter notes per step
  const out = host.transportTick(0.3, 120, 150, 150);
  const noteOns = out.filter((e) => e.type === "noteOn");
  // Threshold 1: one tick fires within lookahead at the next 1/8.
  // delayMs = (0.5 - 0.3) * 500 = 100 ms.
  assert.equal(noteOns.length, 1);
  assert.equal(noteOns[0].delayMs, 100);
});

test("transportTick — gate length = arpGate × stepMs (no humanize)", () => {
  // Threshold derivation: with arpGate=0.5 at 1/16 @ 120 BPM, stepMs =
  // 125 ms. gate ms = 0.5 × 125 = 62.5 ms. feel=0 → humanize gateFinal
  // = inputGate = 0.5 (no jitter), so noteOff delay = noteOn + 62.5.
  const host = makeHost({
    mode: "arp", scale: "major", root: 0,
    chordShape: "maj", seed: 0,
    feel: 0, arpGate: 0.5, arpSwing: 0,
  });
  host.noteIn(60, 100, 1, 0);
  const out = host.transportTick(0, 120, 0, 0);
  const noteOn = out.find((e) => e.type === "noteOn");
  const noteOff = out.find((e) => e.type === "noteOff");
  assert.ok(noteOn && noteOff);
  // Threshold 62.5: spec-derived gate duration.
  assert.equal(noteOff!.delayMs - noteOn!.delayMs, 62.5);
});

test("transportTick — arpSwing=0.5 delays odd 16th by quarter of 16th", () => {
  // Threshold derivation: arpSwing applies to tickIndex mod 2 == 1
  // (odd 16ths). With arpSwing=0.5, sixteenthMs = msPerBeat/4 = 125 ms
  // (at BPM 120), swing offset = 0.5 × (125/2) = 31.25 ms.
  // First tick (tickIndex=0): no swing. Second tick (tickIndex=1):
  // base delayMs (one step ahead) + 31.25 ms swing offset.
  const host = makeHost({
    mode: "arp", scale: "major", root: 0,
    chordShape: "maj", seed: 0, feel: 0,
    arpSwing: 0.5,
  });
  host.noteIn(60, 100, 1, 0);
  const out1 = host.transportTick(0, 120, 0, 0);
  const out2 = host.transportTick(0.25, 120, 125, 0);
  const on1 = out1.find((e) => e.type === "noteOn");
  const on2 = out2.find((e) => e.type === "noteOn");
  assert.ok(on1 && on2);
  // Tick 0: position 0 == grid → delayMs 0; tickIndex=0 → no swing.
  assert.equal(on1!.delayMs, 0);
  // Tick 1: position 0.25 == grid → base delayMs 0; tickIndex=1 →
  // swing offset 31.25 ms.
  assert.equal(on2!.delayMs, 31.25);
});

test("transportTick — accent table drives per-step velocity", () => {
  // Threshold: arpAccent[0]=120, [1]=80. With feel=0 (no jitter)
  // humanize passes inputVelocity through unchanged. Tick 0 fires
  // velocity 120; tick 1 fires velocity 80.
  const accent = Array.from({ length: 16 }, () => 100);
  accent[0] = 120;
  accent[1] = 80;
  const host = makeHost({
    mode: "arp", scale: "major", root: 0,
    chordShape: "maj", seed: 0, feel: 0,
    arpAccent: accent, arpSwing: 0,
  });
  host.noteIn(60, 100, 1, 0);
  const out0 = host.transportTick(0, 120, 0, 0);
  const out1 = host.transportTick(0.25, 120, 125, 0);
  const on0 = out0.find((e) => e.type === "noteOn");
  const on1 = out1.find((e) => e.type === "noteOn");
  assert.ok(on0 && on1);
  assert.equal(on0!.velocity, 120);
  assert.equal(on1!.velocity, 80);
});

test("transportTick — slide step defers noteOff to next tick's noteOn", () => {
  // ADR §Groove layer §arpSlide: slide-on step suppresses noteOff at
  // gate boundary; held note ties into the next emission's noteOn.
  // Slide on tick 0 → tick 0 emits only noteOn (no immediate noteOff);
  // tick 1 emits noteOn THEN noteOff_of_tick0 at the same delayMs.
  const slide = Array.from({ length: 16 }, () => false);
  slide[0] = true;
  const host = makeHost({
    mode: "arp", scale: "major", root: 0,
    chordShape: "maj", seed: 0, feel: 0,
    arpSwing: 0, arpSlide: slide,
  });
  host.noteIn(60, 100, 1, 0);
  const out0 = host.transportTick(0, 120, 0, 0);
  // Threshold: tick 0 emits noteOn(60) + notePulse only, NO noteOff
  // (slide deferred).
  const offsT0 = out0.filter((e) => e.type === "noteOff");
  assert.equal(offsT0.length, 0,
    "slide step must not schedule its own noteOff at the gate boundary");

  const out1 = host.transportTick(0.25, 120, 125, 0);
  // Tick 1: should emit noteOn(64) then noteOff(60) at the same delayMs
  // (tick 1's noteOn time). Tick 1 itself has slide=false so its own
  // noteOff schedules normally.
  const noteOnsT1 = out1.filter((e) => e.type === "noteOn");
  const noteOffsT1 = out1.filter((e) => e.type === "noteOff");
  assert.equal(noteOnsT1.length, 1);
  assert.equal(noteOnsT1[0].pitch, 64);
  // Threshold ≥1: the deferred noteOff(60) appears in tick 1's batch.
  const deferred = noteOffsT1.find((e) => e.pitch === 60);
  assert.ok(deferred, "deferred noteOff(60) must fire at tick 1");
  assert.equal(deferred!.delayMs, noteOnsT1[0].delayMs,
    "deferred noteOff fires at tick 1's noteOn time for slide overlap");
});

test("transportTick — strike pattern emits all pool voices per tick", () => {
  // ADR §Pattern semantics §strike: all pool voices emit simultaneously
  // per tick. Default pool = maj triad → 3 noteOns per tick.
  const host = makeHost({
    mode: "arp", scale: "major", root: 0,
    chordShape: "maj", seed: 0, feel: 0,
    arpPattern: "strike", arpSwing: 0,
  });
  host.noteIn(60, 100, 1, 0);
  const out = host.transportTick(0, 120, 0, 0);
  const noteOns = out.filter((e) => e.type === "noteOn");
  // Threshold 3: chord pulse at the arp rate.
  assert.equal(noteOns.length, 3);
  assert.deepEqual(
    noteOns.map((e) => e.pitch).sort((a, b) => a - b),
    [60, 64, 67],
  );
});

test("transportTick — bpm scales delayMs linearly", () => {
  // Threshold derivation: 1/16 @ 120 BPM = 125 ms; @ 60 BPM = 250 ms.
  // Tick at position 0.1 ppq → delayMs = (0.25 - 0.1) × msPerBeat.
  // pollIntervalMs=100 → lookahead 105 ms = 0.21 ppq at BPM 120, which
  // covers the 0.15 ppq gap to the next 1/16 tick.
  const host = makeHost({
    mode: "arp", scale: "major", root: 0,
    chordShape: "maj", seed: 0, feel: 0, arpSwing: 0,
  });
  host.noteIn(60, 100, 1, 0);
  const out = host.transportTick(0.1, 120, 50, 100);
  const on = out.find((e) => e.type === "noteOn");
  assert.ok(on);
  // Threshold 75: 0.15 ppq × 500 ms/beat.
  assert.equal(on!.delayMs, 75);
});

test("transportTick — variation cascade advances RNG even at variation=0", () => {
  // RNG-stream determinism: a tick always consumes 2 variation draws + 3
  // humanize draws + 1 nextArpIndex draw regardless of effect, so the
  // (seed, input, params) reproducibility contract holds bit-for-bit.
  // We can test this indirectly: two hosts with the same seed/params
  // produce identical tick outputs.
  const mkHost = () => makeHost({
    mode: "arp", scale: "major", root: 0,
    chordShape: "maj", seed: 42, feel: 1, arpSwing: 0,
    arpVariation: 0,
  });
  const a = mkHost();
  const b = mkHost();
  a.noteIn(60, 100, 1, 0);
  b.noteIn(60, 100, 1, 0);
  for (let i = 0; i < 5; i++) {
    const ra = a.transportTick(i * 0.25, 120, i * 125, 0);
    const rb = b.transportTick(i * 0.25, 120, i * 125, 0);
    assert.deepEqual(ra, rb, `tick ${i} must match across seeded hosts`);
  }
});

// ---------- scale mode ----------

test("scale mode — emits noteOn + noteOff + notePulse", () => {
  const host = makeHost({ scale: "major", root: 0 });
  const events = host.noteIn(60, 100, 1, 0);
  const { noteOns, noteOffs, pulses } = partition(events);
  assert.equal(noteOns.length, 1);
  assert.equal(noteOffs.length, 1);
  assert.equal(pulses.length, 1);
});

test("scale mode — in-scale pitch passes through unchanged", () => {
  const host = makeHost({ scale: "major", root: 0 });
  const events = host.noteIn(60, 100, 1, 0);
  const { noteOns } = partition(events);
  assert.equal(noteOns[0].pitch, 60);
});

test("scale mode — out-of-scale pitch snaps to nearest in-scale (tie-to-lower)", () => {
  const host = makeHost({ scale: "major", root: 0 });
  // C major: ..., 60 (C), 62 (D), 64 (E), ...
  // 61 (C#) → tie-to-lower per snapToScale → 60.
  // 63 (D#) → distances 1 (D) vs 1 (E) → tie-lower → 62 (D).
  const r1 = partition(host.noteIn(61, 100, 1, 0));
  assert.equal(r1.noteOns[0].pitch, 60);
  const r2 = partition(host.noteIn(63, 100, 1, 100));
  assert.equal(r2.noteOns[0].pitch, 62);
});

test("scale mode — output channel preserves input channel", () => {
  const host = makeHost();
  const r = partition(host.noteIn(60, 100, 7, 0));
  assert.equal(r.noteOns[0].channel, 7);
  assert.equal(r.noteOffs[0].channel, 7);
});

test("scale mode — single output (1-in-1-out, no chord expansion)", () => {
  // mode=scale ignores chordShape — even if shape is "13" (6 voices),
  // output stays at one note. concept.md §"Scale and chord modes":
  // "scale (snap to nearest scale degree, 1-in-1-out)".
  const host = makeHost({
    mode: "scale", scale: "major", root: 0, chordShape: "13",
  });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.noteOns.length, 1);
  assert.equal(r.noteOns[0].pitch, 60);
});

// ---------- inputChannel filter + MPE pass-through ----------
//
// concept.md §"Input handling": notes on channels OTHER than inputChannel
// pass through untouched. Load-bearing for MPE.

test("inputChannel=0 (omni) — all channels are matching, no pass-through", () => {
  const host = makeHost({ inputChannel: 0 });
  for (const ch of [1, 7, 16]) {
    const r = partition(host.noteIn(60, 100, ch, ch * 100));
    assert.equal(r.noteOns.length, 1, `channel ${ch} should match omni`);
    assert.equal(r.noteOns[0].pitch, 60);
  }
});

test("inputChannel=3 — non-matching channel passes through unchanged (MPE)", () => {
  // inputChannel=3 → ch=2 goes through pass-through path.
  const host = makeHost({ inputChannel: 3, scale: "major", root: 0 });
  // C#(61) on non-matching ch=2 → must NOT snap (61, not 60).
  const r = partition(host.noteIn(61, 100, 2, 0));
  assert.equal(r.noteOns.length, 1);
  assert.equal(r.noteOns[0].pitch, 61);
  assert.equal(r.noteOns[0].velocity, 100);
  assert.equal(r.noteOns[0].channel, 2);
});

test("inputChannel=3 — matching channel is quantized normally", () => {
  const host = makeHost({ inputChannel: 3, scale: "major", root: 0 });
  const r = partition(host.noteIn(61, 100, 3, 0));
  assert.equal(r.noteOns[0].pitch, 60); // C# → C
});

test("inputChannel=3 — chord mode does NOT expand pass-through channel", () => {
  const host = makeHost({
    inputChannel: 3, mode: "chord", scale: "major", root: 0,
  });
  // ch=2 (non-matching) → single pass-through.
  const r1 = partition(host.noteIn(60, 100, 2, 0));
  assert.equal(r1.noteOns.length, 1);
  // ch=3 (matching) → triad expansion (default chordShape "maj").
  const r2 = partition(host.noteIn(60, 100, 3, 100));
  assert.equal(r2.noteOns.length, 3);
});

test("inputChannel=3 — noteOff on non-matching channel emits pass-through noteOff", () => {
  const host = makeHost({ inputChannel: 3 });
  const r = host.noteOff(60, 2);
  assert.equal(r.length, 1);
  assert.equal(r[0].type, "noteOff");
  assert.equal(r[0].pitch, 60);
  assert.equal((r[0] as Extract<NoteEvent, { type: "noteOff" }>).channel, 2);
});

test("inputChannel=3 — noteOff on matching channel is silently consumed (gate-driven)", () => {
  const host = makeHost({ inputChannel: 3 });
  const r = host.noteOff(60, 3);
  assert.deepEqual(r, []);
});

// ---------- setParam dispatch ----------

test("setParam mode — accepts 'scale' | 'chord' | 'arp'", () => {
  const host = makeHost();
  for (const m of ["scale", "chord", "arp"] as const) {
    host.setParam("mode", m);
    assert.equal(host.getParams().mode, m);
  }
});

test("setParam mode — rejects pre-v2 'harmony' value (silent no-op)", () => {
  // v2 removed the "harmony" mode value; v3 keeps it removed. A stale
  // .maxpat / preset must not poison live state — the bridge's legacy-
  // state discard log is the user-facing signal.
  const host = makeHost();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  host.setParam("mode", "harmony" as any);
  assert.equal(host.getParams().mode, "scale");
});

test("setParam chordShape — accepts all 20 presets", () => {
  // ADR 004 §Chord shape primitive: 20 named presets, append-only on disk.
  const host = makeHost();
  const presets = [
    "maj", "m", "dim", "aug", "sus2", "sus4", "power",
    "maj7", "m7", "7", "m7b5", "dim7", "6", "m6",
    "add9", "maj9", "m9", "9", "13", "octave",
  ] as const;
  for (const p of presets) {
    host.setParam("chordShape", p);
    assert.equal(host.getParams().chordShape, p);
  }
});

test("setParam chordShape — rejects unknown shape (silent no-op)", () => {
  const host = makeHost({ chordShape: "maj" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  host.setParam("chordShape", "diminished7th" as any);
  assert.equal(host.getParams().chordShape, "maj");
});

test("setParam chordShape — takes effect on next noteIn (chord mode)", () => {
  // Sentinel: starting at default "maj" and switching to "m" mid-session
  // changes the next emission from [60, 64, 67] to [60, 63, 67].
  const host = makeHost({ mode: "chord", scale: "major", root: 0 });
  const r1 = partition(host.noteIn(60, 100, 1, 0));
  assert.deepEqual(r1.noteOns.map((e) => e.pitch), [60, 64, 67]);
  host.setParam("chordShape", "m");
  const r2 = partition(host.noteIn(60, 100, 1, 100));
  assert.deepEqual(r2.noteOns.map((e) => e.pitch), [60, 63, 67]);
});

test("setParam arpPattern — accepts all six pattern names", () => {
  const host = makeHost();
  for (const p of ["up", "down", "up-down", "random", "as-played", "strike"] as const) {
    host.setParam("arpPattern", p);
    assert.equal(host.getParams().arpPattern, p);
  }
});

test("setParam arpPattern — rejects unknown pattern (silent no-op)", () => {
  const host = makeHost({ arpPattern: "up" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  host.setParam("arpPattern", "spiral" as any);
  assert.equal(host.getParams().arpPattern, "up");
});

test("setParam arpRate — accepts all ten rate names", () => {
  const host = makeHost();
  const rates = [
    "1/4", "1/4D", "1/4T",
    "1/8", "1/8D", "1/8T",
    "1/16", "1/16D", "1/16T",
    "1/32",
  ] as const;
  for (const r of rates) {
    host.setParam("arpRate", r);
    assert.equal(host.getParams().arpRate, r);
  }
});

test("setParam arpRate — rejects unknown rate (silent no-op)", () => {
  const host = makeHost({ arpRate: "1/16" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  host.setParam("arpRate", "1/64" as any);
  assert.equal(host.getParams().arpRate, "1/16");
});

test("setParam arpAccent — replaces 16-step pattern with clamping", () => {
  // Bridge will deliver an array of 16 numbers; host clamps to [0, 127]
  // and defensive-copies the input.
  const host = makeHost();
  const pattern = [
    127, 100, 80, 60, 100, 100, 100, 100,
    100, 100, 100, 100, 100, 100, 100, 0,
  ];
  host.setParam("arpAccent", pattern);
  assert.deepEqual([...host.getParams().arpAccent], pattern);
  // Mutate caller's array — host must not alias.
  pattern[0] = 1;
  assert.equal(host.getParams().arpAccent[0], 127);
});

test("setParam arpAccent — out-of-range values clamp to [0, 127]", () => {
  const host = makeHost();
  const pattern = [
    -50, 0, 64, 127, 200,
    50, 50, 50, 50, 50,
    50, 50, 50, 50, 50, 50,
  ];
  host.setParam("arpAccent", pattern);
  const a = host.getParams().arpAccent;
  // Threshold: MIDI velocity is 0..127, clamping is two-sided.
  assert.equal(a[0], 0);    // -50 → 0
  assert.equal(a[3], 127);  // 127 → 127
  assert.equal(a[4], 127);  // 200 → 127
});

test("setParam arpAccent — short payload pads with 100 (default cell)", () => {
  // Defensive boundary: a partial-length payload (preset-load edge or
  // bug in the .maxpat plumbing) fills missing cells with the spec
  // default rather than corrupting the table.
  const host = makeHost();
  host.setParam("arpAccent", [80, 70, 60]); // length 3
  const a = host.getParams().arpAccent;
  assert.equal(a.length, 16);
  assert.equal(a[0], 80);
  assert.equal(a[2], 60);
  assert.equal(a[3], 100); // padded
  assert.equal(a[15], 100); // padded
});

test("setParam arpSlide — replaces 16-step pattern (booleans)", () => {
  const host = makeHost();
  const pattern = [
    true, false, true, false, true, false, true, false,
    false, true, false, true, false, true, false, true,
  ];
  host.setParam("arpSlide", pattern);
  assert.deepEqual([...host.getParams().arpSlide], pattern);
});

test("setParam arpSlide — truthy/falsy coercion (numeric 0/1 inputs)", () => {
  // The Max bridge typically sends per-cell ints (0 / 1) for live.toggle
  // widgets. Host accepts truthy/falsy values uniformly so a numeric
  // payload from Max lands as bools.
  const host = makeHost();
  host.setParam("arpSlide", [
    1, 0, 1, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 1,
  ] as unknown as boolean[]);
  const s = host.getParams().arpSlide;
  assert.equal(s[0], true);
  assert.equal(s[1], false);
  assert.equal(s[2], true);
  assert.equal(s[15], true);
});

test("setParam scale — rebuilds scalePitches", () => {
  const host = makeHost({ scale: "major", root: 0 });
  host.setParam("scale", "minor");
  assert.deepEqual(host.getScalePitches(), buildScalePitches("minor", 0));
});

test("setParam scale — accepts phrygian-dominant (ADR 004 §Scale additions)", () => {
  const host = makeHost();
  host.setParam("scale", "phrygian-dominant");
  assert.equal(host.getParams().scale, "phrygian-dominant");
  assert.deepEqual(
    host.getScalePitches(),
    buildScalePitches("phrygian-dominant", 0),
  );
});

test("setParam root — rebuilds scalePitches", () => {
  const host = makeHost({ scale: "major", root: 0 });
  host.setParam("root", 5);
  assert.deepEqual(host.getScalePitches(), buildScalePitches("major", 5));
});

test("setParam feel/drift — non-scale keys do NOT rebuild scalePitches", () => {
  const host = makeHost();
  const before = host.getScalePitches();
  host.setParam("feel", 0.5);
  host.setParam("drift", 0.5);
  assert.equal(host.getScalePitches(), before);
});

test("setParam seed — re-seeds humanizeRng so subsequent draws restart", () => {
  // setParam seed is the on-disk-preset entry point: setting it must
  // re-seed so deterministic playback is reproducible.
  const a = makeHost({ feel: 1 });
  a.setParam("seed", 99);
  const b = makeHost({ feel: 1 });
  b.setParam("seed", 99);
  assert.deepEqual(a.noteIn(60, 100, 1, 0), b.noteIn(60, 100, 1, 0));
});

// ---------- mode switch panic ----------

test("chord → scale mode switch — next noteIn produces single output", () => {
  const host = makeHost({ mode: "chord", scale: "major", root: 0 });
  const r1 = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r1.noteOns.length, 3); // default triad
  host.setParam("mode", "scale");
  const r2 = partition(host.noteIn(60, 100, 1, 100));
  assert.equal(r2.noteOns.length, 1);
});

test("scale → arp mode switch — noteIn populates pool, no synchronous emission", () => {
  // ADR Phase 3-B: arp mode noteIn no longer emits synchronously — it
  // populates the pool. Tick-driven emission is verified by separate
  // transportTick tests below.
  const host = makeHost({ mode: "scale", scale: "major", root: 0 });
  const r1 = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r1.noteOns.length, 1);
  host.setParam("mode", "arp");
  const r2 = partition(host.noteIn(60, 100, 1, 100));
  assert.equal(r2.noteOns.length, 0,
    "arp mode noteIn must not emit immediately (pool-driven)");
  // Threshold 3: pool populated with maj triad.
  assert.equal(host.getArpPoolForTest().length, 3);
});

// ---------- source step / timing ----------

test("noteIn first event — uses FIRST_EVENT_STEP_MS as sourceStepDuration", () => {
  // First event has no prior input to derive a gap from. Default 250 ms ≈
  // 16th note at 60 BPM / 8th at 120 BPM — generic musical fallback.
  // feel=0 → gateFinal = 1.0 → noteOff at +1.0 step.
  const host = makeHost();
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.noteOffs[0].delayMs, FIRST_EVENT_STEP_MS);
});

test("noteIn second event — sourceStepDuration = nowMs delta", () => {
  const host = makeHost();
  host.noteIn(60, 100, 1, 0);
  const r = partition(host.noteIn(60, 100, 1, 400));
  assert.equal(r.noteOffs[0].delayMs, 400);
});

test("noteIn — lastInputTime tracks across multiple events", () => {
  const host = makeHost();
  host.noteIn(60, 100, 1, 0);
  host.noteIn(60, 100, 1, 200); // delta = 200
  const r = partition(host.noteIn(60, 100, 1, 350)); // delta = 150
  assert.equal(r.noteOffs[0].delayMs, 150);
});

// ---------- humanize integration ----------

test("noteIn feel=0 — velocity = inputVelocity (no perturbation)", () => {
  const host = makeHost();
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.noteOns[0].velocity, 100);
});

test("noteIn — humanize draws are reproducible per seed", () => {
  const a = makeHost({ feel: 1, seed: 99 });
  const b = makeHost({ feel: 1, seed: 99 });
  const ra = a.noteIn(60, 100, 1, 0);
  const rb = b.noteIn(60, 100, 1, 0);
  assert.deepEqual(ra, rb);
});

test("noteIn — different seeds produce different humanize results", () => {
  const a = makeHost({ feel: 1, seed: 1 });
  const b = makeHost({ feel: 1, seed: 2 });
  const ra = partition(a.noteIn(60, 100, 1, 0));
  const rb = partition(b.noteIn(60, 100, 1, 0));
  assert.notEqual(ra.noteOns[0].velocity, rb.noteOns[0].velocity);
});

// ---------- notePulse outlet ----------

test("notePulse — pitch and velocity match scheduled noteOn", () => {
  const host = makeHost({ feel: 0.5, seed: 7 });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.pulses[0].pitch, r.noteOns[0].pitch);
  assert.equal(r.pulses[0].velocity, r.noteOns[0].velocity);
});

test("notePulse — delayMs lockstep with scheduled noteOn", () => {
  const host = makeHost({ feel: 1, seed: 13 });
  host.noteIn(60, 100, 1, 0);
  const r = partition(host.noteIn(60, 100, 1, 200));
  assert.equal(r.pulses[0].delayMs, r.noteOns[0].delayMs);
});

// ---------- transport / panic ----------

test("transportStart — resets driftState, lastInputTime, and humanizeRng", () => {
  const host = makeHost({ feel: 1, seed: 42 });
  host.noteIn(60, 100, 1, 0);
  host.noteIn(60, 100, 1, 100);
  host.transportStart();
  // After reset, the next event should reproduce the very first event
  // from a fresh-seed host.
  const fresh = makeHost({ feel: 1, seed: 42 });
  const a = host.noteIn(60, 100, 1, 0);
  const b = fresh.noteIn(60, 100, 1, 0);
  assert.deepEqual(a, b);
});

test("transportStop — flushes notesOn (no-op in mono v1, returns no events)", () => {
  const host = makeHost();
  host.noteIn(60, 100, 1, 0);
  assert.deepEqual(host.transportStop(), []);
});

test("panic — returns no events in mono v1, but resets state", () => {
  const host = makeHost();
  host.noteIn(60, 100, 1, 0);
  assert.deepEqual(host.panic(), []);
});

// ---------- humanize draw order through host (regression) ----------

test("noteIn draw order — host consumes velocity → gate → timing per event", () => {
  // Compare host's internal RNG advancement against the first nextU32 of
  // seedRng(seed). With feel=1 and inputVel=100, velocityFinal =
  // round(100 * (1 + aSigned)).
  const seed = 77;
  const host = makeHost({ feel: 1, seed });
  let m = seedRng(BigInt(seed));
  const u1 = nextU32(m); m = u1.state;
  const aSigned = u1.value / 0x80000000 - 1;
  const expectedVel = Math.max(1, Math.min(127, Math.round(100 * (1 + aSigned))));
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.noteOns[0].velocity, expectedVel);
});
