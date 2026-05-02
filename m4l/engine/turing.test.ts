import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  createRegister,
  mapToNote,
  nextU32,
  registerToFraction,
  seedRng,
  shiftAndFlip,
  shiftAndForce,
  tmStep,
  type RngState,
} from "./turing.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = join(__dirname, "../../docs/ai/turing-test-vectors.json");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const V: any = JSON.parse(readFileSync(VECTORS_PATH, "utf8"));

test("xoshiro state words after SplitMix64 seeding", () => {
  for (const tc of V.splitmix64_init) {
    const seed = BigInt(tc.seed.decimal);
    const s = seedRng(seed);
    const expected = tc.xoshiro_state_s.map(
      (w: { decimal: number }) => w.decimal >>> 0,
    );
    assert.deepEqual([s[0], s[1], s[2], s[3]], expected,
      `seed=${tc.seed.hex}`);
  }
});

test("xoshiro128++ first-N draws match vectors", () => {
  for (const tc of V.prng) {
    const seed = BigInt(tc.seed.decimal);
    let rng: RngState = seedRng(seed);
    for (let i = 0; i < tc.draws.length; i++) {
      const r = nextU32(rng);
      assert.equal(
        r.value >>> 0,
        tc.draws[i].decimal >>> 0,
        `seed=${tc.seed.hex} draw[${i}]`,
      );
      rng = r.state;
    }
  }
});

test("createRegister determinism for (seed, length) pairs", () => {
  for (const tc of V.register_init) {
    const seed = BigInt(tc.seed.decimal);
    const rng = seedRng(seed);
    const r = createRegister(tc.length, rng);
    assert.equal(
      r.register >>> 0,
      tc.register >>> 0,
      `seed=${tc.seed.hex} length=${tc.length}`,
    );
  }
});

test("registerToFraction returns exact rational", () => {
  for (const tc of V.register_to_fraction) {
    const f = registerToFraction(tc.register, tc.length);
    assert.equal(f.num, tc.fraction.num,
      `register=${tc.register} length=${tc.length} num`);
    assert.equal(f.den, tc.fraction.den,
      `register=${tc.register} length=${tc.length} den`);
  }
});

test("mapToNote — boundary, midpoint, lo==hi, clamp", () => {
  for (const tc of V.map_to_note) {
    const note = mapToNote(tc.num, tc.den, tc.range[0], tc.range[1]);
    assert.equal(
      note,
      tc.note,
      `num=${tc.num}/${tc.den} range=[${tc.range[0]},${tc.range[1]}]`,
    );
  }
});

test("shiftAndFlip — register output matches vectors", () => {
  for (const tc of V.shift_and_flip) {
    const seed = BigInt(tc.seed.decimal);
    const rng = seedRng(seed);
    const r = shiftAndFlip(tc.register, tc.length, tc.lock, rng);
    assert.equal(
      r.register >>> 0,
      tc.register_after >>> 0,
      tc.label,
    );
  }
});

test("shiftAndForce — pure bit shift + forced head bit", () => {
  for (const tc of V.shift_and_force) {
    const r = shiftAndForce(tc.register, tc.length, tc.force_bit as 0 | 1);
    assert.equal(r >>> 0, tc.register_after >>> 0, tc.label);
  }
});

test("tmStep — multi-step end-to-end traces match", () => {
  for (const sc of V.tm_step) {
    const seed = BigInt(sc.seed.decimal);
    const initRng = seedRng(seed);
    const init = createRegister(sc.length, initRng);
    let state = { register: init.register, rng: init.state };
    const params = {
      length: sc.length,
      lock: sc.lock,
      density: sc.density,
      range: sc.range as [number, number],
    };
    assert.equal(
      state.register >>> 0,
      sc.initial_register >>> 0,
      `${sc.name} initial_register`,
    );
    for (const expected of sc.trace) {
      assert.equal(
        state.register >>> 0,
        expected.register_in >>> 0,
        `${sc.name} step ${expected.step} register_in`,
      );
      const r = tmStep(state, params);
      assert.equal(
        r.output.note,
        expected.note,
        `${sc.name} step ${expected.step} note`,
      );
      assert.equal(
        r.output.active,
        expected.active,
        `${sc.name} step ${expected.step} active`,
      );
      assert.equal(
        r.state.register >>> 0,
        expected.register_out >>> 0,
        `${sc.name} step ${expected.step} register_out`,
      );
      state = r.state;
    }
  }
});
