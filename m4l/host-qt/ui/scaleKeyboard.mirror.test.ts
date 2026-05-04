// Drift detector for scaleKeyboard.jsui.js (the [jsui] consumer) against
// scaleKeyboard.logic.ts (the canonical TS source) and quantizer.ts (the
// canonical scale-interval source). The renderer can't `import` from TS --
// Max's classic JS engine has no module system -- so constants and the
// scale-intervals table are mirrored by hand. This test reads the renderer
// source as text and asserts each named constant and each scale's interval
// list appear with matching values.
//
// Caveat: this catches CONSTANT and SCALE-TABLE drift, not function-body
// drift. The logic surface is small and the renderer mirrors it nearby.
// Keep in sync by discipline; if drift becomes a real problem, the next
// step is to bundle logic via esbuild + jsui `include`. For v1 the
// constants and the scale table are the most likely things to change in
// isolation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  BLACK_KEY_HEIGHT_RATIO,
  BLACK_KEY_WIDTH_RATIO,
  DOT_INSET_RATIO,
  DOT_RADIUS_RATIO,
  NUM_PITCH_CLASSES,
  PULSE_DECAY_MS,
  WHITE_KEYS_PER_OCTAVE,
} from "./scaleKeyboard.logic.ts";
import { SCALE_INTERVALS } from "../../engine/quantizer.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Renderer lives at m4l/scaleKeyboard.jsui.js (flat, not under
// host-qt/ui/) because Max [jsui]'s `filename` resolution does not
// reliably handle subdirectory paths in M4L presentation view —
// observed empirically on TM where a subdirectory-pathed jsui rendered
// as a generic placeholder instead of the renderer's output. See ADR
// 004 §Patcher path conventions.
const RENDERER_PATH = join(__dirname, "..", "..", "scaleKeyboard.jsui.js");
const RENDERER_SRC = readFileSync(RENDERER_PATH, "utf8");

function findVarDecl(name: string): number {
  // Match `var NAME = <number>` -- the renderer's mirror block uses this
  // exact form. If a future refactor switches to `const` or computes the
  // value, this regex will fail and the dev will know to update both
  // sides intentionally.
  const re = new RegExp(`var\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`, "m");
  const m = re.exec(RENDERER_SRC);
  if (!m) throw new Error(`renderer missing var ${name}`);
  return Number(m[1]);
}

function findScaleIntervals(name: string): number[] {
  // Match `'<scale>': [<csv ints>]` inside the SCALE_INTERVALS object.
  // The renderer uses single quotes around the keys (Max classic JS
  // convention); single-line array literals.
  const re = new RegExp(`'${name}'\\s*:\\s*\\[([^\\]]*)\\]`, "m");
  const m = re.exec(RENDERER_SRC);
  if (!m) throw new Error(`renderer missing scale '${name}'`);
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s));
}

test("renderer mirrors NUM_PITCH_CLASSES", () => {
  assert.equal(findVarDecl("NUM_PITCH_CLASSES"), NUM_PITCH_CLASSES);
});

test("renderer mirrors WHITE_KEYS_PER_OCTAVE", () => {
  assert.equal(findVarDecl("WHITE_KEYS_PER_OCTAVE"), WHITE_KEYS_PER_OCTAVE);
});

test("renderer mirrors PULSE_DECAY_MS", () => {
  assert.equal(findVarDecl("PULSE_DECAY_MS"), PULSE_DECAY_MS);
});

test("renderer mirrors BLACK_KEY_WIDTH_RATIO", () => {
  assert.equal(findVarDecl("BLACK_KEY_WIDTH_RATIO"), BLACK_KEY_WIDTH_RATIO);
});

test("renderer mirrors BLACK_KEY_HEIGHT_RATIO", () => {
  assert.equal(findVarDecl("BLACK_KEY_HEIGHT_RATIO"), BLACK_KEY_HEIGHT_RATIO);
});

test("renderer mirrors DOT_INSET_RATIO", () => {
  assert.equal(findVarDecl("DOT_INSET_RATIO"), DOT_INSET_RATIO);
});

test("renderer mirrors DOT_RADIUS_RATIO", () => {
  assert.equal(findVarDecl("DOT_RADIUS_RATIO"), DOT_RADIUS_RATIO);
});

test("renderer SCALE_INTERVALS matches engine for every scale name", () => {
  // The engine is the source of truth for scale definitions. The renderer
  // duplicates the table out of necessity (jsui can't import); this test
  // catches a typo or omitted entry on the renderer side.
  for (const [name, intervals] of Object.entries(SCALE_INTERVALS)) {
    const mirrored = findScaleIntervals(name);
    assert.deepEqual(mirrored, intervals, `scale=${name}`);
  }
});

test("renderer is ASCII-only (Max classic JS parser constraint)", () => {
  // oedipa convention: cellstrip-renderer.js opens with the same
  // constraint ("Max's classic JS parser has been observed to choke on
  // UTF-8 in source files"). Failing this means any non-ASCII char
  // slipped in -- escape it as \\uXXXX in the renderer source.
  for (let i = 0; i < RENDERER_SRC.length; i++) {
    const code = RENDERER_SRC.charCodeAt(i);
    if (code > 0x7f) {
      const ctxStart = Math.max(0, i - 20);
      const ctxEnd = Math.min(RENDERER_SRC.length, i + 20);
      const ctx = RENDERER_SRC.slice(ctxStart, ctxEnd);
      assert.fail(
        `non-ASCII char (0x${code.toString(16)}) at offset ${i}: "${ctx}"`,
      );
    }
  }
});

test("renderer dispatches the message names the bridge emits", () => {
  // bridge.ts emits `scaleChanged` and `notePulse` outlets. The renderer
  // must dispatch those names. Cheap text check: a typo on either side
  // breaks the link silently in Live, so catch it here before manual
  // verification time.
  assert.match(RENDERER_SRC, /msg === ['"]scaleChanged['"]/);
  assert.match(RENDERER_SRC, /msg === ['"]notePulse['"]/);
});

test("renderer handles 'chromatic-half' as the all-true case", () => {
  // chromatic-half is special-cased in the engine (all 128 MIDI notes are
  // in-scale) -- the renderer must replicate that branch, otherwise
  // chromatic-half would silently render as no-pitches-in-scale.
  assert.match(RENDERER_SRC, /['"]chromatic-half['"]/);
});
