import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_PARAMS, TmHost, type HostParams, type NoteEvent } from "./host.ts";
import { createRegister, seedRng, shiftAndForce } from "../engine/turing.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = join(
  __dirname,
  "../../docs/ai/turing-test-vectors.json",
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const V: any = JSON.parse(readFileSync(VECTORS_PATH, "utf8"));

function makeHost(overrides: Partial<HostParams> = {}): TmHost {
  return new TmHost({ ...DEFAULT_PARAMS, ...overrides });
}

function notesFromEvents(events: NoteEvent[]): {
  noteOns: NoteEvent[];
  noteOffs: NoteEvent[];
} {
  return {
    noteOns: events.filter((e) => e.type === "noteOn"),
    noteOffs: events.filter((e) => e.type === "noteOff"),
  };
}

test("constructor — deterministic initial register from seed", () => {
  const host = makeHost({ seed: 1, length: 8 });
  // Match the engine's createRegister(8, seedRng(1n)) — verified via vectors
  // register_init case for seed=1 length=8.
  const expected = V.register_init.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) => c.length === 8 && c.seed.decimal === "1",
  );
  assert.ok(expected, "vectors must include seed=1 length=8");
  assert.equal(host.getRegister(), expected.register);
  assert.equal(host.getPosition(), 0);
});

test("step auto mode density=1.0 — emits noteOn + delayed noteOff", () => {
  const host = makeHost({
    seed: 1,
    length: 8,
    lock: 1.0,
    density: 1.0,
    rangeLo: 60,
    rangeHi: 72,
    outputVelocity: 100,
    outputGate: 0.5,
    outputChannel: 1,
  });
  const events = host.step(0);
  const { noteOns, noteOffs } = notesFromEvents(events);
  assert.equal(noteOns.length, 1);
  assert.equal(noteOffs.length, 1);
  assert.equal(noteOns[0].velocity, 100);
  assert.equal(noteOns[0].channel, 1);
  assert.equal(noteOns[0].delaySteps, 0);
  assert.equal(noteOffs[0].pitch, noteOns[0].pitch);
  assert.equal(noteOffs[0].delaySteps, 0.5);
});

test("step matches tm_step vector trace (lock=1.0 perfect loop)", () => {
  const sc = V.tm_step.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) => c.name === "perfect loop (lock=1.0, density=1.0)",
  );
  assert.ok(sc, "vectors must include perfect-loop scenario");
  const host = makeHost({
    seed: Number(sc.seed.decimal),
    length: sc.length,
    lock: sc.lock,
    density: sc.density,
    rangeLo: sc.range[0],
    rangeHi: sc.range[1],
  });
  for (const expected of sc.trace) {
    const events = host.step(expected.step);
    const noteOns = events.filter((e) => e.type === "noteOn");
    if (expected.active) {
      assert.equal(noteOns.length, 1, `step ${expected.step} active`);
      assert.equal(
        noteOns[0].pitch,
        expected.note,
        `step ${expected.step} pitch`,
      );
    } else {
      assert.equal(noteOns.length, 0, `step ${expected.step} silent`);
    }
  }
});

test("step density=0 — no events, but rng still advances", () => {
  const host = makeHost({ seed: 1, length: 8, density: 0.0 });
  const reg0 = host.getRegister();
  const events = host.step(0);
  assert.equal(events.length, 0);
  // Register advanced (auto mode shiftAndFlip ran)
  assert.notEqual(host.getRegister(), reg0);
});

test("step gate mode without held input — silent and frozen", () => {
  const host = makeHost({ triggerMode: "gate", seed: 1, length: 8 });
  const reg0 = host.getRegister();
  const events = host.step(0);
  assert.equal(events.length, 0);
  // Register did NOT advance
  assert.equal(host.getRegister(), reg0);
});

test("step gate mode with held input — advances normally", () => {
  const host = makeHost({ triggerMode: "gate", seed: 1, length: 8, density: 1.0 });
  const reg0 = host.getRegister();
  host.noteIn(60, 100, 1);
  const events = host.step(0);
  const noteOns = events.filter((e) => e.type === "noteOn");
  assert.equal(noteOns.length, 1);
  assert.notEqual(host.getRegister(), reg0);
});

test("noteIn seed mode — register changes via shiftAndForce(1)", () => {
  const host = makeHost({ triggerMode: "seed", seed: 1, length: 8 });
  const reg0 = host.getRegister();
  host.noteIn(60, 100, 1);
  const expected = shiftAndForce(reg0, 8, 1);
  assert.equal(host.getRegister(), expected);
});

test("noteOff seed mode — register changes via shiftAndForce(0)", () => {
  const host = makeHost({ triggerMode: "seed", seed: 1, length: 8 });
  host.noteIn(60, 100, 1); // activates seed
  const reg1 = host.getRegister();
  host.noteOff(60, 1);
  const expected = shiftAndForce(reg1, 8, 0);
  assert.equal(host.getRegister(), expected);
});

test("step seed mode after activation — register frozen, no flip", () => {
  const host = makeHost({
    triggerMode: "seed",
    seed: 1,
    length: 8,
    lock: 0.0, // would always flip in auto, but seed mode bypasses
    density: 1.0,
  });
  host.noteIn(60, 100, 1); // activates seed
  const regAfterSeed = host.getRegister();
  host.step(0);
  // Register unchanged after step (seed-active = read-only)
  assert.equal(host.getRegister(), regAfterSeed);
});

test("step seed mode before any input — falls back to auto", () => {
  const host = makeHost({
    triggerMode: "seed",
    seed: 1,
    length: 8,
    lock: 1.0,
    density: 1.0,
  });
  const reg0 = host.getRegister();
  host.step(0);
  // Acted as auto: register evolved (lock=1.0 with all-tail-zero edge depends
  // on initial register; seed=1 length=8 register is non-trivial, so shift
  // changes it). Just assert position advanced — value-level coverage is in
  // the perfect-loop trace test.
  assert.equal(host.getPosition(), 1);
  // With lock=1.0 the register cycles but doesn't sit still: the canonical
  // loop test verifies the cycle. Here we just verify auto-fallback kicked
  // in (no early-return as in gate mode).
  void reg0;
});

test("inputChannel filter — omni accepts all, specific filters", () => {
  // omni
  const omni = makeHost({ triggerMode: "seed", inputChannel: 0, seed: 1 });
  const reg0 = omni.getRegister();
  omni.noteIn(60, 100, 5);
  assert.notEqual(omni.getRegister(), reg0);

  // specific channel — non-matching ignored
  const specific = makeHost({ triggerMode: "seed", inputChannel: 1, seed: 1 });
  const reg0s = specific.getRegister();
  specific.noteIn(60, 100, 5);
  assert.equal(specific.getRegister(), reg0s);
  // matching accepted
  specific.noteIn(60, 100, 1);
  assert.notEqual(specific.getRegister(), reg0s);
});

test("transportStart — re-inits register and resets position", () => {
  const host = makeHost({ seed: 1, length: 8 });
  host.step(0);
  host.step(1);
  const beforeStart = host.getRegister();
  assert.equal(host.getPosition(), 2);
  host.transportStart();
  // Register restored to fresh-from-seed
  const expectedFresh = createRegister(8, seedRng(1n)).register;
  assert.equal(host.getRegister(), expectedFresh);
  assert.equal(host.getPosition(), 0);
  void beforeStart;
});

test("transportStop — resets position, register preserved", () => {
  const host = makeHost({ seed: 1, length: 8 });
  host.step(0);
  host.step(1);
  const reg = host.getRegister();
  host.transportStop();
  assert.equal(host.getRegister(), reg, "register preserved across stop");
  assert.equal(host.getPosition(), 0);
});

test("setParam length — re-inits register, position preserved", () => {
  const host = makeHost({ seed: 1, length: 8 });
  host.step(0);
  host.setParam("length", 16);
  const expected = createRegister(16, seedRng(1n)).register;
  assert.equal(host.getRegister(), expected);
  // Position not reset by length change (only transportStart does that)
  assert.equal(host.getPosition(), 1);
});

test("setParam seed — re-inits register from new seed", () => {
  const host = makeHost({ seed: 1, length: 8 });
  host.setParam("seed", 42);
  const expected = createRegister(8, seedRng(42n)).register;
  assert.equal(host.getRegister(), expected);
});

test("setParam lock — no register reset", () => {
  const host = makeHost({ seed: 1, length: 8 });
  host.step(0);
  const reg = host.getRegister();
  host.setParam("lock", 0.9);
  assert.equal(host.getRegister(), reg, "lock change does not touch register");
  assert.equal(host.getParams().lock, 0.9);
});

test("setParam triggerMode — clears mode-specific input state", () => {
  const host = makeHost({ triggerMode: "seed", seed: 1, length: 8 });
  host.noteIn(60, 100, 1); // activates seed
  // Switch to auto — seedActivated should clear, so next step does shiftAndFlip
  host.setParam("triggerMode", "auto");
  const regBefore = host.getRegister();
  host.step(0);
  // auto mode advanced the register
  assert.notEqual(host.getRegister(), regBefore);
});

test("setRange — orders lo ≤ hi", () => {
  const host = makeHost();
  host.setRange(72, 60); // reversed
  assert.equal(host.getParams().rangeLo, 60);
  assert.equal(host.getParams().rangeHi, 72);
});

test("setParam rangeLo > rangeHi — clamped to rangeHi", () => {
  const host = makeHost({ rangeLo: 48, rangeHi: 72 });
  host.setParam("rangeLo", 96);
  assert.equal(host.getParams().rangeLo, 72);
});

test("output range single-note (lo == hi) — note always lo", () => {
  const host = makeHost({
    seed: 1,
    length: 8,
    lock: 0.0,
    density: 1.0,
    rangeLo: 60,
    rangeHi: 60,
  });
  for (let i = 0; i < 8; i++) {
    const events = host.step(i);
    const noteOns = events.filter((e) => e.type === "noteOn");
    assert.equal(noteOns.length, 1);
    assert.equal(noteOns[0].pitch, 60, `step ${i}`);
  }
});
