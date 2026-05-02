// n4m entry for the Stencil TM device. Thin wrapper over TmBridge — wires
// the Max API (Max.outlet, Max.addHandler, Date.now, setTimeout) into the
// bridge's injected deps. No musical logic lives here.
//
// `.mjs` (not `.js`) is load-bearing for distribution: when the .amxd is
// baked / frozen, [node.script] extracts the script to a tempdir with no
// sibling package.json. `.js` would default to CJS there and the
// `import Max from "max-api"` line below would fail to parse, leaving
// [node.script] permanently in "Node script not ready" state. `.mjs` is
// unconditionally ESM. (Convention ported from oedipa, validated 2026-05-01
// against dev/dist Max console comparison.)
//
// `max-api` is provided by Max at runtime; it MUST NOT appear in
// package.json dependencies — the npm version conflicts with the injected
// one. Running this file under plain Node fails to resolve 'max-api'; the
// bridge logic is fully tested in bridge.test.ts and doesn't touch it.
//
// Protocol (see ADR 002 §Host ↔ Max protocol):
//
//   Max → here:
//     step <pos>                           advance to host step index
//     panic                                all notes off
//     setParam <key> <value>               scalar param update
//     setRange <lo> <hi>                   tuple param (TM range)
//     setBit <index> <value>               direct register write (jsui ring)
//     noteIn <pitch> <velocity> <channel>  incoming MIDI note-on
//     noteOff <pitch> <channel>            incoming MIDI note-off
//     transportStart                       pre-roll snapshot at 0→1
//     transportStop                        flush + reset position
//
//   here → Max (via Max.outlet):
//     note <pitch> <velocity> <channel>    velocity=0 = note-off
//     ready                                signaled once on construction
//     register <bit0> <bit1> … <bitN>      current register, bit-unpacked
//     position <n>                         current step index

import Max from "max-api";
import { TmBridge } from "./dist/host-tm/bridge.js";

Max.post("stencil tm: index.mjs loaded");

const bridge = new TmBridge({
  emitNote: (pitch, velocity, channel) =>
    Max.outlet("note", pitch, velocity, channel),
  emitOutlet: (channel, ...args) => Max.outlet(channel, ...args),
  now: () => Date.now(),
  scheduleAfter: (ms, cb) => setTimeout(cb, ms),
});

Max.addHandler("step", (pos) => bridge.step(Number(pos)));
Max.addHandler("panic", () => bridge.panic());
Max.addHandler("setParam", (key, value) => bridge.setParam(String(key), value));
Max.addHandler("setRange", (lo, hi) => bridge.setRange(Number(lo), Number(hi)));
Max.addHandler("setBit", (idx, val) =>
  bridge.setBit(Number(idx), Number(val)));
Max.addHandler("noteIn", (pitch, velocity, channel) =>
  bridge.noteIn(Number(pitch), Number(velocity), Number(channel)));
Max.addHandler("noteOff", (pitch, channel) =>
  bridge.noteOff(Number(pitch), Number(channel)));
Max.addHandler("transportStart", () => bridge.transportStart());
Max.addHandler("transportStop", () => bridge.transportStop());
