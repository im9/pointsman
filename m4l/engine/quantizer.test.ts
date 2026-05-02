import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildScalePitches,
  snapToScale,
  type ScaleName,
} from "./quantizer.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = join(__dirname, "../../docs/ai/quantizer-test-vectors.json");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const V: any = JSON.parse(readFileSync(VECTORS_PATH, "utf8"));

test("buildScalePitches — full enumeration matches vectors", () => {
  for (const tc of V.build_scale_pitches) {
    const pitches = buildScalePitches(tc.scale as ScaleName, tc.root);
    if (tc.scale === "chromatic-half") {
      // chromatic-half stores spot-check fields, not full pitches array.
      assert.equal(pitches.length, tc.pitches_length, "chromatic-half length");
      assert.deepEqual(pitches.slice(0, 5), tc.pitches_first_5,
        "chromatic-half first 5");
      assert.deepEqual(pitches.slice(-5), tc.pitches_last_5,
        "chromatic-half last 5");
    } else {
      assert.deepEqual(pitches, tc.pitches,
        `scale=${tc.scale} root=${tc.root}`);
    }
  }
});

test("snapToScale — exact, nearest, ties, edges, identity", () => {
  for (const tc of V.snap_to_scale) {
    const pitches = buildScalePitches(tc.scale as ScaleName, tc.root);
    const out = snapToScale(tc.note, pitches);
    assert.equal(out, tc.expected, tc.label);
  }
});
