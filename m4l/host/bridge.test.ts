// Tests for host/bridge.ts — Phase 5 v2 surface.
//
// Pattern: BridgeDeps faked with recorders so we assert against captured
// emit / schedule calls. No Max API, no real timers, no setTimeout.
//
// v2 changes (see docs/ai/m4l-phase5-handoff.md):
//   - mode enum {scale, chord} (drop "harmony")
//   - chord = 1-in-N-out chord expansion (formerly harmony semantic)
//   - drop pids: humanizeVelocity/Gate/Timing/Drift, outputLevel,
//     triggerMode, controlChannel
//   - add pids: feel / drift
//   - drop the chordChanged outlet entirely (no held-context concept)
//   - bridge passes random seed through to host on construct (host draws
//     when not overridden) — concept.md §"Per-event humanize"
//
// Threshold derivation rule (CLAUDE.md global): every numeric assertion is
// justified inline against the spec or first-principles derivation.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dispatchEventForTest,
  getHostParamsForTest,
  getPendingCountsForTest,
  PointsmanBridge,
  type BridgeDeps,
} from "./bridge.ts";
import { FIRST_EVENT_STEP_MS } from "./host.ts";

interface NoteCall {
  pitch: number;
  velocity: number;
  channel: number;
}
interface OutletCall {
  channel: string;
  args: Array<number | string>;
}
interface ScheduledCall {
  ms: number;
  cb: () => void;
}

function makeFakeDeps(): {
  deps: BridgeDeps;
  notes: NoteCall[];
  outlets: OutletCall[];
  scheduled: ScheduledCall[];
  setNow: (n: number) => void;
  flushAll: () => void;
} {
  const notes: NoteCall[] = [];
  const outlets: OutletCall[] = [];
  const scheduled: ScheduledCall[] = [];
  let nowVal = 0;
  const deps: BridgeDeps = {
    emitNote: (pitch, velocity, channel) => notes.push({ pitch, velocity, channel }),
    emitOutlet: (channel, ...args) => outlets.push({ channel, args }),
    now: () => nowVal,
    scheduleAfter: (ms, cb) => scheduled.push({ ms, cb }),
  };
  return {
    deps,
    notes,
    outlets,
    scheduled,
    setNow: (n) => { nowVal = n; },
    flushAll: () => { for (const s of scheduled) s.cb(); },
  };
}

// ---------- construction ----------

test("constructor — does NOT emit ready; emits initial scaleChanged", () => {
  const f = makeFakeDeps();
  new PointsmanBridge(f.deps);
  // 'ready' MUST be emitted by pointsman.mjs AFTER every Max.addHandler()
  // install. Emitting from the bridge constructor races handler installation
  // and the patcher's setParam dispatches drop with "Node script not ready".
  // The constructor emits 'scaleChanged' to seed the jsui keyboard.
  const channels = f.outlets.map((o) => o.channel);
  assert.ok(!channels.includes("ready"), "ready must NOT be emitted from constructor");
  const sc = f.outlets.find((o) => o.channel === "scaleChanged");
  assert.ok(sc, "scaleChanged must be emitted on init");
  assert.deepEqual(sc!.args, ["major", 0]);
});

test("constructor — fresh instance picks a random seed (not 0)", () => {
  // concept.md §"Per-event humanize": new instances pick a random seed so
  // two parallel devices don't phase-lock. Verify across N fresh bridges
  // that not all seeds are identical (statistical: birthday collision on
  // 2^24 across N=16 is ~1 in 1e6, so >= 2 distinct is overwhelmingly
  // likely; we test for > 8 distinct as a comfortable lower bound).
  const seeds = new Set<number>();
  for (let i = 0; i < 16; i++) {
    const f = makeFakeDeps();
    const b = new PointsmanBridge(f.deps);
    seeds.add(getHostParamsForTest(b).seed);
  }
  assert.ok(seeds.size > 8,
    `expected > 8 distinct random seeds across 16 fresh bridges, got ${seeds.size}`);
});

test("constructor — explicit initialParams.seed overrides random draw", () => {
  // Preset-load path: bridge constructed with explicit seed → that seed
  // lands in the host (not the random fallback).
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps, { initialParams: { seed: 12345 } });
  assert.equal(getHostParamsForTest(b).seed, 12345);
});

// ---------- noteIn quantize path ----------

test("noteIn — emits noteOn (immediate) + noteOff (scheduled at gate)", () => {
  // Defaults: feel=0 → timingOffset=0 → noteOn immediate; gateFinal=1.0 ×
  // FIRST_EVENT_STEP_MS=250 → noteOff scheduled at 250 ms.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  f.setNow(1000);
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 1);
  assert.deepEqual(f.notes[0], { pitch: 60, velocity: 100, channel: 1 });
  const noteOffSchedules = f.scheduled.filter((s) => s.ms === FIRST_EVENT_STEP_MS);
  assert.equal(noteOffSchedules.length, 1);
});

test("noteIn — emits notePulse outlet at scheduled noteOn time", () => {
  // notePulse fires at the same moment as scheduled noteOn. With feel=0
  // (default) timingOffset=0 → immediate dispatch.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.noteIn(60, 100, 1);
  const pulse = f.outlets.find((o) => o.channel === "notePulse");
  assert.ok(pulse, "notePulse outlet must fire");
  // pitch=snapped (60 in major), velocity=100 (feel=0 → unchanged).
  assert.deepEqual(pulse!.args, [60, 100]);
});

test("noteIn — passes deps.now() as nowMs to host (sourceStep tracking)", () => {
  // Two sequential noteIns at now=0 then now=400 → sourceStepDuration=400 ms
  // → noteOff at 1.0 × 400 = 400 ms.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  f.setNow(0);
  b.noteIn(60, 100, 1);
  const firstScheduledCount = f.scheduled.length;
  f.setNow(400);
  b.noteIn(60, 100, 1);
  const newScheds = f.scheduled.slice(firstScheduledCount);
  const has400 = newScheds.some((s) => s.ms === 400);
  assert.ok(has400, `expected noteOff schedule at 400 ms, got ${JSON.stringify(newScheds.map((s) => s.ms))}`);
});

test("noteIn — non-finite inputs ignored (boundary defense)", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  const notesBefore = f.notes.length;
  b.noteIn(Number.NaN, 100, 1);
  b.noteIn(60, 100, Number.NaN);
  assert.equal(f.notes.length, notesBefore);
});

test("noteIn — out-of-range pitch / velocity / channel ignored (MIDI domain defense)", () => {
  // MIDI domain: pitch 0..127, velocity 0..127, channel 0..16. CLAUDE.md
  // "Live runtime gotchas": channel 0 valid for track-internal MIDI from an
  // upstream M4L device.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  const before = f.notes.length;
  b.noteIn(-1, 100, 1);
  b.noteIn(128, 100, 1);
  b.noteIn(60, -1, 1);
  b.noteIn(60, 128, 1);
  b.noteIn(60, 100, -1);
  b.noteIn(60, 100, 17);
  assert.equal(f.notes.length, before, "all out-of-range noteIns must be silently dropped");
  f.setNow(0);
  b.noteIn(60, 100, 0);
  assert.equal(f.notes.length, before + 1, "channel=0 (track-internal) must be accepted");
  f.setNow(500);
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, before + 2);
});

test("noteOff — out-of-range pitch / channel ignored", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  assert.doesNotThrow(() => {
    b.noteOff(-1, 1);
    b.noteOff(128, 1);
    b.noteOff(60, -1);
    b.noteOff(60, 17);
    b.noteOff(60, 0);
  });
});

// ---------- negative delay clamp ----------

test("negative delayMs — dispatched immediately (not scheduled)", () => {
  // High feel produces negative timingOffsets on roughly half the draws.
  // The input event has already arrived — we cannot dispatch in the past.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps, {
    initialParams: { feel: 1, seed: 7 },
  });
  for (let i = 0; i < 10; i++) {
    f.setNow(i * 100);
    b.noteIn(60, 100, 1);
  }
  const negScheds = f.scheduled.filter((s) => s.ms < 0);
  assert.equal(negScheds.length, 0, "no schedule should have a negative ms");
});

// ---------- setParam validation (v2 surface) ----------

test("setParam scale — accepts valid scale name", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  const before = f.outlets.length;
  b.setParam("scale", "minor");
  const sc = f.outlets.slice(before).find((o) => o.channel === "scaleChanged");
  assert.ok(sc);
  assert.deepEqual(sc!.args, ["minor", 0]);
});

test("setParam scale — rejects unknown scale name", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  const before = f.outlets.length;
  b.setParam("scale", "diminished");
  const sc = f.outlets.slice(before).find((o) => o.channel === "scaleChanged");
  assert.equal(sc, undefined);
});

test("setParam root — validates 0..11 integer range", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("root", -1);
  b.setParam("root", 12);
  b.setParam("root", 1.5);
  // None should trigger scaleChanged.
  const initialOutletCount = 1; // scaleChanged from constructor
  assert.equal(f.outlets.length, initialOutletCount);

  b.setParam("root", 7);
  const sc = f.outlets[f.outlets.length - 1];
  assert.equal(sc.channel, "scaleChanged");
  assert.deepEqual(sc.args, ["major", 7]);
});

test("setParam feel — accepts 0..1 float, clamps", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("feel", 1.5); // → 1.0 (clamped)
  assert.equal(getHostParamsForTest(b).feel, 1.0);
  b.setParam("feel", -0.5); // → 0.0
  assert.equal(getHostParamsForTest(b).feel, 0);
  b.setParam("feel", 0.5);
  assert.equal(getHostParamsForTest(b).feel, 0.5);
});

test("setParam drift — accepts 0..1 float, clamps", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("drift", 1.5);
  assert.equal(getHostParamsForTest(b).drift, 1.0);
  b.setParam("drift", -0.1);
  assert.equal(getHostParamsForTest(b).drift, 0);
  b.setParam("drift", 0.95);
  assert.equal(getHostParamsForTest(b).drift, 0.95);
});

test("setParam inputChannel — validates 0..16 integer", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("inputChannel", -1);
  b.setParam("inputChannel", 17);
  b.setParam("inputChannel", 1.5);
  // No mutation on out-of-range.
  assert.equal(getHostParamsForTest(b).inputChannel, 0); // default
  b.setParam("inputChannel", 5);
  assert.equal(getHostParamsForTest(b).inputChannel, 5);
  b.setParam("inputChannel", 0); // omni
  assert.equal(getHostParamsForTest(b).inputChannel, 0);
});

test("setParam unknown key — silent no-op", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("nope", 42);
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 1);
});

// ---------- v1 state discard (concept.md §Parameter surface v2 removes) ----------
//
// concept.md §"Parameter surface": v2 removes humanizeVelocity, humanizeGate,
// humanizeTiming, humanizeDrift, outputLevel, triggerMode, controlChannel,
// and the harmony mode value. Stale .maxpat / preset payloads that arrive
// via setParam for any of these are silent no-ops (the host params object
// has no slot for them; the bridge must not write through).

test("setParam removed pids — humanizeVelocity / Gate / Timing / Drift discarded silently", () => {
  // v1 pid arrives on a stale patch — must not mutate any v2 param.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  const before = { ...getHostParamsForTest(b) };
  b.setParam("humanizeVelocity", 0.5);
  b.setParam("humanizeGate", 0.5);
  b.setParam("humanizeTiming", 0.5);
  b.setParam("humanizeDrift", 0.5);
  const after = getHostParamsForTest(b);
  assert.equal(after.feel, before.feel);
  assert.equal(after.drift, before.drift);
});

test("setParam removed pid — outputLevel discarded silently", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  // outputLevel had v1 semantic of scaling velocity. Verify it has no
  // effect: a default noteIn with outputLevel=0.1 still produces velocity=100.
  b.setParam("outputLevel", 0.1);
  b.noteIn(60, 100, 1);
  assert.equal(f.notes[0].velocity, 100);
});

test("setParam removed pid — triggerMode discarded silently", () => {
  // triggerMode was the "root from controlChannel" toggle in v1; concept.md
  // §"Input handling" v2 paragraph documents removal. Verify a stale
  // setParam("triggerMode", "root") does not enable any chord-root coupling.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("triggerMode", "root");
  // noteIn on channel 16 (formerly the default controlChannel) must NOT
  // mutate root — it just quantizes normally.
  b.noteIn(64, 100, 16);
  assert.equal(getHostParamsForTest(b).root, 0);
  assert.equal(f.notes.length, 1, "stale triggerMode must not suppress the quantize emit");
});

test("setParam removed pid — controlChannel discarded silently", () => {
  // concept.md §"Input handling" v2: "There is no separate control channel".
  // setParam("controlChannel", N) is a stale v1 message and must be a no-op.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("controlChannel", 5);
  // No chordChanged outlet exists in v2.
  const ccCount = f.outlets.filter((o) => o.channel === "chordChanged").length;
  assert.equal(ccCount, 0, "chordChanged outlet must be removed from v2");
});

test("setParam mode — accepts 'scale' | 'chord' and rejects pre-v2 'harmony'", () => {
  // concept.md §"Parameter surface (canonical)" v2: mode = scale | chord.
  // 'harmony' is the merged-away value; a stale payload must be rejected.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "harmony"); // v1 value, rejected
  // After rejection, host stays at default 'scale'.
  assert.equal(getHostParamsForTest(b).mode, "scale");
  // Sanity: 'chord' is accepted.
  b.setParam("mode", "chord");
  assert.equal(getHostParamsForTest(b).mode, "chord");
  // Other unknown also rejected.
  b.setParam("mode", "polyrhythm");
  assert.equal(getHostParamsForTest(b).mode, "chord");
});

// ---------- chord mode (1-in-N-out via host) ----------
//
// The bridge has no chord-context state in v2 — it's a thin protocol layer.
// These tests verify the wiring (noteIn → host.noteIn → emit cascade)
// produces the correct multi-note output in chord mode.

test("chord mode — default harmony slots produce 1-3-5 triad on a single noteIn", () => {
  // Bridge defaults: harmonySlots = [V1=3-above, V2=5-above, V3=off] →
  // projected harmonyVoices = [{3,above},{5,above}]. Input C(60) C major
  // → primary 60 + voice1=E(64) + voice2=G(67).
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.noteIn(60, 100, 1);
  assert.deepEqual(f.notes.map((n) => n.pitch), [60, 64, 67]);
});

test("chord mode — clearing V1 and V2 collapses output to 1-in-1-out", () => {
  // Set V1 and V2 direction to "off" → projected list empty → chord mode
  // emits single output.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.setParam("harmonyV1Direction", "off");
  b.setParam("harmonyV2Direction", "off");
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 1);
  assert.equal(f.notes[0].pitch, 60);
});

test("chord mode — scale-mode counter-test (1-in-1-out even with default voices)", () => {
  // mode=scale ignores harmonyVoices entirely.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  // Default mode=scale; bridge default voices are populated, but scale mode
  // does not emit them.
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 1);
});

// ---------- inputChannel pass-through (MPE) ----------
//
// concept.md §"Input handling": notes on non-matching channels pass
// through untouched (load-bearing for MPE per-note channels).

test("inputChannel — non-matching channel passes through unchanged", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("inputChannel", 3);
  // C# on ch=2 (non-matching) → emit verbatim (no snap to C).
  b.noteIn(61, 100, 2);
  assert.equal(f.notes.length, 1);
  assert.deepEqual(f.notes[0], { pitch: 61, velocity: 100, channel: 2 });
});

test("inputChannel — chord mode does NOT expand pass-through channel", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("inputChannel", 3);
  b.setParam("mode", "chord");
  // ch=2 non-matching → single pass-through.
  b.noteIn(60, 100, 2);
  assert.equal(f.notes.length, 1);
  // ch=3 matching → triad.
  f.setNow(100);
  b.noteIn(60, 100, 3);
  // 1 pass-through + 3 chord-expanded = 4 total.
  assert.equal(f.notes.length, 4);
});

// ---------- harmony slot collection (bridge → host harmonyVoices) ----------
//
// 3 live.menu pairs (interval + direction) per slot. Defaults:
//   V1 = { 3rd, above }
//   V2 = { 5th, above }
//   V3 = { 3rd, off }
// → projected harmonyVoices = [{3,above},{5,above}] = 1-3-5 triad.

test("harmony slot V1 — direction='off' removes voice from filtered output", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.setParam("harmonyV1Direction", "off");
  b.setParam("harmonyV2Direction", "off"); // also off
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 1);
});

test("harmony slot — interval enum strings map to diatonic shifts", () => {
  // Parametric over the 4 interval values for V1. Direction="above", input
  // C(60) in C major. Diatonic distances:
  //   3rd → 64 (E, 2 scale steps), 4th → 65 (F, 3 steps)
  //   5th → 67 (G, 4 steps),       6th → 69 (A, 5 steps)
  const cases: Array<[string, number]> = [
    ["3rd", 64], ["4th", 65], ["5th", 67], ["6th", 69],
  ];
  for (const [intervalStr, expected] of cases) {
    const f = makeFakeDeps();
    const b = new PointsmanBridge(f.deps);
    b.setParam("mode", "chord");
    b.setParam("harmonyV2Direction", "off"); // drop V2 to isolate V1
    b.setParam("harmonyV1Interval", intervalStr);
    b.setParam("harmonyV1Direction", "above");
    b.noteIn(60, 100, 1);
    assert.deepEqual(
      f.notes.map((n) => n.pitch),
      [60, expected],
      `harmonyV1Interval='${intervalStr}' should produce voice at ${expected}`,
    );
  }
});

test("harmony slot — direction='below' inverts the diatonic shift", () => {
  // C major, 3rd↓ = 57 (A below: 2 scale steps).
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.setParam("harmonyV2Direction", "off");
  b.setParam("harmonyV1Interval", "3rd");
  b.setParam("harmonyV1Direction", "below");
  b.noteIn(60, 100, 1);
  assert.deepEqual(f.notes.map((n) => n.pitch), [60, 57]);
});

test("harmony slot — invalid interval is silently rejected (slot unchanged)", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.setParam("harmonyV2Direction", "off");
  b.setParam("harmonyV1Interval", "5th");
  b.setParam("harmonyV1Direction", "above");
  b.setParam("harmonyV1Interval", "7th");
  b.setParam("harmonyV1Interval", "3");
  b.setParam("harmonyV1Interval", "third");
  b.noteIn(60, 100, 1);
  // Voice still uses 5th above (G=67).
  assert.deepEqual(f.notes.map((n) => n.pitch), [60, 67]);
});

test("harmony slot — invalid direction is silently rejected", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.setParam("harmonyV2Direction", "off");
  b.setParam("harmonyV1Direction", "above");
  b.setParam("harmonyV1Direction", "diagonal"); // invalid
  b.noteIn(60, 100, 1);
  assert.deepEqual(f.notes.map((n) => n.pitch), [60, 64]);
});

test("harmony slots — all 3 active produces primary + 3 voiced notes", () => {
  // V1=3rd above (E=64), V2=5th above (G=67), V3=3rd below (A=57). C major.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  // V1 defaults to 3rd above, V2 defaults to 5th above — already set.
  b.setParam("harmonyV3Interval", "3rd");
  b.setParam("harmonyV3Direction", "below");
  b.noteIn(60, 100, 1);
  assert.deepEqual(f.notes.map((n) => n.pitch), [60, 64, 67, 57]);
});

test("harmony slots — gap-filtering preserves declared slot order (V2 only)", () => {
  // V1=off, V2 active (5th above default), V3=off → filtered voices = [V2].
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.setParam("harmonyV1Direction", "off");
  // V2 stays at default {5th, above}.
  b.noteIn(60, 100, 1);
  assert.deepEqual(f.notes.map((n) => n.pitch), [60, 67]);
});

test("harmony slot — out-of-range slot index (V4) is silent no-op", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.setParam("harmonyV4Interval", "3rd");
  b.setParam("harmonyV4Direction", "above");
  // Default slots still drive output (1-3-5 triad).
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 3);
});

// ---------- transport / panic ----------

test("panic — releases sounding pitch by flushing in-flight noteOffs", () => {
  // bridge tracks scheduled noteOffs; panic emits an immediate noteOff for
  // every sounding pitch and cancels the original schedule.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.noteIn(60, 100, 1);
  const beforeNotes = f.notes.length;
  b.panic();
  assert.equal(f.notes.length, beforeNotes + 1);
  const released = f.notes[f.notes.length - 1];
  assert.equal(released.pitch, 60);
  assert.equal(released.velocity, 0);
});

test("transportStart — flushes notesOn and resets host state", () => {
  // After transportStart, host humanizeRng + drift + lastInputTime reset.
  const fA = makeFakeDeps();
  const a = new PointsmanBridge(fA.deps, {
    initialParams: { feel: 1, seed: 42 },
  });
  fA.setNow(0);
  a.noteIn(60, 100, 1);
  a.transportStart();
  fA.setNow(1000);
  a.noteIn(60, 100, 1);

  const fB = makeFakeDeps();
  const bFresh = new PointsmanBridge(fB.deps, {
    initialParams: { feel: 1, seed: 42 },
  });
  fB.setNow(1000);
  bFresh.noteIn(60, 100, 1);

  // Last emitted noteOns' velocities match — post-restart bridge state ==
  // fresh-bridge state for the same seed.
  assert.equal(
    fA.notes[fA.notes.length - 1].velocity,
    fB.notes[fB.notes.length - 1].velocity,
  );
});

test("transportStop — host transportStop dispatched, no throw", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.transportStop();
  assert.ok(true);
});

// ---------- scheduling lockstep ----------

test("notePulse and noteOn dispatch at same wall time (lockstep)", () => {
  // Pulse outlet fires at the same time the scheduled noteOn dispatches.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps, {
    initialParams: { feel: 0.5, seed: 13 },
  });
  f.setNow(0);
  b.noteIn(60, 100, 1);
  f.setNow(500);
  const beforeScheduled = f.scheduled.length;
  const beforeOutlets = f.outlets.length;
  const beforeNotes = f.notes.length;
  b.noteIn(60, 100, 1);

  const newScheds = f.scheduled.slice(beforeScheduled);
  for (const s of newScheds) s.cb();
  const allOutlets = f.outlets.slice(beforeOutlets);
  const allNotes = f.notes.slice(beforeNotes);
  const totalPulses = allOutlets.filter((o) => o.channel === "notePulse").length;
  const totalNotesNonZero = allNotes.filter((n) => n.velocity > 0).length;
  assert.equal(totalPulses, 1, "exactly one notePulse per noteIn");
  assert.equal(totalNotesNonZero, 1, "exactly one (primary-voice) noteOn per noteIn");
});

// ---------- in-flight noteOff cancellation ----------

test("cancellation — transportStop emits immediate noteOff + scheduled noteOff is a no-op", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 1);
  assert.equal(f.notes[0].velocity, 100);
  b.transportStop();
  assert.equal(f.notes.length, 2);
  assert.equal(f.notes[1].pitch, 60);
  assert.equal(f.notes[1].velocity, 0);
  assert.equal(f.notes[1].channel, 1);
  f.flushAll();
  assert.equal(f.notes.length, 2, "originally scheduled noteOff must be cancelled");
});

test("cancellation — panic emits immediate noteOff + scheduled noteOff is a no-op", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.noteIn(72, 80, 2);
  assert.equal(f.notes.length, 1);
  b.panic();
  assert.equal(f.notes.length, 2);
  assert.equal(f.notes[1].pitch, 72);
  assert.equal(f.notes[1].velocity, 0);
  assert.equal(f.notes[1].channel, 2);
  f.flushAll();
  assert.equal(f.notes.length, 2);
});

test("cancellation — setParam scale|root|mode flushes sounding pitches; setParam seed (non-flush) does not", () => {
  // Flush keys: scale, root, mode (drop triggerMode — removed).
  const flushKeys: Array<{ key: string; value: unknown }> = [
    { key: "scale", value: "minor" },
    { key: "root", value: 5 },
    { key: "mode", value: "chord" },
  ];
  for (const { key, value } of flushKeys) {
    const f = makeFakeDeps();
    const b = new PointsmanBridge(f.deps);
    b.noteIn(60, 100, 1);
    const before = f.notes.length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b as any).setParam(key, value);
    assert.ok(
      f.notes.length > before,
      `setParam ${key} must flush sounding pitches (before=${before}, after=${f.notes.length})`,
    );
    const off = f.notes[f.notes.length - 1];
    assert.equal(off.velocity, 0, `setParam ${key} must emit noteOff (velocity 0)`);
  }
  // Non-flush key.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.noteIn(60, 100, 1);
  const before = f.notes.length;
  b.setParam("seed", 99);
  assert.equal(f.notes.length, before, "setParam seed must NOT flush sounding pitches");
});

test("setParam seed — clamps to [0, 0xffffff] (float32 round-trip bound)", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);

  b.setParam("seed", 0xffffff);
  assert.equal(getHostParamsForTest(b).seed, 0xffffff,
    "seed = 2^24-1 must be accepted");

  b.setParam("seed", 0x1000000);
  assert.equal(getHostParamsForTest(b).seed, 0xffffff,
    "seed > 2^24-1 must be rejected");

  b.setParam("seed", -1);
  assert.equal(getHostParamsForTest(b).seed, 0xffffff,
    "negative seed must be rejected");

  b.setParam("seed", 0);
  assert.equal(getHostParamsForTest(b).seed, 0);
});

test("cancellation — re-triggering same pitch+channel cancels the prior pending noteOff", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 1);
  f.setNow(50);
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 2);
  f.flushAll();
  const noteOffs = f.notes.filter((n) => n.velocity === 0);
  assert.equal(noteOffs.length, 1, `expected 1 noteOff (second note's), got ${noteOffs.length}`);
});

test("panic — cancels scheduled noteOn so it never fires after the panic", () => {
  // Pre-fix m4l bug: scheduled noteOn fired AFTER panic, audibly post-stop.
  // vst emitPanicTo's pending_.clear() does the same; this m4l mirror.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  dispatchEventForTest(b, {
    type: "noteOn",
    pitch: 60,
    velocity: 100,
    channel: 1,
    delayMs: 50,
  });
  dispatchEventForTest(b, {
    type: "noteOff",
    pitch: 60,
    channel: 1,
    delayMs: 150,
  });
  assert.equal(f.notes.length, 0);
  assert.deepEqual(getPendingCountsForTest(b), { noteOns: 1, noteOffs: 1 });

  b.panic();
  assert.equal(f.notes.length, 0, "panic must not synthesise a noteOff for a note that never sounded");
  assert.deepEqual(getPendingCountsForTest(b), { noteOns: 0, noteOffs: 0 });

  f.flushAll();
  assert.equal(f.notes.length, 0, "scheduled noteOn / noteOff must not fire after panic");
});

test("panic — emits immediate noteOff for sounding pitches with scheduled noteOff", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  dispatchEventForTest(b, {
    type: "noteOn",
    pitch: 60,
    velocity: 100,
    channel: 1,
    delayMs: 0,
  });
  dispatchEventForTest(b, {
    type: "noteOff",
    pitch: 60,
    channel: 1,
    delayMs: 100,
  });
  assert.equal(f.notes.length, 1, "immediate noteOn fires");
  assert.deepEqual(getPendingCountsForTest(b), { noteOns: 0, noteOffs: 1 });

  b.panic();
  assert.equal(f.notes.length, 2);
  assert.equal(f.notes[1].velocity, 0);
  assert.equal(f.notes[1].pitch, 60);
  assert.deepEqual(getPendingCountsForTest(b), { noteOns: 0, noteOffs: 0 });

  f.flushAll();
  assert.equal(f.notes.length, 2, "scheduled noteOff must not fire again");
});

test("cancellation — channel scope: same pitch on different channels is independent", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  f.setNow(0);
  b.noteIn(60, 100, 1);
  f.setNow(100);
  b.noteIn(60, 100, 2);
  assert.equal(f.notes.length, 2);
  b.transportStop();
  const offs = f.notes.filter((n) => n.velocity === 0);
  assert.equal(offs.length, 2, "transportStop must release both channels");
  const channels = offs.map((n) => n.channel).sort();
  assert.deepEqual(channels, [1, 2]);
});
