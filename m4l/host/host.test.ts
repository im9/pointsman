// Tests for host/host.ts — pure logic per ADR 002 §Pointsman.
//
// State-machine tests, no Max API, no timers. nowMs is injected per
// noteIn call so tests deliver deterministic time deltas.
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
import { buildScalePitches, diatonicShift, snapToScale } from "../engine/quantizer.ts";
import { nextU32, seedRng } from "../engine/rng.ts";

function makeHost(overrides: Partial<PointsmanParams> = {}): PointsmanHost {
  return new PointsmanHost({ ...DEFAULT_PARAMS, ...overrides });
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
  // Defaults from ADR 002 §live.* parameter surface — Pointsman.
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
  assert.equal(p.seed, 0);
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
  // multi-channel routing). outputChannel is *not* a parameter.'
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

// ---------- chord mode ----------
//
// ADR 003 § quantize mode: when mode='chord', held notes on
// controlChannel form chord context. Each noteIn adds pitch%12; each
// noteOff removes. Input notes get snapToChordTones (within 2 semis,
// scale fallback). Replaces inboil's offline chords[] / chordSource —
// any chord generator (clip, oedipa, manual play) drives the same path.

test("chord mode — controlChannel noteIn adds pitch class to chordContext, returns no notes", () => {
  const host = makeHost({
    mode: "chord",
    inputChannel: 1,
    controlChannel: 16,
  });
  // pitch=64 (E4) on controlChannel=16 → chordContext gains pc 4.
  const r = host.noteIn(64, 100, 16, 0);
  assert.deepEqual(r, []);
  assert.deepEqual(host.getChordContext(), [4]);
});

test("chord mode — multiple controlChannel notes build a multi-PC chord context", () => {
  const host = makeHost({
    mode: "chord",
    inputChannel: 1,
    controlChannel: 16,
  });
  // C-E-G triad: pcs 0, 4, 7. Held simultaneously, all should be present.
  host.noteIn(60, 100, 16, 0);
  host.noteIn(64, 100, 16, 0);
  host.noteIn(67, 100, 16, 0);
  // Order doesn't matter for chord context; sort for stable comparison.
  assert.deepEqual([...host.getChordContext()].sort((a, b) => a - b), [0, 4, 7]);
});

test("chord mode — same pc held twice (different octaves) deduplicates", () => {
  const host = makeHost({
    mode: "chord",
    inputChannel: 1,
    controlChannel: 16,
  });
  // C4 (60) and C5 (72) both contribute pc=0; chord context is by PC.
  host.noteIn(60, 100, 16, 0);
  host.noteIn(72, 100, 16, 0);
  assert.deepEqual(host.getChordContext(), [0]);
});

test("chord mode — controlChannel noteOff removes pc from chord context", () => {
  const host = makeHost({
    mode: "chord",
    inputChannel: 1,
    controlChannel: 16,
  });
  host.noteIn(60, 100, 16, 0);
  host.noteIn(64, 100, 16, 0);
  host.noteOff(64, 16);
  // pc 4 released → context shrinks to [0].
  assert.deepEqual(host.getChordContext(), [0]);
});

test("chord mode — overlapping octaves of same pc require all releases to remove", () => {
  // C4 and C5 both contribute pc 0. Releasing C4 alone should NOT clear
  // pc 0 from chord context — C5 is still held. (Matches MIDI hold-set
  // semantics: pc 0 leaves only when no octave of it is held.)
  const host = makeHost({
    mode: "chord",
    inputChannel: 1,
    controlChannel: 16,
  });
  host.noteIn(60, 100, 16, 0);
  host.noteIn(72, 100, 16, 0);
  host.noteOff(60, 16);
  assert.deepEqual(host.getChordContext(), [0]);
  host.noteOff(72, 16);
  assert.deepEqual(host.getChordContext(), []);
});

test("chord mode — input note snaps to chord tone when chord held", () => {
  const host = makeHost({
    mode: "chord",
    inputChannel: 1,
    controlChannel: 16,
    scale: "major",
    root: 0,
  });
  // Hold C+E+G chord on controlChannel.
  host.noteIn(60, 100, 16, 0);
  host.noteIn(64, 100, 16, 0);
  host.noteIn(67, 100, 16, 0);
  // Input C# (61) on inputChannel: nearest chord tone = C(60), distance 1
  // <= 2 → snap to 60.
  const r = partition(host.noteIn(61, 100, 1, 100));
  assert.equal(r.noteOns[0].pitch, 60);
});

test("chord mode — input note beyond tolerance falls back to scale snap", () => {
  const host = makeHost({
    mode: "chord",
    inputChannel: 1,
    controlChannel: 16,
    scale: "major",
    root: 0,
  });
  // Hold single C as chord context. F (65) is 5 semitones from nearest C.
  host.noteIn(60, 100, 16, 0);
  // 5 > 2 (tolerance) → fall back. F is in C major → returns 65.
  const r = partition(host.noteIn(65, 100, 1, 100));
  assert.equal(r.noteOns[0].pitch, 65);
});

test("chord mode — empty chord context behaves like scale snap", () => {
  const host = makeHost({
    mode: "chord",
    inputChannel: 1,
    controlChannel: 16,
    scale: "major",
    root: 0,
  });
  // No controlChannel notes held → chord context is empty.
  // Input C# (61) → falls back to scale snap. C major: 60 vs 62, tie-to-lower.
  const r = partition(host.noteIn(61, 100, 1, 0));
  assert.equal(r.noteOns[0].pitch, 60);
});

test("chord mode — controlChannel events do NOT update root (unlike triggerMode=root)", () => {
  // mode=chord overrides triggerMode for controlChannel semantics:
  // controlChannel notes form chord context; root is left alone.
  const host = makeHost({
    mode: "chord",
    triggerMode: "root", // even with this set, mode=chord wins for controlChannel
    inputChannel: 1,
    controlChannel: 16,
    root: 0,
  });
  host.noteIn(64, 100, 16, 0); // would set root=4 in mode=scale + triggerMode=root
  assert.equal(host.getParams().root, 0); // unchanged in mode=chord
  assert.deepEqual(host.getChordContext(), [4]); // went to chord context instead
});

test("chord mode — panic clears chord context", () => {
  const host = makeHost({
    mode: "chord",
    inputChannel: 1,
    controlChannel: 16,
  });
  host.noteIn(60, 100, 16, 0);
  host.noteIn(64, 100, 16, 0);
  host.panic();
  assert.deepEqual(host.getChordContext(), []);
});

test("chord mode — transportStop clears chord context", () => {
  const host = makeHost({
    mode: "chord",
    inputChannel: 1,
    controlChannel: 16,
  });
  host.noteIn(60, 100, 16, 0);
  host.transportStop();
  assert.deepEqual(host.getChordContext(), []);
});

test("setParam mode — accepts 'scale' | 'chord' | 'harmony'", () => {
  const host = makeHost();
  host.setParam("mode", "chord");
  assert.equal(host.getParams().mode, "chord");
  host.setParam("mode", "harmony");
  assert.equal(host.getParams().mode, "harmony");
  host.setParam("mode", "scale");
  assert.equal(host.getParams().mode, "scale");
});

test("setParam mode — switching away from chord clears chord context", () => {
  // When user switches mode to scale or harmony, the previously-held chord
  // context becomes meaningless (chord-tone snap is no longer the path).
  // Clearing avoids stale state surfacing if user later returns to chord.
  const host = makeHost({
    mode: "chord",
    inputChannel: 1,
    controlChannel: 16,
  });
  host.noteIn(60, 100, 16, 0);
  host.noteIn(64, 100, 16, 0);
  host.setParam("mode", "scale");
  assert.deepEqual(host.getChordContext(), []);
});

// ---------- harmony mode ----------
//
// ADR 003 § quantize mode: when mode='harmony', input note + N parallel
// diatonic voices (harmonyVoices[], 0..3, each {interval, direction}).
// Engine logic: snap input to scale first, then compute each voice via
// diatonicShift from snapped. All voices share one humanize draw — the
// input event is a single musical event, voiced multiple ways.

test("harmony mode — empty harmonyVoices behaves like scale snap", () => {
  // voices=[] → no extra notes, single output identical to scale mode.
  const host = makeHost({
    mode: "harmony",
    scale: "major",
    root: 0,
    harmonyVoices: [],
  });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.noteOns.length, 1);
  assert.equal(r.noteOns[0].pitch, 60);
});

test("harmony mode — 1 voice (3rd above) emits primary + voiced", () => {
  // C major, input C(60), voice = 3rd above. Primary stays at 60, voiced
  // = diatonicShift(60, 3, above) = 64 (E, two scale steps above C).
  const host = makeHost({
    mode: "harmony",
    scale: "major",
    root: 0,
    harmonyVoices: [{ interval: 3, direction: "above" }],
  });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.noteOns.length, 2);
  // Declared-order emission: primary first, then voices in harmonyVoices[]
  // order. Order is purely an output convention (all voices fire at the
  // same delayMs) but must be deterministic for tests and downstream tools.
  assert.equal(r.noteOns[0].pitch, 60);
  assert.equal(r.noteOns[1].pitch, 64);
});

test("harmony mode — 3 voices emit primary + 3 voiced notes in declared order", () => {
  // C major, input C(60). Voices in declared order:
  //   3rd above → 64 (E, 2 steps up)
  //   5th above → 67 (G, 4 steps up)
  //   3rd below → 57 (A below, 2 steps down)
  const host = makeHost({
    mode: "harmony",
    scale: "major",
    root: 0,
    harmonyVoices: [
      { interval: 3, direction: "above" },
      { interval: 5, direction: "above" },
      { interval: 3, direction: "below" },
    ],
  });
  const r = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r.noteOns.length, 4);
  assert.deepEqual(
    r.noteOns.map((e) => e.pitch),
    [60, 64, 67, 57],
  );
});

test("harmony mode — voice pitches match diatonicShift on a non-C scale", () => {
  // A minor (root=9), input A(69). Scale degrees include 69(A), 71(B),
  // 72(C), 74(D), 76(E), 77(F), 79(G), 81(A).
  //   3rd above A → 2 steps up → 72 (C)
  //   6th below A → 5 steps down → 60 (C below: A→G→F→E→D→C)
  const host = makeHost({
    mode: "harmony",
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
  // Mirror against the helper too — guards against engine drift renaming
  // the function or changing its signature without updating the host.
  const scalePitches = buildScalePitches("minor", 9);
  assert.equal(r.noteOns[1].pitch, diatonicShift(69, 3, "above", scalePitches));
  assert.equal(r.noteOns[2].pitch, diatonicShift(69, 6, "below", scalePitches));
});

test("harmony mode — out-of-scale input snaps to scale before voicing", () => {
  // C major, input C#(61). snapToScale → 60 (tie distance, lower wins).
  // Voice 3rd above is computed from snapped (60), not raw input (61):
  //   diatonicShift(60, 3, above, C-major) = 64 (E)
  // Note: diatonicShift internally snaps too, so this test would also pass
  // if the host fed raw 61 to diatonicShift — but the spec says snap once
  // up front so velocity / pulse / primary noteOn pitch all agree.
  const host = makeHost({
    mode: "harmony",
    scale: "major",
    root: 0,
    harmonyVoices: [{ interval: 3, direction: "above" }],
  });
  const r = partition(host.noteIn(61, 100, 1, 0));
  assert.equal(r.noteOns[0].pitch, 60);
  assert.equal(r.noteOns[1].pitch, 64);
});

test("harmony mode — all voices share same noteOn delayMs (timing lockstep)", () => {
  // One humanize draw per input event → one timingOffset, applied
  // identically to primary + every voice. Voices are different pitches
  // of the same musical event, not separate events with their own timing.
  const host = makeHost({
    mode: "harmony",
    scale: "major",
    root: 0,
    humanizeTiming: 1,
    seed: 13,
    harmonyVoices: [
      { interval: 3, direction: "above" },
      { interval: 5, direction: "above" },
    ],
  });
  // Establish prior input so sourceStepDuration > 0 and humanizeTiming
  // actually deflects the noteOn delay.
  host.noteIn(60, 100, 1, 0);
  const r = partition(host.noteIn(60, 100, 1, 200));
  assert.equal(r.noteOns.length, 3);
  const d0 = r.noteOns[0].delayMs;
  assert.equal(r.noteOns[1].delayMs, d0);
  assert.equal(r.noteOns[2].delayMs, d0);
});

test("harmony mode — all voices share same noteOff delayMs (lockstep release)", () => {
  // Same gateFinal × sourceStepDuration for all voices → identical
  // noteOff timing. Voices release together as a chord.
  const host = makeHost({
    mode: "harmony",
    scale: "major",
    root: 0,
    humanizeGate: 1,
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

test("harmony mode — all voices share same velocity (one humanize draw)", () => {
  // velocityFinal computed once per input event, applied to all voices.
  // (Inboil's harmony mode treats voices as a single trig with multiple
  // notes; Stencil emits separate events but preserves shared velocity.)
  const host = makeHost({
    mode: "harmony",
    scale: "major",
    root: 0,
    humanizeVelocity: 0.5,
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

test("harmony mode — notePulse fires for every voiced note", () => {
  // Keyboard should highlight every sounded key, not just the primary.
  // Pulse count == noteOn count, same pitch set.
  const host = makeHost({
    mode: "harmony",
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

test("harmony mode — output channel preserves input channel for all voices", () => {
  // Spec (scale mode): 'emit on the same channel as the input event'.
  // Multi-voice doesn't change that — every voice routes to the input
  // channel so a user can route specific input channels to specific synths.
  const host = makeHost({
    mode: "harmony",
    scale: "major",
    root: 0,
    harmonyVoices: [{ interval: 3, direction: "above" }],
  });
  const r = partition(host.noteIn(60, 100, 7, 0));
  for (const e of r.noteOns) assert.equal(e.channel, 7);
  for (const e of r.noteOffs) assert.equal(e.channel, 7);
});

test("harmony mode — switching to scale suppresses voicing on next noteIn", () => {
  // mode change is the trigger — harmonyVoices is left intact (config, not
  // held state) but the next noteIn must produce single output.
  const host = makeHost({
    mode: "harmony",
    scale: "major",
    root: 0,
    harmonyVoices: [{ interval: 3, direction: "above" }],
  });
  const r1 = partition(host.noteIn(60, 100, 1, 0));
  assert.equal(r1.noteOns.length, 2);
  host.setParam("mode", "scale");
  const r2 = partition(host.noteIn(60, 100, 1, 100));
  assert.equal(r2.noteOns.length, 1);
});

test("setParam harmonyVoices — replaces voice list, takes effect immediately", () => {
  // Bridge will deliver a HarmonyVoice[] payload; host stores and uses it
  // on the next noteIn. C major, input C(60):
  //   5th above → 67 (G)
  //   5th below → 53 (F below: 59→57→55→53)
  const host = makeHost({
    mode: "harmony",
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
  assert.deepEqual(
    r.noteOns.map((e) => e.pitch),
    [60, 67, 53],
  );
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
  // notesOn stays empty in mono passthrough (paired noteOn/noteOff
  // emitted together, bridge schedules). flushNotesOn is
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
