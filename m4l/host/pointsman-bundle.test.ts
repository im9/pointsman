// Guard test for the Pointsman host bundle (ADR 002 §Phase 0).
//
// Bundled output produced by `pnpm bundle:host` (run via `pnpm bake`).
// The file is .gitignored — fresh checkouts won't have it until first
// bake. The asserted invariant: only `max-api` remains as a runtime
// import in the bundle. Max injects `max-api` at runtime via
// [node.script]; everything else (host bridge, engine quantizer / RNG,
// humanize) must be inlined so that Max Freeze captures the entire
// host (oedipa ADR 007 §Phase 5: freeze does not follow ESM `import`
// chains).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const BUNDLE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "pointsman.mjs",
);

const skipReason = !existsSync(BUNDLE)
  ? "bundle not built — run `pnpm bake` from m4l/"
  : false;

describe("pointsman.mjs bundle (ADR 002 §Phase 0)", () => {
  test("bundle file exists", { skip: skipReason }, () => {
    assert.ok(existsSync(BUNDLE));
  });

  test("only 'max-api' remains as runtime import", { skip: skipReason }, () => {
    const text = readFileSync(BUNDLE, "utf8");
    // Match top-level ESM static imports (with or without `from`).
    const importRe = /(?:^|\n)\s*import\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
    const externals = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(text)) !== null) externals.add(m[1]);
    const allowed = new Set(["max-api"]);
    const unexpected = [...externals].filter((s) => !allowed.has(s));
    assert.deepEqual(
      unexpected,
      [],
      `Bundled pointsman.mjs has unexpected runtime imports: ${unexpected.join(", ")}.\n` +
        `Only 'max-api' should be external (Max provides it at runtime). All other deps\n` +
        `must be bundled in. If freeze is to capture the entire host, the entry needs to\n` +
        `be self-contained except for the Max-injected runtime.`,
    );
  });
});
