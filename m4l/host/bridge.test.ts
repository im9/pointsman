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

test("chord mode — chordShape='power' collapses output to 2 voices", () => {
  // ADR 004 §Chord shape primitive: power = [0, 7] → root + 5th only.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.setParam("chordShape", "power");
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 2);
  assert.deepEqual(f.notes.map((n) => n.pitch), [60, 67]);
});

test("chord mode — scale-mode counter-test (1-in-1-out even with chord-shape set)", () => {
  // mode=scale ignores chordShape entirely.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  // Default mode=scale; chordShape defaults to "maj" but scale mode
  // does not expand.
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

// ---------- chordShape dispatch (ADR 004 Phase 3-A) ----------
//
// chordShape replaces the v2 harmonyV1..V3 slot widget cluster. Single
// live.menu enum with 20 named presets (ADR 004 §Chord shape primitive).
// The bridge accepts the string name OR the int index (Live's live.menu
// can be configured either way).

test("chordShape — accepts each of 20 preset strings", () => {
  const presets = [
    "maj", "m", "dim", "aug", "sus2", "sus4", "power",
    "maj7", "m7", "7", "m7b5", "dim7", "6", "m6",
    "add9", "maj9", "m9", "9", "13", "octave",
  ];
  for (const p of presets) {
    const f = makeFakeDeps();
    const b = new PointsmanBridge(f.deps);
    b.setParam("chordShape", p);
    assert.equal(getHostParamsForTest(b).chordShape, p,
      `chordShape '${p}' must land in host`);
  }
});

test("chordShape — accepts int index (live.menu parameter_type=1 path)", () => {
  // Live's live.menu can be configured to emit the int index rather than
  // the string label. ADR 004 §Persistence: on-disk index order is
  // append-only — index 0 = "maj", index 1 = "m", etc. The bridge
  // resolves both forms.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("chordShape", 0); // maj
  assert.equal(getHostParamsForTest(b).chordShape, "maj");
  b.setParam("chordShape", 7); // maj7
  assert.equal(getHostParamsForTest(b).chordShape, "maj7");
  b.setParam("chordShape", 19); // octave (last)
  assert.equal(getHostParamsForTest(b).chordShape, "octave");
});

test("chordShape — rejects out-of-range index / unknown string", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("chordShape", "maj7");
  b.setParam("chordShape", -1); // bad int
  b.setParam("chordShape", 20); // out of range
  b.setParam("chordShape", "diminished7th"); // bad string
  // Threshold: chordShape unchanged after every reject path.
  assert.equal(getHostParamsForTest(b).chordShape, "maj7");
});

test("chordShape — emission switches on next noteIn", () => {
  // C major + maj → [60, 64, 67]. After setParam to "m" → [60, 63, 67].
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.noteIn(60, 100, 1);
  assert.deepEqual(f.notes.map((n) => n.pitch), [60, 64, 67]);
  f.setNow(100);
  b.setParam("chordShape", "m");
  // chordShape is a FLUSH key — emits a noteOff for the sounding 60 first.
  // Filter to ON events (velocity > 0) for the post-switch emission only.
  const before = f.notes.length;
  b.noteIn(60, 100, 1);
  const after = f.notes.slice(before);
  const onAfter = after.filter((n) => n.velocity > 0).map((n) => n.pitch);
  assert.deepEqual(onAfter, [60, 63, 67]);
});

test("chordShape — mode-switch flush also fires on chordShape change", () => {
  // ADR 004: chordShape mid-hold must release sounding voices before the
  // next emission uses the new shape (parallel to scale/root/mode flush).
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.noteIn(60, 100, 1);
  // Threshold: 3 sounding notes from default maj triad.
  assert.equal(f.notes.filter((n) => n.velocity > 0).length, 3);
  // Sanity: no noteOff has fired yet.
  assert.equal(f.notes.filter((n) => n.velocity === 0).length, 0);
  // chordShape is in FLUSH_PARAM_KEYS — change triggers immediate noteOff
  // for all in-flight sounding pitches (any one would do; we just assert
  // the count of fired releases).
  b.setParam("chordShape", "m");
  // After flush, at least one noteOff fired for the pending humanize-gated
  // tail of the 3 sounding notes (gate=1.0 default → pendingNoteOffs all
  // 3). assert: noteOffs fired > 0.
  const noteOffs = f.notes.filter((n) => n.velocity === 0).length;
  assert.ok(noteOffs > 0, `expected ≥1 flush noteOff, got ${noteOffs}`);
});

// ---------- arp param dispatch (ADR 004 Phase 3-A) ----------

test("arpPattern — string and int dispatch both resolve", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("arpPattern", "down");
  assert.equal(getHostParamsForTest(b).arpPattern, "down");
  // Int index path: ARP_PATTERN_ORDER index 5 = "strike".
  b.setParam("arpPattern", 5);
  assert.equal(getHostParamsForTest(b).arpPattern, "strike");
});

test("arpPattern — rejects unknown value", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("arpPattern", "up");
  b.setParam("arpPattern", "spiral"); // bad string
  b.setParam("arpPattern", 99); // bad int
  assert.equal(getHostParamsForTest(b).arpPattern, "up");
});

test("arpRate — accepts each of 10 rate names", () => {
  const rates = [
    "1/4", "1/4D", "1/4T",
    "1/8", "1/8D", "1/8T",
    "1/16", "1/16D", "1/16T",
    "1/32",
  ];
  for (const r of rates) {
    const f = makeFakeDeps();
    const b = new PointsmanBridge(f.deps);
    b.setParam("arpRate", r);
    assert.equal(getHostParamsForTest(b).arpRate, r);
  }
});

test("arpRate — int index dispatch resolves", () => {
  // ARP_RATES table is append-only and index-stable: index 6 = "1/16".
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("arpRate", 6);
  assert.equal(getHostParamsForTest(b).arpRate, "1/16");
  b.setParam("arpRate", 9);
  assert.equal(getHostParamsForTest(b).arpRate, "1/32");
});

test("arpRate — rejects unknown rate", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("arpRate", "1/16");
  b.setParam("arpRate", "1/64");
  b.setParam("arpRate", -1);
  assert.equal(getHostParamsForTest(b).arpRate, "1/16");
});

test("arpOctaves — int 1..4 accepted, out-of-range rejected", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  // Threshold: ADR 004 §Arpeggiator parameters arpOctaves range = 1..4.
  for (const v of [1, 2, 3, 4]) {
    b.setParam("arpOctaves", v);
    assert.equal(getHostParamsForTest(b).arpOctaves, v);
  }
  b.setParam("arpOctaves", 4); // settle
  for (const bad of [0, 5, -1, 1.5, "two"]) {
    b.setParam("arpOctaves", bad);
    assert.equal(getHostParamsForTest(b).arpOctaves, 4,
      `arpOctaves=${bad} should be rejected (still 4)`);
  }
});

test("arpStepRepeats — int 1..8 accepted, out-of-range rejected", () => {
  // Threshold: ADR 004 §Arpeggiator parameters arpStepRepeats range = 1..8.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("arpStepRepeats", 8);
  assert.equal(getHostParamsForTest(b).arpStepRepeats, 8);
  b.setParam("arpStepRepeats", 9);
  assert.equal(getHostParamsForTest(b).arpStepRepeats, 8);
  b.setParam("arpStepRepeats", 0);
  assert.equal(getHostParamsForTest(b).arpStepRepeats, 8);
});

test("arpGate / arpVariation — 0..1 float, out-of-range clamps", () => {
  // Threshold: ADR 004 §Arpeggiator parameters — both are 0..1 floats.
  // Bridge clamps (parallel to feel / drift) so that an automation envelope
  // overshoot doesn't poison state.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("arpGate", 0.42);
  assert.equal(getHostParamsForTest(b).arpGate, 0.42);
  b.setParam("arpGate", -0.5); // clamps to 0
  assert.equal(getHostParamsForTest(b).arpGate, 0);
  b.setParam("arpGate", 2.0);  // clamps to 1
  assert.equal(getHostParamsForTest(b).arpGate, 1);
  b.setParam("arpVariation", 0.3);
  assert.equal(getHostParamsForTest(b).arpVariation, 0.3);
});

test("arpLatch — int 0/1 coerces to bool", () => {
  // Live.toggle widgets emit 0/1 ints. Bridge coerces.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("arpLatch", 1);
  assert.equal(getHostParamsForTest(b).arpLatch, true);
  b.setParam("arpLatch", 0);
  assert.equal(getHostParamsForTest(b).arpLatch, false);
});

test("arpSwing — 0..0.75 float with cap clamp", () => {
  // Threshold: ADR 004 §Arpeggiator parameters caps arpSwing at 0.75
  // (beyond that the swung tick collides with the next 16th).
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("arpSwing", 0.5);
  assert.equal(getHostParamsForTest(b).arpSwing, 0.5);
  b.setParam("arpSwing", 1.0); // clamps to 0.75
  assert.equal(getHostParamsForTest(b).arpSwing, 0.75);
  b.setParam("arpSwing", -0.1); // clamps to 0
  assert.equal(getHostParamsForTest(b).arpSwing, 0);
});

test("arpAccent — bulk-set 16-int array round-trips through bridge", () => {
  // Bulk-set whole-pattern message. Bridge accepts a 16-element array and
  // forwards verbatim; host clamps + pads.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  const pattern = [
    127, 100, 80, 60, 100, 100, 100, 100,
    100, 100, 100, 100, 100, 100, 100, 0,
  ];
  b.setParam("arpAccent", pattern);
  assert.deepEqual([...getHostParamsForTest(b).arpAccent], pattern);
});

test("arpAccent — non-array payload silently rejected", () => {
  // Threshold: bridge defends against gross type mismatch only; per-cell
  // validation is the host's job.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  const before = [...getHostParamsForTest(b).arpAccent];
  b.setParam("arpAccent", "not an array");
  b.setParam("arpAccent", 42);
  b.setParam("arpAccent", null);
  assert.deepEqual([...getHostParamsForTest(b).arpAccent], before);
});

test("arpSlide — bulk-set 16-bool array round-trips", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  const pattern = [
    true, false, false, true, false, false, false, true,
    false, false, true, false, false, false, true, false,
  ];
  b.setParam("arpSlide", pattern);
  assert.deepEqual([...getHostParamsForTest(b).arpSlide], pattern);
});

test("arpSlide — non-array payload silently rejected", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  const before = [...getHostParamsForTest(b).arpSlide];
  b.setParam("arpSlide", "no");
  b.setParam("arpSlide", 0);
  assert.deepEqual([...getHostParamsForTest(b).arpSlide], before);
});

// ---------- legacy harmony slot pids are silently discarded (v3) ----------

test("setParam removed pid — harmonyV[1-3]* logs once and no-ops", () => {
  // ADR 004 §Decision removes the 3-slot harmony widget cluster. A stale
  // .maxpat or pre-v3 preset firing these keys must not poison live
  // state. The .maxpat itself is updated in Phase 3-C; until then the
  // bridge tolerates them.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  const before = getHostParamsForTest(b).chordShape;
  b.setParam("harmonyV1Interval", "5th");
  b.setParam("harmonyV1Direction", "below");
  b.setParam("harmonyV2Direction", "off");
  b.setParam("harmonyV3Interval", "3rd");
  // chordShape unchanged — legacy pids did not leak into v3 state.
  assert.equal(getHostParamsForTest(b).chordShape, before);
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

// ---------- transportTick (ADR 004 Phase 3-B arp clock) ----------

test("transportTick — non-finite payload silently dropped", () => {
  // Threshold: bridge defends against malformed Max payloads (NaN /
  // undefined / -Infinity) so a [live.observer] race during patcher load
  // can't push the host into bad state.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "arp");
  b.noteIn(60, 100, 1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  b.transportTick(Number.NaN as any, 120);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  b.transportTick(0, undefined as any);
  // Threshold 0: no emits from malformed ticks.
  assert.equal(f.notes.length, 0);
});

test("transportTick — arp mode emits scheduled noteOn via dispatch", () => {
  // End-to-end: noteIn populates pool, transportTick at position 0 fires
  // tick immediately (delayMs=0), bridge emits via emitNote synchronously.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "arp");
  b.setParam("chordShape", "maj");
  b.setParam("arpSwing", 0);
  b.setParam("arpAccent", Array.from({ length: 16 }, () => 100));
  b.setParam("feel", 0);
  b.noteIn(60, 100, 1);
  // Pool now has {60, 64, 67}. First tick at position 0 → noteOn(60).
  b.transportTick(0, 120);
  const ons = f.notes.filter((n) => n.velocity > 0);
  // Threshold 1: up pattern emits the lowest pool voice.
  assert.equal(ons.length, 1);
  assert.equal(ons[0].pitch, 60);
});

test("transportTick — scale mode emits nothing", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  // Default mode=scale.
  b.noteIn(60, 100, 1);  // emits via scale path
  const before = f.notes.length;
  b.transportTick(0, 120);
  assert.equal(f.notes.length, before, "scale mode ignores transport ticks");
});
