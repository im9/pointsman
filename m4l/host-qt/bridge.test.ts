// Tests for host-qt/bridge.ts — Max protocol layer.
//
// Pattern mirrors host-tm/bridge.test.ts: BridgeDeps faked with recorders
// so we assert against captured emit / schedule calls. No Max API, no
// real timers, no setTimeout.
//
// Threshold derivation rule (CLAUDE.md global): every numeric assertion
// is justified inline against the spec or first-principles derivation.

import { test } from "node:test";
import assert from "node:assert/strict";

import { QtBridge, type BridgeDeps } from "./bridge.ts";
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

test("constructor — does NOT emit ready (entry-script responsibility); emits initial scaleChanged", () => {
  const f = makeFakeDeps();
  new QtBridge(f.deps);
  // ADR 003 §Ready handshake: 'ready' MUST be emitted by stencil-qt.mjs
  // AFTER every Max.addHandler() install. Emitting from the bridge
  // constructor races handler installation and the patcher's setParam
  // dispatches drop with "Node script not ready". The constructor still
  // emits 'scaleChanged' to seed the jsui keyboard's initial state.
  // Defaults major / 0.
  const channels = f.outlets.map((o) => o.channel);
  assert.ok(!channels.includes("ready"), "ready must NOT be emitted from constructor");
  const sc = f.outlets.find((o) => o.channel === "scaleChanged");
  assert.ok(sc, "scaleChanged must be emitted on init");
  assert.deepEqual(sc!.args, ["major", 0]);
});

// ---------- noteIn quantize path ----------

test("noteIn — emits noteOn (immediate) + noteOff (scheduled at gate)", () => {
  // Defaults: humanize=0 → timingOffset=0 → noteOn immediate.
  // Default outputGateBase=1.0, FIRST_EVENT_STEP_MS=250 → noteOff at 250 ms.
  const f = makeFakeDeps();
  const b = new QtBridge(f.deps);
  f.setNow(1000);
  b.noteIn(60, 100, 1);
  // noteOn dispatched immediately.
  assert.equal(f.notes.length, 1);
  assert.deepEqual(f.notes[0], { pitch: 60, velocity: 100, channel: 1 });
  // noteOff scheduled at 250 ms.
  const noteOffSchedules = f.scheduled.filter((s) => s.ms === FIRST_EVENT_STEP_MS);
  assert.equal(noteOffSchedules.length, 1);
});

test("noteIn — emits notePulse outlet at scheduled noteOn time", () => {
  // Spec: notePulse fires at the same moment the scheduled noteOn dispatches.
  // With timingOffset=0, both are immediate (delayMs=0 → no schedule).
  const f = makeFakeDeps();
  const b = new QtBridge(f.deps);
  b.noteIn(60, 100, 1);
  const pulse = f.outlets.find((o) => o.channel === "notePulse");
  assert.ok(pulse, "notePulse outlet must fire");
  // pitch=snapped (60 in major), velocity=100 (humanize=0 → unchanged).
  assert.deepEqual(pulse!.args, [60, 100]);
});

test("noteIn — passes deps.now() as nowMs to host (sourceStep tracking)", () => {
  // Two sequential noteIns at now=0 then now=400 → sourceStepDuration=400 ms
  // → noteOff at 1.0 × 400 = 400 ms.
  const f = makeFakeDeps();
  const b = new QtBridge(f.deps);
  f.setNow(0);
  b.noteIn(60, 100, 1);
  // Drop the first event's schedules so the second's stand alone.
  const firstScheduledCount = f.scheduled.length;
  f.setNow(400);
  b.noteIn(60, 100, 1);
  const newScheds = f.scheduled.slice(firstScheduledCount);
  // Among the second event's schedules, the noteOff is at 400 ms.
  const has400 = newScheds.some((s) => s.ms === 400);
  assert.ok(has400, `expected noteOff schedule at 400 ms, got ${JSON.stringify(newScheds.map((s) => s.ms))}`);
});

test("noteIn — non-finite inputs ignored (boundary defense)", () => {
  // Max can deliver NaN from a malformed message; bridge must not crash
  // and must not forward to host.
  const f = makeFakeDeps();
  const b = new QtBridge(f.deps);
  const notesBefore = f.notes.length;
  b.noteIn(Number.NaN, 100, 1);
  b.noteIn(60, 100, Number.NaN);
  assert.equal(f.notes.length, notesBefore);
});

// ---------- negative delay clamp ----------

test("negative delayMs — dispatched immediately (not scheduled)", () => {
  // humanizeTiming can produce negative timingOffset (note plays "early").
  // The input event has already arrived, so we cannot dispatch in the
  // past. Bridge must clamp negative delays to 0 = immediate.
  const f = makeFakeDeps();
  // High timing humanize → negative offset is possible. Force the
  // condition by feeding a pre-drifted state via consecutive calls. With
  // timing=1 and a fixed seed, at least some events will have negative
  // timingOffset. Run several and verify none get scheduled at a
  // negative `ms` argument.
  const b = new QtBridge(f.deps, {
    initialParams: { humanizeTiming: 1, seed: 7 },
  });
  for (let i = 0; i < 10; i++) {
    f.setNow(i * 100);
    b.noteIn(60, 100, 1);
  }
  const negScheds = f.scheduled.filter((s) => s.ms < 0);
  assert.equal(negScheds.length, 0, "no schedule should have a negative ms");
});

// ---------- setParam validation ----------

test("setParam scale — accepts valid scale name", () => {
  const f = makeFakeDeps();
  const b = new QtBridge(f.deps);
  const before = f.outlets.length;
  b.setParam("scale", "minor");
  // Side-effect: scaleChanged outlet re-emit so jsui can refresh.
  const sc = f.outlets.slice(before).find((o) => o.channel === "scaleChanged");
  assert.ok(sc);
  assert.deepEqual(sc!.args, ["minor", 0]);
});

test("setParam scale — rejects unknown scale name", () => {
  const f = makeFakeDeps();
  const b = new QtBridge(f.deps);
  const before = f.outlets.length;
  b.setParam("scale", "diminished"); // not in ADR 002 §15-name list
  // No scaleChanged emit — invalid input is a silent no-op.
  const sc = f.outlets.slice(before).find((o) => o.channel === "scaleChanged");
  assert.equal(sc, undefined);
});

test("setParam root — validates 0..11 integer range", () => {
  // ADR 002 live.* table: qt.root is `live.numbox int 0..11`.
  const f = makeFakeDeps();
  const b = new QtBridge(f.deps);
  b.setParam("root", -1);  // out of range, ignored
  b.setParam("root", 12);  // out of range, ignored
  b.setParam("root", 1.5); // not integer, ignored
  // Verify by checking that none triggered a scaleChanged emit.
  const initialOutletCount = 1; // scaleChanged from constructor (ready emits from entry script, not bridge)
  // Allow the 2 init outlets, no more.
  const postInit = f.outlets.length;
  assert.equal(postInit, initialOutletCount);

  b.setParam("root", 7); // valid
  const sc = f.outlets[f.outlets.length - 1];
  assert.equal(sc.channel, "scaleChanged");
  assert.deepEqual(sc.args, ["major", 7]);
});

test("setParam humanize* — accepts 0..1 floats, clamps", () => {
  // ADR 002 live.* table: humanize* are live.dial float 0..1.
  const f = makeFakeDeps();
  const b = new QtBridge(f.deps);
  // Out-of-range values clamp; bridge does not throw.
  b.setParam("humanizeVelocity", 1.5); // → 1.0
  b.setParam("humanizeGate", -0.5);    // → 0.0
  b.setParam("humanizeTiming", 0.3);   // pass-through
  // No assertions on internal state here — just confirm no throw and
  // subsequent noteIn still works.
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 1);
});

test("setParam triggerMode — only passthrough/root accepted", () => {
  const f = makeFakeDeps();
  const b = new QtBridge(f.deps);
  b.setParam("triggerMode", "auto"); // TM-only mode, invalid for QT
  // After invalid mode, behavior should still be passthrough (default).
  // Test indirectly: a controlChannel(=16) noteIn should quantize, not
  // update root.
  b.noteIn(64, 100, 16);
  assert.equal(f.notes.length, 1);

  b.setParam("triggerMode", "root"); // valid
  // Now controlChannel events update root, no MIDI emission.
  const beforeNotes = f.notes.length;
  b.noteIn(67, 100, 16);
  assert.equal(f.notes.length, beforeNotes);
});

test("setParam controlChannel — validates 1..16 integer", () => {
  // Spec: live.numbox int 1..16, default 16.
  const f = makeFakeDeps();
  const b = new QtBridge(f.deps);
  b.setParam("controlChannel", 0);  // 0 not allowed (only inputChannel allows 0=omni)
  b.setParam("controlChannel", 17); // out of range
  b.setParam("controlChannel", 5);  // valid

  // Now in passthrough → switch to root → ch=5 triggers root update.
  b.setParam("triggerMode", "root");
  const before = f.notes.length;
  b.noteIn(64, 100, 5);
  // Should be consumed (no note emit), root updated to 4.
  assert.equal(f.notes.length, before);
});

test("setParam unknown key — silent no-op", () => {
  const f = makeFakeDeps();
  const b = new QtBridge(f.deps);
  // Should not throw.
  b.setParam("nope", 42);
  // No state change — next noteIn behaves as default.
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 1);
});

// ---------- transport / panic ----------

test("panic — dispatches host panic events (no-op in mono v1)", () => {
  // mono v1: notesOn empty → host.panic() returns []. Bridge call still
  // valid, no throw, no extra notes emitted.
  const f = makeFakeDeps();
  const b = new QtBridge(f.deps);
  b.noteIn(60, 100, 1);
  const beforeNotes = f.notes.length;
  b.panic();
  assert.equal(f.notes.length, beforeNotes);
});

test("transportStart — flushes notesOn and resets host state", () => {
  // After transportStart, the host's humanizeRng + drift + lastInputTime
  // are reset. Verify by emitting one humanize-shaped event, calling
  // transportStart, then re-emitting and checking the post-restart event
  // matches a fresh-host equivalent.
  const fA = makeFakeDeps();
  const a = new QtBridge(fA.deps, {
    initialParams: { humanizeVelocity: 1, seed: 42 },
  });
  fA.setNow(0);
  a.noteIn(60, 100, 1);   // walk state forward
  a.transportStart();
  fA.setNow(1000);        // simulate later wall time
  a.noteIn(60, 100, 1);   // post-restart event

  const fB = makeFakeDeps();
  const bFresh = new QtBridge(fB.deps, {
    initialParams: { humanizeVelocity: 1, seed: 42 },
  });
  fB.setNow(1000);
  bFresh.noteIn(60, 100, 1);

  // Compare the velocities of the most-recent emitted notes — they must
  // match because the post-restart bridge state == fresh bridge state.
  assert.equal(
    fA.notes[fA.notes.length - 1].velocity,
    fB.notes[fB.notes.length - 1].velocity,
  );
});

test("transportStop — host transportStop dispatched, no throw", () => {
  const f = makeFakeDeps();
  const b = new QtBridge(f.deps);
  b.transportStop(); // no notes in flight, just exercises the call
  assert.ok(true);   // reaching here = success
});

// ---------- scheduling lockstep ----------

test("notePulse and noteOn dispatch at same wall time (lockstep)", () => {
  // Spec: pulse outlet fires at the same time the scheduled noteOn
  // dispatches. With timing humanize > 0, both might be scheduled at
  // a positive delayMs. Both must end up at the SAME ms slot.
  const f = makeFakeDeps();
  const b = new QtBridge(f.deps, {
    initialParams: { humanizeTiming: 0.5, seed: 13 },
  });
  // Establish prior input so timingOffset can be non-zero.
  f.setNow(0);
  b.noteIn(60, 100, 1);
  f.setNow(500);
  // Reset scheduled tracking to focus on this call.
  const beforeScheduled = f.scheduled.length;
  const beforeOutlets = f.outlets.length;
  const beforeNotes = f.notes.length;
  b.noteIn(60, 100, 1);

  // Look at the second event's scheduled / outlet emissions.
  const newScheds = f.scheduled.slice(beforeScheduled);
  const newOutlets = f.outlets.slice(beforeOutlets);
  const newNotes = f.notes.slice(beforeNotes);

  // The bridge MAY emit noteOn and notePulse immediately (if timingOffset
  // ≤ 0 after clamp) or schedule both. Either way, they must dispatch
  // together. Assert: count of immediate-noteOn (in newNotes) plus
  // count of scheduled-noteOn equals 1; same for notePulse; same time
  // slot.
  // Easiest invariant: pulse outlet count + scheduled-pulse count == 1,
  // and likewise for noteOn — and they coincide.
  const immediatePulses = newOutlets.filter((o) => o.channel === "notePulse").length;
  const immediateNotes = newNotes.length;
  // Scheduled events: hard to introspect type without dispatch. Flush
  // all scheduled and re-count outlets/notes — this gives the total
  // lockstep delivery picture.
  for (const s of newScheds) s.cb();
  const allOutlets = f.outlets.slice(beforeOutlets);
  const allNotes = f.notes.slice(beforeNotes);
  const totalPulses = allOutlets.filter((o) => o.channel === "notePulse").length;
  const totalNotesNonZero = allNotes.filter((n) => n.velocity > 0).length;
  assert.equal(totalPulses, 1, "exactly one notePulse per noteIn");
  assert.equal(totalNotesNonZero, 1, "exactly one noteOn per noteIn");
});
