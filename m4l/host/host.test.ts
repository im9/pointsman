// Tests for host/host.ts — Phase 5 v2 surface.
//
// State-machine tests, no Max API, no timers. nowMs is injected per
// noteIn call so tests deliver deterministic time deltas.
//
// v2 surface (concept.md §"Parameter surface (canonical)"):
//   scale | root | mode("scale"|"chord") | harmonyVoices |
//   feel | drift | inputChannel | seed
//
// Removed: humanizeVelocity/Gate/Timing, humanizeDrift, outputLevel,
// triggerMode, controlChannel, mode="harmony". chord mode is now
// 1-in-N-out chord expansion (formerly harmony mode's semantic, with the
// default voices pre-populated as a 1-3-5 triad).
//
// Threshold derivation rule (CLAUDE.md global): every numeric assertion
// is justified inline against the spec or first-principles derivation.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PARAMS,
  FIRST_EVENT_STEP_MS,
  PointsmanHost,
  type NoteEvent,
  type PointsmanParams,
} from "./host.ts";
import { buildScalePitches, diatonicShift } from "../engine/quantizer.ts";
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

test("DEFAULT_PARAMS — v2 surface (concept.md §Parameter surface)", () => {
  // Defaults pinned by concept.md §"Parameter surface (canonical)" and
  // §"Scale and chord modes". Default mode is `scale`; default
  // harmonyVoices is the 1-3-5 triad so `chord` ships "single note becomes
  // a chord" out of the box. feel/drift default to 0 (no humanize).
  assert.equal(DEFAULT_PARAMS.scale, "major");
  assert.equal(DEFAULT_PARAMS.root, 0);
  assert.equal(DEFAULT_PARAMS.mode, "scale");
  assert.equal(DEFAULT_PARAMS.feel, 0);
  assert.equal(DEFAULT_PARAMS.drift, 0);
  assert.equal(DEFAULT_PARAMS.inputChannel, 0);
  // 1-3-5 triad: 3rd above + 5th above. Pinned in concept.md §"Scale and
  // chord modes": "harmonyVoices defaults to [{3, above}, {5, above}] on
  // new plugin instances".
  assert.deepEqual(DEFAULT_PARAMS.harmonyVoices, [
    { interval: 3, direction: "above" },
    { interval: 5, direction: "above" },
  ]);
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
  // (all equal) with prob (1/2^24)^31 ≈ 4e-225. Anything < 32 distinct
  // values is acceptable signal of randomness; we test > 16 as a generous
  // lower bound (one collision per pair = ~16 distinct under heavy birthday
  // collisions; prob of < 16 distinct in 32 draws on 2^24 is vanishingly
  // small — N=32, k=16, M=2^24, P(X≤16) ≈ 0 within float precision).
  assert.ok(seeds.size > 16,
    `expected > 16 distinct seeds across 32 fresh constructs, got ${seeds.size}`);
});

test("constructor — scalePitches matches buildScalePitches(scale, root)", () => {
  const host = makeHost({ scale: "minor", root: 9 });
  const expected = buildScalePitches("minor", 9);
  assert.deepEqual(host.getScalePitches(), expected);
});

test("constructor — default harmonyVoices produces 1-3-5 triad on noteIn (chord mode)", () => {
  // The cleanest single observable of the default-triad invariant: in chord
  // mode, an out-of-the-box host on C major with input C(60) emits
  // {60, 64, 67}. concept.md §"Scale and chord modes": "chord mode out of
  // the box emits a diatonic 1-3-5 triad rooted on the input pitch".
  const host = makeHost({ mode: "chord" });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.deepEqual(r.noteOns.map((e) => e.pitch), [60, 64, 67]);
});

// ---------- quantize path (scale mode) ----------

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
  // C major contains 60 (C4). snapToScale identity for in-scale.
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
  // concept.md §"Input handling": each note routes to the input channel
  // (no outputChannel parameter — preserves multi-channel routing).
  const host = makeHost();
  const r = partition(host.noteIn(60, 100, 7, 0));
  assert.equal(r.noteOns[0].channel, 7);
  assert.equal(r.noteOffs[0].channel, 7);
});

test("scale mode — single output (1-in-1-out, no chord expansion)", () => {
  // mode=scale ignores harmonyVoices — even if voices are populated,
  // output stays at one note. concept.md §"Scale and chord modes":
  // "scale (snap to nearest scale degree, 1-in-1-out)".
  const host = makeHost({
    mode: "scale",
    harmonyVoices: [
      { interval: 3, direction: "above" },
      { interval: 5, direction: "above" },
    ],
  });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.noteOns.length, 1);
  assert.equal(r.noteOns[0].pitch, 60);
});

// ---------- inputChannel filter + MPE pass-through ----------
//
// concept.md §"Input handling": notes on channels OTHER than inputChannel
// pass through untouched. This is load-bearing for MPE — per-note
// channels carrying pitch bend / pressure / timbre flow to the downstream
// instrument unmodified while the master channel is chord-expanded.

test("inputChannel=0 (omni) — all channels are matching, no pass-through", () => {
  const host = makeHost({ inputChannel: 0 });
  for (const ch of [1, 7, 16]) {
    const r = partition(host.noteIn(60, 100, ch, ch * 100));
    assert.equal(r.noteOns.length, 1, `channel ${ch} should match omni`);
    assert.equal(r.noteOns[0].pitch, 60);
  }
});

test("inputChannel=3 — non-matching channel passes through unchanged (MPE)", () => {
  // inputChannel=3 → ch=2 goes through pass-through path: pitch unchanged
  // (no quantize), velocity unchanged (no humanize), channel preserved.
  const host = makeHost({ inputChannel: 3, scale: "major", root: 0 });
  // C#(61) on non-matching ch=2 → must NOT snap (61, not 60).
  const r = partition(host.noteIn(61, 100, 2, 0));
  assert.equal(r.noteOns.length, 1);
  assert.equal(r.noteOns[0].pitch, 61);
  assert.equal(r.noteOns[0].velocity, 100);
  assert.equal(r.noteOns[0].channel, 2);
});

test("inputChannel=3 — matching channel is quantized normally", () => {
  // Sanity counter-test: ch=3 still snaps as expected.
  const host = makeHost({ inputChannel: 3, scale: "major", root: 0 });
  const r = partition(host.noteIn(61, 100, 3, 0));
  assert.equal(r.noteOns[0].pitch, 60); // C# → C
});

test("inputChannel=3 — chord mode does NOT expand pass-through channel", () => {
  // The chord expansion is a transformation on the matching channel only.
  // MPE per-note channels would multiply absurdly if expanded.
  const host = makeHost({
    inputChannel: 3,
    mode: "chord",
    scale: "major",
    root: 0,
  });
  // ch=2 (non-matching) → single pass-through.
  const r1 = partition(host.noteIn(60, 100, 2, 0));
  assert.equal(r1.noteOns.length, 1);
  // ch=3 (matching) → triad expansion (default harmonyVoices).
  const r2 = partition(host.noteIn(60, 100, 3, 100));
  assert.equal(r2.noteOns.length, 3);
});

test("inputChannel=3 — noteOff on non-matching channel emits pass-through noteOff", () => {
  // Pass-through noteIn needs a paired pass-through noteOff — otherwise
  // the synth holds the note forever after release.
  const host = makeHost({ inputChannel: 3 });
  const r = host.noteOff(60, 2);
  // Threshold 1: one immediate noteOff emitted on the same channel.
  assert.equal(r.length, 1);
  assert.equal(r[0].type, "noteOff");
  assert.equal(r[0].pitch, 60);
  assert.equal((r[0] as Extract<NoteEvent, { type: "noteOff" }>).channel, 2);
});

test("inputChannel=3 — noteOff on matching channel is silently consumed (gate-driven)", () => {
  // For the matching channel, output noteOff is scheduled by humanize gate
  // at noteIn dispatch. Input noteOff is suppressed (concept.md §"Per-event
  // humanize" implicit: gate length is humanize-driven, not input-driven).
  const host = makeHost({ inputChannel: 3 });
  const r = host.noteOff(60, 3);
  assert.deepEqual(r, []);
});

// ---------- chord mode (1-in-N-out expansion) ----------
//
// concept.md §"Scale and chord modes": chord mode emits the scale-snapped
// input plus N diatonic voices configured by harmonyVoices (length 0..3).
// Default voices = [{3 above}, {5 above}] = 1-3-5 triad.

test("chord mode — default 1-3-5 triad (input C in C major)", () => {
  // Defaults via makeHost + mode override → harmonyVoices = [{3, above},
  // {5, above}]. Input C(60), C major → primary 60, voice1=3rd above =
  // diatonicShift(60, 3, above) = 64 (E), voice2=5th above = 67 (G).
  const host = makeHost({ mode: "chord", scale: "major", root: 0 });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.deepEqual(r.noteOns.map((e) => e.pitch), [60, 64, 67]);
});

test("chord mode — non-tonic input gets its diatonic triad (D in C major)", () => {
  // Input D(62), C major. diatonicShift(62, 3, above) = 65 (F), (5, above)
  // = 69 (A). Diatonic triad rooted on D = D-F-A.
  const host = makeHost({ mode: "chord", scale: "major", root: 0 });
  const r = partition(host.noteIn(62, 100, 1, 0));
  assert.deepEqual(r.noteOns.map((e) => e.pitch), [62, 65, 69]);
});

test("chord mode — out-of-scale input snaps first then expands", () => {
  // concept.md §"Scale and chord modes": "Out-of-scale input is snapped to
  // the nearest scale degree first, so e.g. C# in C major → C, then the
  // chord is built rooted on C."
  // C#(61) → snap to C(60) → 1-3-5 triad on C = [60, 64, 67].
  const host = makeHost({ mode: "chord", scale: "major", root: 0 });
  const r = partition(host.noteIn(61, 100, 1, 0));
  assert.deepEqual(r.noteOns.map((e) => e.pitch), [60, 64, 67]);
});

test("chord mode — empty harmonyVoices collapses to 1-in-1-out (identical to scale)", () => {
  // concept.md: "clearing all voices collapses chord to 1-in-1-out
  // (identical to scale mode)."
  const host = makeHost({
    mode: "chord",
    scale: "major",
    root: 0,
    harmonyVoices: [],
  });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.noteOns.length, 1);
  assert.equal(r.noteOns[0].pitch, 60);
});

test("chord mode — voice pitches match diatonicShift on a non-C scale", () => {
  // A minor (root=9), input A(69). Scale degrees include 69(A), 71(B),
  // 72(C), 74(D), 76(E), 77(F), 79(G), 81(A).
  //   3rd above A → 2 steps up → 72 (C)
  //   6th below A → 5 steps down → 60 (C below: A→G→F→E→D→C)
  const host = makeHost({
    mode: "chord",
    scale: "minor",
    root: 9,
    harmonyVoices: [
      { interval: 3, direction: "above" },
      { interval: 6, direction: "below" },
    ],
  });
  const r = partition(host.noteIn(69, 100, 1, 0));
  assert.equal(r.noteOns[0].pitch, 69);
  assert.equal(r.noteOns[1].pitch, 72);
  assert.equal(r.noteOns[2].pitch, 60);
  // Mirror against the engine helper — guards against future renames.
  const scalePitches = buildScalePitches("minor", 9);
  assert.equal(r.noteOns[1].pitch, diatonicShift(69, 3, "above", scalePitches));
  assert.equal(r.noteOns[2].pitch, diatonicShift(69, 6, "below", scalePitches));
});

test("chord mode — declared voice order preserved in output", () => {
  // Output convention: primary first, then voices in harmonyVoices[] order.
  const host = makeHost({
    mode: "chord",
    scale: "major",
    root: 0,
    harmonyVoices: [
      { interval: 5, direction: "above" }, // G=67
      { interval: 3, direction: "below" }, // A below = 57
      { interval: 3, direction: "above" }, // E=64
    ],
  });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.deepEqual(r.noteOns.map((e) => e.pitch), [60, 67, 57, 64]);
});

test("chord mode — all voices share noteOn delayMs (one humanize draw)", () => {
  // Voices are different pitches of the *same* musical event; one humanize
  // draw covers them all so timing is lockstep.
  const host = makeHost({
    mode: "chord",
    scale: "major",
    root: 0,
    feel: 1,
    seed: 13,
    harmonyVoices: [
      { interval: 3, direction: "above" },
      { interval: 5, direction: "above" },
    ],
  });
  // Establish prior input so sourceStepDuration > 0 → timingOffset can
  // actually deflect non-zero.
  host.noteIn(60, 100, 1, 0);
  const r = partition(host.noteIn(60, 100, 1, 200));
  assert.equal(r.noteOns.length, 3);
  const d0 = r.noteOns[0].delayMs;
  assert.equal(r.noteOns[1].delayMs, d0);
  assert.equal(r.noteOns[2].delayMs, d0);
});

test("chord mode — all voices share noteOff delayMs (lockstep release)", () => {
  const host = makeHost({
    mode: "chord",
    scale: "major",
    root: 0,
    feel: 1,
    seed: 21,
    harmonyVoices: [
      { interval: 3, direction: "above" },
      { interval: 5, direction: "above" },
    ],
  });
  host.noteIn(60, 100, 1, 0);
  const r = partition(host.noteIn(60, 100, 1, 200));
  assert.equal(r.noteOffs.length, 3);
  const d0 = r.noteOffs[0].delayMs;
  assert.equal(r.noteOffs[1].delayMs, d0);
  assert.equal(r.noteOffs[2].delayMs, d0);
});

test("chord mode — all voices share velocity (one humanize draw)", () => {
  const host = makeHost({
    mode: "chord",
    scale: "major",
    root: 0,
    feel: 0.5,
    seed: 7,
    harmonyVoices: [
      { interval: 3, direction: "above" },
      { interval: 5, direction: "above" },
    ],
  });
  const r = partition(host.noteIn(60, 100, 1, 0));
  const v0 = r.noteOns[0].velocity;
  assert.equal(r.noteOns[1].velocity, v0);
  assert.equal(r.noteOns[2].velocity, v0);
});

test("chord mode — notePulse fires for every voiced note", () => {
  // Keyboard should highlight every sounded key, not just the primary.
  const host = makeHost({
    mode: "chord",
    scale: "major",
    root: 0,
    harmonyVoices: [
      { interval: 3, direction: "above" },
      { interval: 5, direction: "above" },
    ],
  });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.pulses.length, r.noteOns.length);
  assert.deepEqual(
    [...r.pulses.map((e) => e.pitch)].sort((a, b) => a - b),
    [...r.noteOns.map((e) => e.pitch)].sort((a, b) => a - b),
  );
});

test("chord mode — output channel preserves input channel for all voices", () => {
  const host = makeHost({
    mode: "chord",
    scale: "major",
    root: 0,
    harmonyVoices: [{ interval: 3, direction: "above" }],
  });
  const r = partition(host.noteIn(60, 100, 7, 0));
  for (const e of r.noteOns) assert.equal(e.channel, 7);
  for (const e of r.noteOffs) assert.equal(e.channel, 7);
});

test("chord → scale mode switch — next noteIn produces single output", () => {
  const host = makeHost({
    mode: "chord",
    scale: "major",
    root: 0,
  });
  const r1 = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r1.noteOns.length, 3); // default triad
  host.setParam("mode", "scale");
  const r2 = partition(host.noteIn(60, 100, 1, 100));
  assert.equal(r2.noteOns.length, 1);
});

// ---------- setParam dispatch ----------

test("setParam mode — accepts 'scale' | 'chord' only", () => {
  const host = makeHost();
  host.setParam("mode", "chord");
  assert.equal(host.getParams().mode, "chord");
  host.setParam("mode", "scale");
  assert.equal(host.getParams().mode, "scale");
});

test("setParam mode — rejects pre-v2 'harmony' value (silent no-op)", () => {
  // concept.md §"Parameter surface" v2 removes the harmony mode value.
  // mode set to a removed value is a silent no-op so a stale .maxpat /
  // preset doesn't poison live state — the bridge's v1-state-discard log
  // is the user-facing signal.
  const host = makeHost();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  host.setParam("mode", "harmony" as any);
  assert.equal(host.getParams().mode, "scale");
});

test("setParam harmonyVoices — replaces voice list, takes effect immediately", () => {
  // Bridge will deliver a HarmonyVoice[] payload; host stores and uses it
  // on the next noteIn. C major, input C(60):
  //   5th above → 67 (G)
  //   5th below → 53 (F below: 59→57→55→53)
  const host = makeHost({
    mode: "chord",
    scale: "major",
    root: 0,
    harmonyVoices: [{ interval: 3, direction: "above" }],
  });
  host.setParam("harmonyVoices", [
    { interval: 5, direction: "above" },
    { interval: 5, direction: "below" },
  ]);
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.noteOns.length, 3);
  assert.deepEqual(r.noteOns.map((e) => e.pitch), [60, 67, 53]);
});

test("setParam harmonyVoices — over-cap input is clamped at MAX_HARMONY_VOICES", () => {
  // concept.md §"Parameter surface" pins harmonyVoices length at 0..3.
  // Defense-in-depth at the host boundary, mirroring vst setHarmonyVoices()
  // clamp at kHarmonyVoicesMax.
  const host = makeHost();
  host.setParam("harmonyVoices", [
    { interval: 3, direction: "above" },
    { interval: 4, direction: "above" },
    { interval: 5, direction: "above" },
    { interval: 6, direction: "above" }, // 4th — must be dropped
  ]);
  const stored = host.getParams().harmonyVoices;
  // Threshold 3: concept.md §"Parameter surface" + concept.md §"Scale and
  // chord modes" cap.
  assert.equal(stored.length, 3);
  assert.deepEqual(stored.map((v) => v.interval), [3, 4, 5]);
});

test("constructor — over-cap initialParams.harmonyVoices is clamped", () => {
  const host = makeHost({
    harmonyVoices: [
      { interval: 3, direction: "above" },
      { interval: 4, direction: "above" },
      { interval: 5, direction: "above" },
      { interval: 6, direction: "below" },
    ],
  });
  assert.equal(host.getParams().harmonyVoices.length, 3);
});

test("setParam scale — rebuilds scalePitches", () => {
  const host = makeHost({ scale: "major", root: 0 });
  host.setParam("scale", "minor");
  assert.deepEqual(host.getScalePitches(), buildScalePitches("minor", 0));
});

test("setParam root — rebuilds scalePitches", () => {
  const host = makeHost({ scale: "major", root: 0 });
  host.setParam("root", 5);
  assert.deepEqual(host.getScalePitches(), buildScalePitches("major", 5));
});

test("setParam feel/drift — non-scale keys do NOT rebuild scalePitches", () => {
  // Identity-via-reference check: scalePitches array reference unchanged.
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
  // First event at t=0, second at t=400 ms → delta=400 ms is the step
  // reference for the second event's gate scaling.
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
  // feel=0 collapses all three axes to identity. velocityFinal = inputVel.
  const host = makeHost();
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.noteOns[0].velocity, 100);
});

test("noteIn — humanize draws are reproducible per seed", () => {
  // Two hosts with the same seed produce identical event sequences.
  const a = makeHost({ feel: 1, seed: 99 });
  const b = makeHost({ feel: 1, seed: 99 });
  const ra = a.noteIn(60, 100, 1, 0);
  const rb = b.noteIn(60, 100, 1, 0);
  assert.deepEqual(ra, rb);
});

test("noteIn — different seeds produce different humanize results", () => {
  // Sanity: seed actually threads through. With feel=1 the first nextU32
  // differs per seed → velocityFinal differs.
  const a = makeHost({ feel: 1, seed: 1 });
  const b = makeHost({ feel: 1, seed: 2 });
  const ra = partition(a.noteIn(60, 100, 1, 0));
  const rb = partition(b.noteIn(60, 100, 1, 0));
  assert.notEqual(ra.noteOns[0].velocity, rb.noteOns[0].velocity);
});

// ---------- notePulse outlet ----------

test("notePulse — pitch and velocity match scheduled noteOn", () => {
  // Pulse outlet fires at the same time the scheduled noteOn dispatches.
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

// ---------- note-off discipline ----------

test("transportStart — resets driftState, lastInputTime, and humanizeRng", () => {
  // concept.md §"Transport": humanize state resets on transport start so
  // each play loop reproduces bit-for-bit from the same seed.
  const host = makeHost({ feel: 1, seed: 42 });
  host.noteIn(60, 100, 1, 0);
  host.noteIn(60, 100, 1, 100);
  host.transportStart();
  // After reset, the next event should reproduce the very first event.
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
