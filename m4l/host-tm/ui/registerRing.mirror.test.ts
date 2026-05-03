// Drift detector for registerRing.jsui.js (the [jsui] consumer) against
// registerRing.logic.ts (the canonical TS source). The renderer can't
// `import` from TS -- Max's classic JS engine has no module system -- so
// constants are mirrored by hand. This test reads the renderer source as
// text and asserts each named constant from logic.ts appears with the same
// numeric value.
//
// Caveat: this catches CONSTANT drift, not function-body drift. The logic
// surface is small (~5 functions, ~80 LOC) and the renderer mirrors them
// nearby with a "(mirrors registerRing.logic.ts)" comment marker; keep
// in sync by discipline. If drift becomes a real problem, the next step is
// option B from the design discussion: bundle logic via esbuild + jsui
// `include`. For v1 the constants are the most likely thing to change in
// isolation, so checking them is the highest-value cheap guard.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  BIT_GAP,
  CANVAS_MARGIN,
  MAX_BIT_RADIUS,
  MAX_LENGTH,
  MIN_LENGTH,
} from "./registerRing.logic.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDERER_PATH = join(__dirname, "registerRing.jsui.js");
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

test("renderer mirrors MIN_LENGTH from logic.ts", () => {
  assert.equal(findVarDecl("MIN_LENGTH"), MIN_LENGTH);
});

test("renderer mirrors MAX_LENGTH from logic.ts", () => {
  assert.equal(findVarDecl("MAX_LENGTH"), MAX_LENGTH);
});

test("renderer mirrors MAX_BIT_RADIUS from logic.ts", () => {
  assert.equal(findVarDecl("MAX_BIT_RADIUS"), MAX_BIT_RADIUS);
});

test("renderer mirrors BIT_GAP from logic.ts", () => {
  assert.equal(findVarDecl("BIT_GAP"), BIT_GAP);
});

test("renderer mirrors CANVAS_MARGIN from logic.ts", () => {
  assert.equal(findVarDecl("CANVAS_MARGIN"), CANVAS_MARGIN);
});

test("renderer is ASCII-only (Max classic JS parser constraint)", () => {
  // oedipa convention: cellstrip-renderer.js opens with the same constraint
  // ("Max's classic JS parser has been observed to choke on UTF-8 in source
  // files"). Failing this means any non-ASCII char slipped in -- escape
  // it as \\uXXXX in the renderer source.
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

test("renderer declares the message handlers the bridge emits", () => {
  // The bridge (bridge.ts) emits `register` and `position` outlets via
  // emitOutlet. The renderer must dispatch those names. Cheap text check:
  // a typo on either side breaks the link silently in Live, so catch it
  // here before manual verification time.
  assert.match(RENDERER_SRC, /msg === ['"]register['"]/);
  assert.match(RENDERER_SRC, /msg === ['"]position['"]/);
});

test("renderer emits the setBit message the bridge handles", () => {
  // bridge.ts `setBit(index, value)` is the upstream half of the click
  // round-trip. If the renderer renames its outlet message, the click
  // becomes a no-op. Catch it via text check.
  assert.match(RENDERER_SRC, /outlet\([^)]*['"]setBit['"]/);
});
