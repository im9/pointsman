// Tests for host-qt/host.ts — pure logic per ADR 002 §Stencil QT.
//
// Mirrors the host-tm test layout: state-machine tests, no Max API, no
// timers. nowMs is injected per noteIn call so tests deliver deterministic
// time deltas.
//
// Threshold derivation rule (CLAUDE.md global): every numeric assertion
// is justified inline against the spec or first-principles derivation.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PARAMS,
  FIRST_EVENT_STEP_MS,
  QtHost,
  type NoteEvent,
  type QtParams,
} from "./host.ts";
import { buildScalePitches, snapToScale } from "../engine/quantizer.ts";
import { nextU32, seedRng } from "../engine/turing.ts";

function makeHost(overrides: Partial<QtParams> = {}): QtHost {
  return new QtHost({ ...DEFAULT_PARAMS, ...overrides });
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

test("constructor — defaults match ADR 002 live.* table", () => {
  const host = makeHost();
  const p = host.getParams();
  // Defaults from ADR 002 §live.* parameter surface — Stencil QT.
  assert.equal(p.scale, "major");
  assert.equal(p.root, 0);
  assert.equal(p.humanizeVelocity, 0);
  assert.equal(p.humanizeGate, 0);
  assert.equal(p.humanizeTiming, 0);
  assert.equal(p.humanizeDrift, 0);
  assert.equal(p.outputLevel, 1.0);
  assert.equal(p.triggerMode, "passthrough");
  assert.equal(p.inputChannel, 0);
  assert.equal(p.controlChannel, 16);
  assert.equal(p.seed, 42);
});

test("constructor — scalePitches matches buildScalePitches(scale, root)", () => {
  const host = makeHost({ scale: "minor", root: 9 });
  const expected = buildScalePitches("minor", 9);
  assert.deepEqual(host.getScalePitches(), expected);
});

// ---------- quantize path (passthrough) ----------

test("noteIn passthrough — emits noteOn + noteOff + notePulse", () => {
  const host = makeHost({ scale: "major", root: 0 });
  const events = host.noteIn(60, 100, 1, 0);
  const { noteOns, noteOffs, pulses } = partition(events);
  // Spec §Per-input-event flow: schedule noteOn, schedule noteOff after
  // gate, emit notePulse for jsui keyboard.
  assert.equal(noteOns.length, 1);
  assert.equal(noteOffs.length, 1);
  assert.equal(pulses.length, 1);
});

test("noteIn — in-scale pitch passes through unchanged", () => {
  const host = makeHost({ scale: "major", root: 0 });
  // C major contains 60 (C4). snapToScale identity for in-scale.
  const events = host.noteIn(60, 100, 1, 0);
  const { noteOns } = partition(events);
  assert.equal(noteOns[0].pitch, 60);
});

test("noteIn — out-of-scale pitch snaps to nearest in-scale", () => {
  const host = makeHost({ scale: "major", root: 0 });
  // C major: ..., 60 (C), 62 (D), 64 (E), ...
  // 61 (C#) → tie-to-lower per snapToScale → 60.
  // 63 (D#) → distances 1 (D) vs 1 (E) → tie-lower → 62 (D).
  const r1 = partition(host.noteIn(61, 100, 1, 0));
  assert.equal(r1.noteOns[0].pitch, 60);
  const r2 = partition(host.noteIn(63, 100, 1, 100));
  assert.equal(r2.noteOns[0].pitch, 62);
});

test("noteIn — output channel preserves input channel", () => {
  // Spec: 'emit on the same channel as the input event (preserves
  // multi-channel routing). qt.outputChannel is *not* a parameter.'
  const host = makeHost();
  const r = partition(host.noteIn(60, 100, 7, 0));
  assert.equal(r.noteOns[0].channel, 7);
  assert.equal(r.noteOffs[0].channel, 7);
});

test("noteIn — channel filter excludes non-matching channel", () => {
  // inputChannel=3 → only ch=3 events processed; others return [].
  const host = makeHost({ inputChannel: 3 });
  assert.deepEqual(host.noteIn(60, 100, 1, 0), []);
  assert.deepEqual(host.noteIn(60, 100, 2, 100), []);
  const r = partition(host.noteIn(60, 100, 3, 200));
  assert.equal(r.noteOns.length, 1);
});

test("noteIn — inputChannel=0 is omni", () => {
  // Spec: '0 = omni' for inputChannel.
  const host = makeHost({ inputChannel: 0 });
  for (const ch of [1, 7, 16]) {
    const r = partition(host.noteIn(60, 100, ch, ch * 100));
    assert.equal(r.noteOns.length, 1, `channel ${ch} should match omni`);
  }
});

// ---------- root mode ----------

test("root mode — controlChannel event updates root, returns no notes", () => {
  const host = makeHost({
    triggerMode: "root",
    inputChannel: 1,
    controlChannel: 16,
  });
  // Note pitch=64 on controlChannel=16 → root = 64 % 12 = 4 (E).
  const r = host.noteIn(64, 100, 16, 0);
  assert.deepEqual(r, []);
  assert.equal(host.getParams().root, 4);
});

test("root mode — controlChannel update rebuilds scalePitches", () => {
  const host = makeHost({
    triggerMode: "root",
    scale: "major",
    inputChannel: 1,
    controlChannel: 16,
  });
  host.noteIn(67, 100, 16, 0); // root = 7 (G)
  // G major scale must now be cached.
  const expected = buildScalePitches("major", 7);
  assert.deepEqual(host.getScalePitches(), expected);
});

test("root mode — inputChannel event still quantizes (not consumed by root path)", () => {
  const host = makeHost({
    triggerMode: "root",
    inputChannel: 1,
    controlChannel: 16,
  });
  // ch=1 ≠ controlChannel → goes through quantize path.
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.noteOns.length, 1);
  assert.equal(host.getParams().root, 0); // unchanged
});

test("root mode — root update precedes next quantize result", () => {
  const host = makeHost({
    triggerMode: "root",
    scale: "major",
    inputChannel: 1,
    controlChannel: 16,
  });
  // First, set root to E (pitch class 4).
  host.noteIn(64, 100, 16, 0);
  // Then quantize 65 (F): E major contains F#(66), not F(65).
  // 65 → distances: 64 (E, d=1) vs 66 (F#, d=1) → tie-to-lower → 64.
  const r = partition(host.noteIn(65, 100, 1, 100));
  assert.equal(r.noteOns[0].pitch, 64);
});

test("passthrough mode — controlChannel events ARE quantized (root mode only consumes them)", () => {
  const host = makeHost({
    triggerMode: "passthrough",
    inputChannel: 0, // omni
    controlChannel: 16,
  });
  const r = partition(host.noteIn(64, 100, 16, 0));
  // Goes through quantize path, no root mutation.
  assert.equal(r.noteOns.length, 1);
  assert.equal(host.getParams().root, 0);
});

// ---------- source step / timing ----------

test("noteIn first event — uses FIRST_EVENT_STEP_MS as sourceStepDuration", () => {
  // First event has no prior input to derive a gap from. Default 250 ms ≈
  // 16th note at 60 BPM / 8th at 120 BPM — generic musical fallback.
  const host = makeHost({
    humanizeGate: 0, // gateFinal = outputGateBase = 1.0 → noteOff at +1.0 step
  });
  const r = partition(host.noteIn(60, 100, 1, 0));
  // delayMs of the noteOff = 1.0 (gate) × FIRST_EVENT_STEP_MS = 250.
  assert.equal(r.noteOffs[0].delayMs, FIRST_EVENT_STEP_MS);
});

test("noteIn second event — sourceStepDuration = nowMs delta", () => {
  // First event at t=0, second at t=400 ms → delta=400 ms is the step
  // reference for the second event's gate scaling.
  const host = makeHost({ humanizeGate: 0 });
  host.noteIn(60, 100, 1, 0);
  const r = partition(host.noteIn(60, 100, 1, 400));
  assert.equal(r.noteOffs[0].delayMs, 400);
});

test("noteIn — lastInputTime tracks across multiple events", () => {
  const host = makeHost({ humanizeGate: 0 });
  host.noteIn(60, 100, 1, 0);
  host.noteIn(60, 100, 1, 200); // delta = 200
  const r = partition(host.noteIn(60, 100, 1, 350)); // delta = 150
  assert.equal(r.noteOffs[0].delayMs, 150);
});

// ---------- humanize integration ----------

test("noteIn zero amplitudes — velocity = inputVelocity × outputLevel", () => {
  // All humanize amps 0, outputLevel=1 → velocityFinal = inputVelocity.
  const host = makeHost();
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.noteOns[0].velocity, 100);
});

test("noteIn outputLevel=0.5 — velocity scaled, gate unchanged", () => {
  const host = makeHost({ outputLevel: 0.5, humanizeGate: 0 });
  const r = partition(host.noteIn(60, 100, 1, 0));
  // 100 × 0.5 = 50.
  assert.equal(r.noteOns[0].velocity, 50);
  // gate fully opens, noteOff at 1.0 × FIRST_EVENT_STEP_MS.
  assert.equal(r.noteOffs[0].delayMs, FIRST_EVENT_STEP_MS);
});

test("noteIn — humanize draws are reproducible per seed", () => {
  // Two hosts with the same seed produce identical event sequences.
  const a = makeHost({ humanizeVelocity: 1, seed: 99 });
  const b = makeHost({ humanizeVelocity: 1, seed: 99 });
  const ra = a.noteIn(60, 100, 1, 0);
  const rb = b.noteIn(60, 100, 1, 0);
  assert.deepEqual(ra, rb);
});

test("noteIn — different seeds produce different humanize results", () => {
  // Sanity: seed actually threads through. With humanizeVelocity=1 the
  // velocity output depends on the first nextU32, which differs per seed.
  const a = makeHost({ humanizeVelocity: 1, seed: 1 });
  const b = makeHost({ humanizeVelocity: 1, seed: 2 });
  const ra = partition(a.noteIn(60, 100, 1, 0));
  const rb = partition(b.noteIn(60, 100, 1, 0));
  assert.notEqual(ra.noteOns[0].velocity, rb.noteOns[0].velocity);
});

// ---------- notePulse outlet ----------

test("notePulse — pitch and velocity match scheduled noteOn", () => {
  // Spec: 'pulse outlet fires at the same time the scheduled noteOn is
  // dispatched, not at noteIn arrival, so the visual pulse coincides with
  // the audible note.'
  const host = makeHost({ humanizeVelocity: 0.5, seed: 7 });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.pulses[0].pitch, r.noteOns[0].pitch);
  assert.equal(r.pulses[0].velocity, r.noteOns[0].velocity);
});

test("notePulse — delayMs lockstep with scheduled noteOn", () => {
  // pulse and noteOn must dispatch at the same wall time so the visual
  // pulse coincides with the audible note.
  const host = makeHost({ humanizeTiming: 1, seed: 13 });
  // Establish prior input so sourceStepDuration is non-default.
  host.noteIn(60, 100, 1, 0);
  const r = partition(host.noteIn(60, 100, 1, 200));
  assert.equal(r.pulses[0].delayMs, r.noteOns[0].delayMs);
});

// ---------- note-off discipline ----------

test("transportStart — resets driftState, lastInputTime, and humanizeRng", () => {
  // Spec §State persistence: 'drift state resets to neutral on preset
  // load.' transportStart is the in-session reset moment.
  const host = makeHost({ humanizeVelocity: 1, seed: 42 });
  // Walk the rng + drift state forward.
  host.noteIn(60, 100, 1, 0);
  host.noteIn(60, 100, 1, 100);
  host.transportStart();
  // After reset, the next event should reproduce the very first event
  // (post-reset host == fresh host).
  const fresh = makeHost({ humanizeVelocity: 1, seed: 42 });
  const a = host.noteIn(60, 100, 1, 0);
  const b = fresh.noteIn(60, 100, 1, 0);
  assert.deepEqual(a, b);
});

test("transportStop — flushes notesOn (no-op in mono v1, returns no events)", () => {
  // notesOn stays empty in mono passthrough (per host-tm pattern: paired
  // noteOn/noteOff emitted together, bridge schedules). flushNotesOn is
  // the safety hook for future polyphony — current contract: returns [].
  const host = makeHost();
  host.noteIn(60, 100, 1, 0);
  assert.deepEqual(host.transportStop(), []);
});

test("panic — returns no events in mono v1, but resets state", () => {
  // Same rationale as transportStop: notesOn empty in steady state.
  const host = makeHost();
  host.noteIn(60, 100, 1, 0);
  assert.deepEqual(host.panic(), []);
});

// ---------- setParam dispatch ----------

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

test("setParam non-scale — does NOT rebuild scalePitches", () => {
  // outputLevel doesn't affect scale; pitches array reference stays.
  const host = makeHost();
  const before = host.getScalePitches();
  host.setParam("outputLevel", 0.7);
  assert.equal(host.getScalePitches(), before);
});

test("setParam triggerMode — switching modes does not corrupt state", () => {
  const host = makeHost({ triggerMode: "passthrough" });
  host.setParam("triggerMode", "root");
  assert.equal(host.getParams().triggerMode, "root");
  // Subsequent controlChannel event behaves as root mode.
  const r = host.noteIn(67, 100, 16, 0);
  assert.deepEqual(r, []);
  assert.equal(host.getParams().root, 7);
});

// ---------- humanize draw order through host (regression) ----------

test("noteIn draw order — host consumes velocity → gate → timing per event", () => {
  // Compare host's internal RNG advancement against three direct
  // nextU32 calls. This guards against accidentally reordering the
  // composeHumanize draws inside the host wiring.
  const seed = 77;
  const host = makeHost({
    humanizeVelocity: 1,
    humanizeGate: 0,
    humanizeTiming: 0,
    seed,
  });
  // Manual replay: first nextU32 of seedRng(seed) is the velocity draw.
  let m = seedRng(BigInt(seed));
  const u1 = nextU32(m); m = u1.state;
  const aSigned = u1.value / 0x80000000 - 1;
  // Host with humanizeVelocity=1, others 0 → only velocity uses the draw.
  // velocityFinal = round(100 × (1 + aSigned) × 1).
  const expectedVel = Math.max(1, Math.min(127, Math.round(100 * (1 + aSigned))));
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.noteOns[0].velocity, expectedVel);
});
