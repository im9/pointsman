#!/usr/bin/env node
// One-off Phase 5 maxpat surgery: idempotent (re-runnable). Deletes v1
// widgets/wiring/labels, mutates mode/seed/route boxes, adds feel/drift
// widgets, and aligns harmony slot widget parameter_initial values to the
// v2 default 1-3-5 triad (V1=3rd above, V2=5th above, V3=off). Safe to
// delete after Phase 5 ships and the maxpat is committed.
//
// Surface: see docs/ai/m4l-phase5-handoff.md "Max patch" table.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAXPAT_PATH = resolve(__dirname, '..', 'Pointsman.maxpat')

const data = JSON.parse(readFileSync(MAXPAT_PATH, 'utf8'))

const REMOVED_IDS = new Set([
  // Five humanize widgets + their prepend setParam newobjs.
  'obj-w-humanizeVelocity', 'obj-prep-humanizeVelocity',
  'obj-w-humanizeGate', 'obj-prep-humanizeGate',
  'obj-w-humanizeTiming', 'obj-prep-humanizeTiming',
  'obj-w-humanizeDrift', 'obj-prep-humanizeDrift',
  'obj-w-outputLevel', 'obj-prep-outputLevel',
  // Trigger mode (live.menu + sel cracker + per-value messages).
  'obj-w-triggerMode', 'obj-sel-triggerMode',
  'obj-msg-triggerMode-passthrough', 'obj-msg-triggerMode-root',
  // Control channel (numbox + prepend).
  'obj-w-controlChannel', 'obj-prep-controlChannel',
  // Mode harmony message (third enum value gone).
  'obj-msg-mode-harmony',
  // chordChanged routing chain (route outlet 4 → defer → prepend → jsui).
  'obj-defer-cc', 'obj-prep-cc',
  // Stale comment labels for now-removed widgets — leaving them shows
  // empty "TRG" / "CTL" text floating in the presentation strip.
  'obj-lbl-triggerMode', 'obj-lbl-controlChannel',
])

const beforeBoxCount = data.patcher.boxes.length
const beforeLineCount = data.patcher.lines.length

data.patcher.boxes = data.patcher.boxes.filter(
  (b) => !REMOVED_IDS.has(b.box.id),
)
data.patcher.lines = data.patcher.lines.filter((l) => {
  const s = l.patchline?.source?.[0]
  const d = l.patchline?.destination?.[0]
  return !REMOVED_IDS.has(s) && !REMOVED_IDS.has(d)
})

// Mode enum 3 → 2 (drop "harmony").
const modeBox = data.patcher.boxes.find((b) => b.box.id === 'obj-w-mode')
modeBox.box.saved_attribute_attributes.valueof.parameter_enum = ['scale', 'chord']

// obj-sel-mode "sel 0 1 2" → "sel 0 1" (drop the 3rd outlet that fed
// obj-msg-mode-harmony, which is gone).
const selModeBox = data.patcher.boxes.find((b) => b.box.id === 'obj-sel-mode')
selModeBox.box.text = 'sel 0 1'

// obj-sel-mode-harmony "sel 2" → "sel 1". The id is internal; rather than
// rename + rewire all references, keep the id and just change semantics
// (show HARMONY group when mode == 1 (chord) in v2, instead of mode == 2
// (harmony) in v1).
const selMcBox = data.patcher.boxes.find((b) => b.box.id === 'obj-sel-mode-harmony')
selMcBox.box.text = 'sel 1'

// Seed range: APVTS float32 round-trip safe bound (concept.md §"Parameter
// surface" footnote: 2^24-1 = 0xffffff).
const seedBox = data.patcher.boxes.find((b) => b.box.id === 'obj-w-seed')
seedBox.box.saved_attribute_attributes.valueof.parameter_mmax = 16777215.0
seedBox.box.saved_attribute_attributes.valueof.parameter_steps = 16777216

// Drop chordChanged token from the outlet router.
const routeBox = data.patcher.boxes.find((b) => b.box.id === 'obj-route-out')
routeBox.box.text = 'route note ready scaleChanged notePulse'

// Harmony widget parameter_initial alignment for the 1-3-5 default triad.
// Without this, the ready-bang phase fires V*Direction=off, which wins
// against the bridge's constructor defaults and leaves chord mode running
// 1-in-1-out (the user-visible "chord で和音にならない" symptom).
//
// Direction enum: ["off", "above", "below"] → above = idx 1, off = idx 0.
// Interval enum:  ["3rd", "4th", "5th", "6th"] → 3rd = idx 0, 5th = idx 2.
const setInitial = (id, idx) => {
  const b = data.patcher.boxes.find((x) => x.box.id === id)
  b.box.saved_attribute_attributes.valueof.parameter_initial = [idx]
}
setInitial('obj-w-harmonyV1Interval', 0)   // 3rd
setInitial('obj-w-harmonyV1Direction', 1)  // above
setInitial('obj-w-harmonyV2Interval', 2)   // 5th
setInitial('obj-w-harmonyV2Direction', 1)  // above
setInitial('obj-w-harmonyV3Interval', 0)   // 3rd (doesn't matter; V3=off)
setInitial('obj-w-harmonyV3Direction', 0)  // off

// feel / drift widgets — add only if missing (idempotent).
function ensureBox(id, factory) {
  if (data.patcher.boxes.some((b) => b.box.id === id)) return
  data.patcher.boxes.push(factory())
}
ensureBox('obj-w-feel', () => ({
  box: {
    id: 'obj-w-feel',
    maxclass: 'live.dial',
    numinlets: 1,
    numoutlets: 2,
    outlettype: ['', 'float'],
    parameter_enable: 1,
    patching_rect: [970.0, 270.0, 36.0, 52.0],
    presentation: 1,
    presentation_rect: [760.0, 110.0, 36.0, 52.0],
    saved_attribute_attributes: {
      valueof: {
        parameter_initial: [0.0],
        parameter_initial_enable: 1,
        parameter_longname: 'PointsmanFeel',
        parameter_mmax: 1.0,
        parameter_mmin: 0.0,
        parameter_shortname: 'FEEL',
        parameter_type: 0,
        parameter_unitstyle: 1,
      },
    },
  },
}))
ensureBox('obj-w-drift', () => ({
  box: {
    id: 'obj-w-drift',
    maxclass: 'live.dial',
    numinlets: 1,
    numoutlets: 2,
    outlettype: ['', 'float'],
    parameter_enable: 1,
    patching_rect: [1020.0, 270.0, 36.0, 52.0],
    presentation: 1,
    presentation_rect: [810.0, 110.0, 36.0, 52.0],
    saved_attribute_attributes: {
      valueof: {
        parameter_initial: [0.0],
        parameter_initial_enable: 1,
        parameter_longname: 'PointsmanDrift',
        parameter_mmax: 1.0,
        parameter_mmin: 0.0,
        parameter_shortname: 'DRIFT',
        parameter_type: 0,
        parameter_unitstyle: 1,
      },
    },
  },
}))
ensureBox('obj-prep-feel', () => ({
  box: {
    id: 'obj-prep-feel',
    maxclass: 'newobj',
    text: 'prepend setParam feel',
    numinlets: 1,
    numoutlets: 1,
    outlettype: [''],
    patching_rect: [1100.0, 270.0, 200.0, 22.0],
  },
}))
ensureBox('obj-prep-drift', () => ({
  box: {
    id: 'obj-prep-drift',
    maxclass: 'newobj',
    text: 'prepend setParam drift',
    numinlets: 1,
    numoutlets: 1,
    outlettype: [''],
    patching_rect: [1100.0, 300.0, 200.0, 22.0],
  },
}))

// Add wires only if missing (idempotent).
function hasLine(src, dst) {
  return data.patcher.lines.some((l) =>
    l.patchline?.source?.[0] === src[0] &&
    (src[1] === undefined || l.patchline?.source?.[1] === src[1]) &&
    l.patchline?.destination?.[0] === dst[0] &&
    (dst[1] === undefined || l.patchline?.destination?.[1] === dst[1])
  )
}
function ensureLine(src, dst) {
  if (hasLine(src, dst)) return
  data.patcher.lines.push({ patchline: { source: src, destination: dst } })
}
ensureLine(['obj-w-feel', 0], ['obj-prep-feel', 0])
ensureLine(['obj-prep-feel', 0], ['obj-nodescript', 0])
ensureLine(['obj-w-drift', 0], ['obj-prep-drift', 0])
ensureLine(['obj-prep-drift', 0], ['obj-nodescript', 0])
ensureLine(['obj-trig-ready', 0], ['obj-w-feel', 0])
ensureLine(['obj-trig-ready', 0], ['obj-w-drift', 0])

writeFileSync(MAXPAT_PATH, JSON.stringify(data, null, 4) + '\n')

console.log(`Surgery complete (idempotent re-run).`)
console.log(`  boxes:  ${beforeBoxCount} → ${data.patcher.boxes.length}`)
console.log(`  lines:  ${beforeLineCount} → ${data.patcher.lines.length}`)
