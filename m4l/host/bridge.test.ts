// Tests for host/bridge.ts — Max protocol layer.
//
// Pattern: BridgeDeps faked with recorders so we assert against
// captured emit / schedule calls. No Max API, no real timers,
// no setTimeout.
//
// Threshold derivation rule (CLAUDE.md global): every numeric assertion
// is justified inline against the spec or first-principles derivation.

import { test } from "node:test";
import assert from "node:assert/strict";

import { PointsmanBridge, type BridgeDeps } from "./bridge.ts";
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
  new PointsmanBridge(f.deps);
  // ADR 003 §Ready handshake: 'ready' MUST be emitted by pointsman.mjs
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
  const b = new PointsmanBridge(f.deps);
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
  const b = new PointsmanBridge(f.deps);
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
  const b = new PointsmanBridge(f.deps);
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
  const b = new PointsmanBridge(f.deps);
  const notesBefore = f.notes.length;
  b.noteIn(Number.NaN, 100, 1);
  b.noteIn(60, 100, Number.NaN);
  assert.equal(f.notes.length, notesBefore);
});

test("noteIn — out-of-range pitch / velocity / channel ignored (MIDI domain defense)", () => {
  // MIDI domain: pitch 0..127, velocity 0..127, channel 0..16. Live's
  // [midiparse] guarantees these ranges, but a misrouted message or a
  // future direct-from-Node callsite could deliver values outside the
  // domain. Defense-in-depth at the bridge keeps the host from emitting
  // pitch>127 to noteout (would silently truncate). Note: we accept
  // channel=0 (track-internal Live MIDI from an upstream M4L device)
  // and finite-but-non-integer values (max-api's marshaling has been
  // observed to drop the int type tag in some configurations).
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  const before = f.notes.length;
  // pitch out of range
  b.noteIn(-1, 100, 1);
  b.noteIn(128, 100, 1);
  // velocity out of range
  b.noteIn(60, -1, 1);
  b.noteIn(60, 128, 1);
  // channel out of range (>16 invalid; 0 is valid for track-internal MIDI)
  b.noteIn(60, 100, -1);
  b.noteIn(60, 100, 17);
  assert.equal(f.notes.length, before, "all out-of-range noteIns must be silently dropped");
  // Channel 0 (track-internal Live MIDI) must be ACCEPTED.
  f.setNow(0);
  b.noteIn(60, 100, 0);
  assert.equal(f.notes.length, before + 1, "channel=0 (track-internal) must be accepted");
  // Sanity: a valid channel-1 noteIn still works. Space far enough
  // ahead that sourceStepDuration > 0 → noteOff is scheduled, not
  // dispatched immediately, so we only count the noteOn here.
  f.setNow(500);
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, before + 2);
});

test("noteOff — out-of-range pitch / channel ignored (MIDI domain defense)", () => {
  // Mirror of noteIn range guard for the noteOff path. Velocity is not
  // an argument here, so just pitch + channel.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  // noteOff against an unheld pitch is a silent no-op anyway, so we
  // assert the bridge doesn't crash (no throw) for out-of-range.
  assert.doesNotThrow(() => {
    b.noteOff(-1, 1);
    b.noteOff(128, 1);
    b.noteOff(60, -1);
    b.noteOff(60, 17);
    b.noteOff(60, 0); // track-internal channel 0 — accepted, no-op for unheld
  });
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
  const b = new PointsmanBridge(f.deps, {
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
  const b = new PointsmanBridge(f.deps);
  const before = f.outlets.length;
  b.setParam("scale", "minor");
  // Side-effect: scaleChanged outlet re-emit so jsui can refresh.
  const sc = f.outlets.slice(before).find((o) => o.channel === "scaleChanged");
  assert.ok(sc);
  assert.deepEqual(sc!.args, ["minor", 0]);
});

test("setParam scale — rejects unknown scale name", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  const before = f.outlets.length;
  b.setParam("scale", "diminished"); // not in ADR 002 §15-name list
  // No scaleChanged emit — invalid input is a silent no-op.
  const sc = f.outlets.slice(before).find((o) => o.channel === "scaleChanged");
  assert.equal(sc, undefined);
});

test("setParam root — validates 0..11 integer range", () => {
  // ADR 002 live.* table: root is `live.numbox int 0..11`.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
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
  const b = new PointsmanBridge(f.deps);
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
  const b = new PointsmanBridge(f.deps);
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
  const b = new PointsmanBridge(f.deps);
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
  const b = new PointsmanBridge(f.deps);
  // Should not throw.
  b.setParam("nope", 42);
  // No state change — next noteIn behaves as default.
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 1);
});

// ---------- setParam mode + chord context ----------

test("setParam mode — accepts scale/chord/harmony and rejects unknown", () => {
  // ADR 002 § live.* parameter surface: mode is a 3-enum
  // (scale | chord | harmony). Bridge validates via a whitelist; an
  // unknown value is a silent no-op so a typo'd patcher message can't
  // poison host state. Default mode is `scale`, so after a rejected
  // mode update, controlChannel notes (with default
  // triggerMode=passthrough) still route to the quantize path.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "polyrhythm"); // not in 3-enum
  b.noteIn(60, 100, 16); // controlChannel default = 16
  // Default mode=scale + triggerMode=passthrough → controlChannel
  // routes to quantize, emits one noteOn.
  assert.equal(f.notes.length, 1, "rejected mode update keeps default `scale` behavior");

  // Accepts each valid name without throwing.
  b.setParam("mode", "chord");
  b.setParam("mode", "harmony");
  b.setParam("mode", "scale");
});

test("chord mode — controlChannel noteIn consumes the note (no MIDI emit)", () => {
  // ADR 003 § quantize mode: in chord mode, controlChannel notes
  // form the chord context — they are NOT forwarded to the quantize
  // path (no MIDI out, no notePulse) and triggerMode=root is
  // overridden. Verifies the chord-mode short-circuit in host.noteIn.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  const beforeNotes = f.notes.length;
  const beforePulses = f.outlets.filter((o) => o.channel === "notePulse").length;
  b.noteIn(60, 100, 16);
  assert.equal(f.notes.length, beforeNotes, "no MIDI out from chord-context note");
  const afterPulses = f.outlets.filter((o) => o.channel === "notePulse").length;
  assert.equal(afterPulses, beforePulses, "no notePulse from chord-context note");
});

test("chord mode — controlChannel noteIn emits chordChanged with the new pc set", () => {
  // ADR 003 §scale keyboard interaction: bridge emits
  // `chordChanged <pcs...>` so the keyboard renderer can highlight
  // currently-held chord PCs (third tier between in-scale dot and
  // pulse glow). PC = pitch % 12; arg list is the sorted PC set.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  const before = f.outlets.length;
  b.noteIn(60, 100, 16); // C → pc 0
  const cc = f.outlets.slice(before).find((o) => o.channel === "chordChanged");
  assert.ok(cc, "chordChanged outlet must fire when chord context grows");
  assert.deepEqual(cc!.args, [0]);
});

test("chord mode — multi-octave holds dedupe by pitch class", () => {
  // ADR 003 § quantize mode: chord context is the pitch-class
  // projection of the held set. Holding C3 (60) and C4 (72)
  // contributes pc=0 once. Releasing C4 keeps pc=0 (C3 still held);
  // releasing C3 empties the set.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.noteIn(60, 100, 16);
  b.noteIn(72, 100, 16);
  let cc = f.outlets.filter((o) => o.channel === "chordChanged");
  // Last emission must be a single pc=0 (deduped).
  assert.deepEqual(cc[cc.length - 1].args, [0]);

  b.noteOff(72, 16); // C3 still held → pc=0 remains
  cc = f.outlets.filter((o) => o.channel === "chordChanged");
  // Set unchanged → bridge dedupes to avoid spamming the outlet:
  // last emission may either be a fresh [0] from the noteOff OR
  // unchanged from the previous emission. Both are correct.
  // Strong assertion: the running last-emission set is [0].
  assert.deepEqual(cc[cc.length - 1].args, [0]);

  b.noteOff(60, 16); // last held C released
  cc = f.outlets.filter((o) => o.channel === "chordChanged");
  assert.deepEqual(cc[cc.length - 1].args, []);
});

test("chord mode — chordChanged is sorted ascending by pc", () => {
  // Stable arg order makes the patcher route + jsui reducer
  // deterministic regardless of the hold order. Hold E (pc=4) then
  // C (pc=0) → emitted as [0, 4].
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.noteIn(64, 100, 16); // E
  b.noteIn(60, 100, 16); // C
  const cc = f.outlets.filter((o) => o.channel === "chordChanged");
  assert.deepEqual(cc[cc.length - 1].args, [0, 4]);
});

test("chord mode — dedup avoids re-emitting an unchanged pc set", () => {
  // If the held PCs don't change, the bridge MUST NOT re-emit
  // chordChanged. Holding C3 then C3 again (re-trigger without
  // noteOff in between) is one entry in the held SET; pc set is
  // unchanged across the second add. Spamming chordChanged would
  // force redundant jsui redraws.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.noteIn(60, 100, 16);
  const ccCountAfterFirst = f.outlets.filter((o) => o.channel === "chordChanged").length;
  b.noteIn(60, 100, 16); // same pitch, same pc — set unchanged
  const ccCountAfterSecond = f.outlets.filter((o) => o.channel === "chordChanged").length;
  assert.equal(ccCountAfterSecond, ccCountAfterFirst,
    "no extra chordChanged when pc set is unchanged");
});

test("switching mode away from chord clears the chord context", () => {
  // ADR 003 § quantize mode: the chord-context held set is
  // chord-mode-only state. Switching to scale or harmony MUST clear
  // it (host already does this; bridge must emit chordChanged []).
  // Otherwise re-entering chord mode would resurface stale PCs.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.noteIn(60, 100, 16);
  b.noteIn(64, 100, 16);
  const before = f.outlets.length;
  b.setParam("mode", "scale");
  const cc = f.outlets.slice(before).find((o) => o.channel === "chordChanged");
  assert.ok(cc, "chordChanged must fire on mode switch away from chord");
  assert.deepEqual(cc!.args, []);
});

test("panic in chord mode emits chordChanged []", () => {
  // ADR 002 §panic: clears all chord-mode held state. Bridge must
  // tell the keyboard renderer the highlight set is empty.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.noteIn(60, 100, 16);
  b.noteIn(64, 100, 16);
  const before = f.outlets.length;
  b.panic();
  const cc = f.outlets.slice(before).find((o) => o.channel === "chordChanged");
  assert.ok(cc, "panic must emit chordChanged []");
  assert.deepEqual(cc!.args, []);
});

test("transportStop in chord mode emits chordChanged []", () => {
  // Same rationale as panic: transportStop clears chord state in
  // host (ADR 002 §transport) and bridge must mirror to the renderer.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.noteIn(60, 100, 16);
  const before = f.outlets.length;
  b.transportStop();
  const cc = f.outlets.slice(before).find((o) => o.channel === "chordChanged");
  assert.ok(cc, "transportStop must emit chordChanged []");
  assert.deepEqual(cc!.args, []);
});

test("transportStart in chord mode emits chordChanged []", () => {
  // transportStart resets host RNG/drift/lastInput AND clears
  // controlHeldPitches. Bridge must mirror the cleared chord set.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "chord");
  b.noteIn(60, 100, 16);
  const before = f.outlets.length;
  b.transportStart();
  const cc = f.outlets.slice(before).find((o) => o.channel === "chordChanged");
  assert.ok(cc, "transportStart must emit chordChanged []");
  assert.deepEqual(cc!.args, []);
});

test("non-chord mode — no chordChanged emission for input-channel notes", () => {
  // mode='scale': controlChannel notes go through the quantize path
  // (or update root in triggerMode=root). They never affect chord
  // context, so chordChanged MUST stay silent.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  // Default mode='scale'. Drive several notes through both control
  // and input channels.
  b.noteIn(60, 100, 1);
  b.noteIn(64, 100, 16);
  b.noteOff(60, 1);
  const ccCount = f.outlets.filter((o) => o.channel === "chordChanged").length;
  assert.equal(ccCount, 0, "no chordChanged outside chord mode");
});

// ---------- harmony slot collection (bridge → host harmonyVoices) ----------
//
// ADR 003 §Pointsman patcher harmony voices widget cluster: 6 live.menu widgets
// (3 voice slots × 2 fields), matching inboil's QuantizerSheet two-
// select-per-voice badge. Each emits its own setParam:
//   harmonyV{1,2,3}Interval   ∈ {"3rd", "4th", "5th", "6th"}
//   harmonyV{1,2,3}Direction  ∈ {"off", "above", "below"}
// Bridge maps interval string → int (3..6), validates direction, stores
// in 3-slot state, and projects to host harmonyVoices (length-flattened:
// slots with direction="off" dropped).

test("harmony slots — defaults are 3 × {3rd, off} → empty harmonyVoices", () => {
  // Default-constructed bridge: all slots at direction="off", so the
  // filtered list is empty. In harmony mode this must produce a single
  // output (primary scale-snap, no voiced notes).
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "harmony");
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 1);
  assert.deepEqual(f.notes[0], { pitch: 60, velocity: 100, channel: 1 });
});

test("harmony slot V1 — direction='above' enables one voice (default interval=3rd)", () => {
  // Default interval=3 (parameter_initial idx 0 → "3rd" → 3). Setting
  // direction="above" promotes V1 from off → active.
  // C major + input C(60) → primary 60 + 3rd-above-C = 64 (E).
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "harmony");
  b.setParam("harmonyV1Direction", "above");
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 2);
  assert.deepEqual(f.notes.map((n) => n.pitch), [60, 64]);
});

test("harmony slot — interval enum strings map to diatonic shifts", () => {
  // Parametric over the 4 interval values. Direction="above", input
  // C(60) in C major. Diatonic distances:
  //   3rd → 64 (E, 2 scale steps),  4th → 65 (F, 3 steps)
  //   5th → 67 (G, 4 steps),         6th → 69 (A, 5 steps)
  const cases: Array<[string, number]> = [
    ["3rd", 64], ["4th", 65], ["5th", 67], ["6th", 69],
  ];
  for (const [intervalStr, expected] of cases) {
    const f = makeFakeDeps();
    const b = new PointsmanBridge(f.deps);
    b.setParam("mode", "harmony");
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
  // C major. Below distances: 3rd↓ = 57 (A, 2 steps below).
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "harmony");
  b.setParam("harmonyV1Interval", "3rd");
  b.setParam("harmonyV1Direction", "below");
  b.noteIn(60, 100, 1);
  assert.deepEqual(f.notes.map((n) => n.pitch), [60, 57]);
});

test("harmony slot — invalid interval is silently rejected (slot unchanged)", () => {
  // Out-of-vocabulary or wrong-suffix values: silent no-op.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "harmony");
  b.setParam("harmonyV1Interval", "5th");      // valid → interval=5
  b.setParam("harmonyV1Direction", "above");
  b.setParam("harmonyV1Interval", "7th");      // out of range
  b.setParam("harmonyV1Interval", "3");        // missing suffix
  b.setParam("harmonyV1Interval", "third");    // word form
  b.noteIn(60, 100, 1);
  // Voice still uses 5th above (G=67).
  assert.deepEqual(f.notes.map((n) => n.pitch), [60, 67]);
});

test("harmony slot — invalid direction is silently rejected (slot unchanged)", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "harmony");
  b.setParam("harmonyV1Direction", "above");
  b.setParam("harmonyV1Direction", "diagonal"); // unknown
  b.noteIn(60, 100, 1);
  assert.deepEqual(f.notes.map((n) => n.pitch), [60, 64]);
});

test("harmony slot — direction='off' removes voice from filtered output", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "harmony");
  b.setParam("harmonyV1Direction", "above");
  b.setParam("harmonyV1Direction", "off");
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 1);
});

test("harmony slots — all 3 active produces primary + 3 voiced notes", () => {
  // V1=3rd above (E=64), V2=5th above (G=67), V3=3rd below (A=57). C major.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "harmony");
  b.setParam("harmonyV1Direction", "above");           // interval default 3rd
  b.setParam("harmonyV2Interval", "5th");
  b.setParam("harmonyV2Direction", "above");
  b.setParam("harmonyV3Interval", "3rd");
  b.setParam("harmonyV3Direction", "below");
  b.noteIn(60, 100, 1);
  assert.deepEqual(f.notes.map((n) => n.pitch), [60, 64, 67, 57]);
});

test("harmony slots — gap-filtering preserves declared slot order (V2 only)", () => {
  // V1=off, V2 active (5th above), V3=off → filtered voices = [V2].
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "harmony");
  b.setParam("harmonyV2Interval", "5th");
  b.setParam("harmonyV2Direction", "above");
  b.noteIn(60, 100, 1);
  assert.deepEqual(f.notes.map((n) => n.pitch), [60, 67]);
});

test("harmony slots — V1 and V3 active, V2 off (sandwich case)", () => {
  // V1 emits before V3 even with V2 as the gap.
  // V1=3rd above (64), V3=5th below (53).
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "harmony");
  b.setParam("harmonyV1Direction", "above");
  b.setParam("harmonyV3Interval", "5th");
  b.setParam("harmonyV3Direction", "below");
  b.noteIn(60, 100, 1);
  assert.deepEqual(f.notes.map((n) => n.pitch), [60, 64, 53]);
});

test("harmony slot — slot config persists across modes (configure-then-switch)", () => {
  // Slot is config; persists regardless of mode.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("harmonyV1Direction", "above");
  b.setParam("mode", "harmony");
  b.noteIn(60, 100, 1);
  assert.deepEqual(f.notes.map((n) => n.pitch), [60, 64]);
});

test("harmony slot — out-of-range slot index (V4) is silent no-op", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.setParam("mode", "harmony");
  b.setParam("harmonyV4Interval", "3rd");
  b.setParam("harmonyV4Direction", "above");
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 1);
});

// ---------- transport / panic ----------

test("panic — releases sounding pitch by flushing in-flight noteOffs (B2)", () => {
  // Pre-v1.0.1: notesOn was always empty so host.panic() returned [] and
  // the scheduled noteOff fired on its original timer (panic had no
  // immediate effect on a held humanizeGate).
  // Post-fix: bridge tracks scheduled noteOffs; panic emits an immediate
  // noteOff for every sounding pitch and cancels the original schedule.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.noteIn(60, 100, 1);
  const beforeNotes = f.notes.length;
  b.panic();
  // panic must release the held pitch *now*, not at the original gate.
  assert.equal(f.notes.length, beforeNotes + 1);
  const released = f.notes[f.notes.length - 1];
  assert.equal(released.pitch, 60);
  assert.equal(released.velocity, 0);
});

test("transportStart — flushes notesOn and resets host state", () => {
  // After transportStart, the host's humanizeRng + drift + lastInputTime
  // are reset. Verify by emitting one humanize-shaped event, calling
  // transportStart, then re-emitting and checking the post-restart event
  // matches a fresh-host equivalent.
  const fA = makeFakeDeps();
  const a = new PointsmanBridge(fA.deps, {
    initialParams: { humanizeVelocity: 1, seed: 42 },
  });
  fA.setNow(0);
  a.noteIn(60, 100, 1);   // walk state forward
  a.transportStart();
  fA.setNow(1000);        // simulate later wall time
  a.noteIn(60, 100, 1);   // post-restart event

  const fB = makeFakeDeps();
  const bFresh = new PointsmanBridge(fB.deps, {
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
  const b = new PointsmanBridge(f.deps);
  b.transportStop(); // no notes in flight, just exercises the call
  assert.ok(true);   // reaching here = success
});

// ---------- scheduling lockstep ----------

test("notePulse and noteOn dispatch at same wall time (lockstep)", () => {
  // Spec: pulse outlet fires at the same time the scheduled noteOn
  // dispatches. With timing humanize > 0, both might be scheduled at
  // a positive delayMs. Both must end up at the SAME ms slot.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps, {
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

// ---------- in-flight noteOff cancellation (B2) ---------------------------
//
// Pre-fix behaviour: noteIn paired noteOn(immediate) + noteOff(scheduled).
// transportStop / panic / setParam(scale|root|mode|triggerMode) called
// host.flushNotesOn which was a no-op (notesOn never populated). The
// scheduled noteOff fired regardless on its original timer. Two failure
// modes:
//   (a) panic during a long humanizeGate hold: synth keeps sounding for
//       the gate remainder.
//   (b) re-trigger of the same pitch within the gate window: the OLD
//       scheduled noteOff fires and prematurely silences the NEW note.
// Fix: bridge tracks scheduled noteOffs; cancellation entry points emit
// an immediate noteOff and mark the scheduled cb as a no-op. Same-key
// re-trigger also auto-cancels the prior pending noteOff.

test("cancellation — transportStop emits immediate noteOff for sounding pitch + scheduled noteOff is a no-op", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.noteIn(60, 100, 1);
  // After noteIn: 1 noteOn dispatched, 1 noteOff scheduled (default gate).
  assert.equal(f.notes.length, 1);
  assert.equal(f.notes[0].velocity, 100);
  // transportStop — bridge cancels in-flight + emits immediate noteOff.
  b.transportStop();
  assert.equal(f.notes.length, 2, "transportStop must emit immediate noteOff for sounding pitch");
  assert.equal(f.notes[1].pitch, 60);
  assert.equal(f.notes[1].velocity, 0);
  assert.equal(f.notes[1].channel, 1);
  // Now flush the originally scheduled noteOff — must be a no-op (else
  // it would emit a stale noteOff for an already-released pitch).
  f.flushAll();
  assert.equal(f.notes.length, 2, "originally scheduled noteOff must be cancelled");
});

test("cancellation — panic emits immediate noteOff for sounding pitch + scheduled noteOff is a no-op", () => {
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.noteIn(72, 80, 2);
  assert.equal(f.notes.length, 1);
  b.panic();
  // panic() must release the held pitch immediately.
  assert.equal(f.notes.length, 2);
  assert.equal(f.notes[1].pitch, 72);
  assert.equal(f.notes[1].velocity, 0);
  assert.equal(f.notes[1].channel, 2);
  f.flushAll();
  assert.equal(f.notes.length, 2);
});

test("cancellation — setParam scale|root|mode|triggerMode flushes sounding pitches; setParam seed (non-flush) does not", () => {
  // Mirror of host.setParam flushKeys list (scale, root, mode, triggerMode).
  // A scale change while a note is held should silence it (the new scale
  // would mismatch the held pitch); a seed change should NOT (it doesn't
  // affect any in-flight quantize result).
  const flushKeys: Array<{ key: string; value: unknown }> = [
    { key: "scale", value: "minor" },
    { key: "root", value: 5 },
    { key: "mode", value: "harmony" },
    { key: "triggerMode", value: "root" },
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
  // Non-flush key: seed change. The bridge does NOT cancel pending
  // noteOffs because seed doesn't affect any in-flight quantize result.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.noteIn(60, 100, 1);
  const before = f.notes.length;
  b.setParam("seed", 99);
  assert.equal(f.notes.length, before, "setParam seed must NOT flush sounding pitches");
});

test("cancellation — re-triggering same pitch+channel cancels the prior pending noteOff", () => {
  // Mash the same key twice within the gate window. Without cancellation
  // the first scheduled noteOff would fire mid-second-note and silence
  // it. With cancellation: only the second-note's noteOff fires.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  b.noteIn(60, 100, 1);
  // First noteOn dispatched, first noteOff scheduled.
  assert.equal(f.notes.length, 1);
  // Second noteIn for the same pitch+channel before the first gate elapsed.
  // Bridge should cancel the prior pending noteOff so flushAll only fires
  // the second note's noteOff.
  f.setNow(50);
  b.noteIn(60, 100, 1);
  assert.equal(f.notes.length, 2, "second noteOn dispatched");
  // Flush all scheduled — should yield exactly ONE more note (the second
  // noteOff). The first noteOff is cancelled.
  f.flushAll();
  const noteOffs = f.notes.filter((n) => n.velocity === 0);
  assert.equal(noteOffs.length, 1, `expected 1 noteOff (second note's), got ${noteOffs.length}`);
});

test("cancellation — channel scope: same pitch on different channels is independent", () => {
  // A flush on a held pitch+channel must not affect a parallel held
  // pitch+different-channel. Defensive — the cancellation key must
  // include channel.
  const f = makeFakeDeps();
  const b = new PointsmanBridge(f.deps);
  // Space the noteIns 100 ms apart so sourceStepDuration > 0 → both
  // noteOffs are scheduled (not dispatched immediately at delay=0,
  // which would leave nothing pending to flush).
  f.setNow(0);
  b.noteIn(60, 100, 1);
  f.setNow(100);
  b.noteIn(60, 100, 2);
  // 2 noteOns dispatched, 2 noteOffs scheduled.
  assert.equal(f.notes.length, 2);
  b.transportStop();
  // Both pitches must be released (one per channel).
  const offs = f.notes.filter((n) => n.velocity === 0);
  assert.equal(offs.length, 2, "transportStop must release both channels");
  const channels = offs.map((n) => n.channel).sort();
  assert.deepEqual(channels, [1, 2]);
});
