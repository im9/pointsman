// Pointsman n4m entry source. Thin wrapper over QtBridge — wires the
// Max API (Max.outlet, Max.addHandler, Date.now, setTimeout) into the
// bridge's injected deps. No musical logic lives here.
//
// Build pipeline (ADR 002 §Phase 0):
// - Source: `m4l/pointsman.entry.mjs` (this file, tracked).
// - Bundled output: `m4l/pointsman.mjs` (gitignored). Produced by
//   `pnpm bundle:host` (esbuild) with `--external:max-api`; everything
//   else (host bridge, engine quantizer / RNG, humanize) is inlined so
//   that Max Freeze captures the entire host. Max Freeze does NOT
//   follow ESM `import` chains (oedipa ADR 007 §Phase 5); pre-bundling
//   is what lets a frozen `dist/Pointsman.amxd` load on any Live install.
//
// Path conventions (flat, m4l/ root):
// - The bundled output MUST live at `m4l/pointsman.mjs` (NOT under
//   host/), because Max [node.script]'s `filename` attribute does not
//   reliably resolve subdirectory paths in M4L presentation view. Same
//   constraint as Max [jsui], which is why `scaleKeyboard.jsui.js` is
//   also at the m4l/ root.
// - The compiled bridge dist lives under `host/dist/host/` and is
//   imported relatively from this entry source — esbuild follows the
//   `import "./..."` chain at bundle time and inlines everything.
//
// `.mjs` (not `.js`) on the bundle output is load-bearing: when the
// .amxd is baked / frozen, [node.script] extracts the script to a
// tempdir with no sibling package.json. `.js` would default to CJS
// there and the `import Max from "max-api"` line below would fail to
// parse, leaving [node.script] permanently in "Node script not ready"
// state. `.mjs` is unconditionally ESM. (Convention ported from
// oedipa, validated against TM's dev/dist Max console comparison.)
//
// `max-api` is provided by Max at runtime; it MUST NOT appear in
// package.json dependencies — the npm version conflicts with the
// injected one. Running this file under plain Node fails to resolve
// 'max-api'; the bridge logic is fully tested in bridge.test.ts and
// doesn't touch it.
//
// Protocol (see ADR 002 §Host ↔ Max protocol):
//
//   Max → here:
//     setParam <key> <value>               scalar param update
//     noteIn <pitch> <velocity> <channel>  incoming MIDI note-on
//     noteOff <pitch> <channel>            incoming MIDI note-off
//     panic                                all notes off
//     transportStart                       host state reset
//     transportStop                        flush
//
//   here → Max (via Max.outlet):
//     note <pitch> <velocity> <channel>    velocity=0 = note-off
//     ready                                fired once after all handlers
//                                          are installed; the patcher gates
//                                          its initial live.* dump on this
//                                          (ADR 003 §Stencil-QT patcher)
//     scaleChanged <scale> <root>          for jsui keyboard refresh
//     notePulse <pitch> <velocity>         per quantized noteOn (lockstep)

import Max from "max-api";
import { QtBridge } from "./host/dist/host/bridge.js";

Max.post("pointsman: pointsman.mjs loaded");

const bridge = new QtBridge({
  emitNote: (pitch, velocity, channel) =>
    Max.outlet("note", pitch, velocity, channel),
  emitOutlet: (channel, ...args) => Max.outlet(channel, ...args),
  now: () => Date.now(),
  scheduleAfter: (ms, cb) => setTimeout(cb, ms),
});

Max.addHandler("setParam", (key, value) => bridge.setParam(String(key), value));
Max.addHandler("noteIn", (pitch, velocity, channel) =>
  bridge.noteIn(Number(pitch), Number(velocity), Number(channel)));
Max.addHandler("noteOff", (pitch, channel) =>
  bridge.noteOff(Number(pitch), Number(channel)));
Max.addHandler("panic", () => bridge.panic());
Max.addHandler("transportStart", () => bridge.transportStart());
Max.addHandler("transportStop", () => bridge.transportStop());

// Signal the patcher that node.script is up and every handler is wired.
// The patcher's [route ... ready ...] outlet bangs each live.* widget on
// this so the 12 setParam dispatches arrive AFTER addHandler installation,
// not before (which would drop them with "Node script not ready").
Max.outlet("ready", 1);
