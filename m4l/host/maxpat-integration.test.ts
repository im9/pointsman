// End-to-end integration test: simulates the patcher's parameter_initial
// cascade against a fresh PointsmanBridge, then verifies the resulting
// behaviour matches concept.md v2 defaults.
//
// This test exists because Phase 5 shipped with two bugs that the per-
// module unit tests passed cleanly:
//   1. harmonyV{1,2}Direction parameter_initial stayed at 0 ("off") in
//      the .maxpat, so the ready-bang cascade overwrote the bridge's
//      v2 default (1-3-5 triad) with three "off" slots → chord mode ran
//      1-in-1-out.
//   2. Stale label comments (TRG / CTL) lingered with no corresponding
//      widget.
//
// Per-module unit tests (host.test.ts / bridge.test.ts) verify the bridge
// against synthesised inputs, NOT against the patcher's actual
// parameter_initial state. This test crosses that boundary by reading
// Pointsman.maxpat and replaying the widget cascade through the bridge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  type BridgeDeps,
  PointsmanBridge,
} from "./bridge.ts";

interface NoteCall { pitch: number; velocity: number; channel: number }
interface OutletCall { channel: string; args: Array<number | string> }

function makeFakeDeps(): {
  deps: BridgeDeps;
  notes: NoteCall[];
  outlets: OutletCall[];
} {
  const notes: NoteCall[] = [];
  const outlets: OutletCall[] = [];
  const deps: BridgeDeps = {
    emitNote: (pitch, velocity, channel) => notes.push({ pitch, velocity, channel }),
    emitOutlet: (channel, ...args) => outlets.push({ channel, args }),
    now: () => 0,
    scheduleAfter: (_ms, _cb) => { /* tests don't drive timers */ },
  };
  return { deps, notes, outlets };
}

// Map a live.* widget's parameter_longname to the bridge setParam key.
// Mirrors the (longname → bridgeKey) mapping in scripts/patcher.test.mjs.
// ADR 004 Phase 3-C: the v0.1 harmonyV[1-3] slot widgets are gone;
// chordShape + 8 arp params replace them. arpAccent / arpSlide are NOT
// live.* widgets — Phase 4 floating-window UI + hidden persistence.
const LONGNAME_TO_KEY: Record<string, string> = {
  PointsmanScale: "scale",
  PointsmanRoot: "root",
  PointsmanMode: "mode",
  PointsmanFeel: "feel",
  PointsmanDrift: "drift",
  PointsmanInputChannel: "inputChannel",
  PointsmanSeed: "seed",
  PointsmanChordShape: "chordShape",
  PointsmanArpPattern: "arpPattern",
  PointsmanArpRate: "arpRate",
  PointsmanArpOctaves: "arpOctaves",
  PointsmanArpStepRepeats: "arpStepRepeats",
  PointsmanArpGate: "arpGate",
  PointsmanArpVariation: "arpVariation",
  PointsmanArpLatch: "arpLatch",
  PointsmanArpSwing: "arpSwing",
};

// Int-enum widgets: live.menu with parameter_type=2 (string display) but
// the dispatch wiring sends the int index rather than the string. The
// bridge accepts both forms (resolveX helpers); using int here keeps the
// cascade simulation aligned with the actual maxpat wiring shape (which
// uses [prepend setParam <key>] on the live.menu's int outlet, not the
// per-value [sel + msg] string cascade).
const INT_ENUM_LONGNAMES = new Set([
  "PointsmanRoot",
  "PointsmanChordShape",
  "PointsmanArpPattern",
  "PointsmanArpRate",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function widgetInitialPayload(box: any): unknown {
  const attrs = box.box.saved_attribute_attributes?.valueof ?? {};
  const initial = attrs.parameter_initial?.[0];
  // String-enum widgets: dispatch the enum string at idx parameter_initial.
  // Int-enum / numeric widgets: dispatch the int / float directly.
  if (
    attrs.parameter_type === 2 &&
    !INT_ENUM_LONGNAMES.has(attrs.parameter_longname)
  ) {
    return attrs.parameter_enum?.[initial] ?? "";
  }
  return initial;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findLiveWidgets(boxes: any[]): any[] {
  return boxes.filter((b) => {
    const cls = b.box?.maxclass;
    // ADR 004 Phase 3-C adds live.toggle (arpLatch).
    return (cls === "live.dial" || cls === "live.menu" ||
            cls === "live.numbox" || cls === "live.slider" ||
            cls === "live.toggle") &&
      typeof b.box?.saved_attribute_attributes?.valueof?.parameter_longname === "string" &&
      b.box.saved_attribute_attributes.valueof.parameter_longname.startsWith("Pointsman");
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAXPAT_PATH = resolve(__dirname, "..", "Pointsman.maxpat");

function buildBridgeAfterCascade(): {
  bridge: PointsmanBridge;
  notes: NoteCall[];
  outlets: OutletCall[];
} {
  const data = JSON.parse(readFileSync(MAXPAT_PATH, "utf8"));
  const fake = makeFakeDeps();
  const bridge = new PointsmanBridge(fake.deps);
  // Replay the ready-bang cascade: each live.* widget fires its
  // parameter_initial through the prepend setParam chain into the bridge.
  for (const w of findLiveWidgets(data.patcher.boxes)) {
    const longname = w.box.saved_attribute_attributes.valueof.parameter_longname;
    const key = LONGNAME_TO_KEY[longname];
    if (!key) continue; // unknown widget — fail loudly elsewhere
    bridge.setParam(key, widgetInitialPayload(w));
  }
  return { bridge, notes: fake.notes, outlets: fake.outlets };
}

// ---- the test that would have caught the chord-default bug ---------------

test("maxpat default cascade → chord mode emits a 1-3-5 triad", () => {
  // concept.md §"Scale and chord modes": "harmonyVoices defaults to
  // [{3, above}, {5, above}] on new plugin instances, so chord mode out
  // of the box emits a diatonic 1-3-5 triad rooted on the input pitch
  // (e.g. C → {C, E, G} in C major)."
  //
  // The contract is end-to-end: the maxpat's widget parameter_initial
  // values, threaded through the bridge cascade, must land at the v2
  // default. Asserting it via output is robust against future per-slot
  // mapping refactors.
  const { bridge, notes } = buildBridgeAfterCascade();
  // After cascade: mode defaults to "scale". Switch to chord and send
  // C(60) on the default omni input channel.
  bridge.setParam("mode", "chord");
  bridge.noteIn(60, 100, 1);
  // C major + default voices → {60 (C), 64 (E), 67 (G)}.
  // Threshold 3: concept.md §"Scale and chord modes" 1-3-5 triad spec.
  assert.equal(notes.length, 3,
    `expected 3-note triad after cascade default; got ${notes.length} notes (${JSON.stringify(notes.map((n) => n.pitch))})`);
  assert.deepEqual(notes.map((n) => n.pitch), [60, 64, 67]);
});

test("maxpat default cascade → scale mode still emits a single note", () => {
  // Counter-test: same cascade defaults, but mode=scale (the actual
  // default) → 1-in-1-out (harmonyVoices populated but ignored in scale
  // mode). Guards against accidentally making chord-expansion the always-on
  // behaviour.
  const { bridge, notes } = buildBridgeAfterCascade();
  // Mode defaults to "scale" via the cascade — no setParam needed.
  bridge.noteIn(60, 100, 1);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].pitch, 60);
});

// ---- orphan-label guard --------------------------------------------------
//
// The Phase 5 surgery removed the triggerMode + controlChannel widgets but
// left their label comments behind, which rendered as empty "TRG" / "CTL"
// glyphs in the presentation strip. Generalise: for every label comment
// named obj-lbl-<key>, assert a matching obj-w-<key> widget exists.

test("maxpat — every obj-lbl-<key> comment has a matching obj-w-<key> widget", () => {
  const data = JSON.parse(readFileSync(MAXPAT_PATH, "utf8"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boxes: any[] = data.patcher.boxes;
  const widgetIds = new Set(boxes.map((b) => b.box?.id).filter(Boolean));
  const orphans: string[] = [];
  for (const b of boxes) {
    const id = b.box?.id;
    if (typeof id !== "string") continue;
    const m = /^obj-lbl-(.+)$/.exec(id);
    if (!m) continue;
    const widgetId = `obj-w-${m[1]}`;
    if (!widgetIds.has(widgetId)) orphans.push(id);
  }
  assert.deepEqual(orphans, [],
    `orphaned labels (no matching obj-w-<key> widget): ${orphans.join(", ")}`);
});
