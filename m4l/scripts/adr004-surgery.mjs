#!/usr/bin/env node
// One-off ADR 004 Phase 3-C maxpat surgery: idempotent (re-runnable).
// Drops the v0.1 harmonyV[1-3] slot widget cluster, extends mode + scale
// enums with the v0.2 additions ("arp" / "phrygian-dominant"), and adds
// chordShape + 8 arp live.* widgets matching the vst pid surface 1:1.
//
// Safe to delete after Phase 3-C ships and the maxpat is committed.
// Modelled on scripts/phase5-surgery.mjs.
//
// Scope:
// - DELETE: 6 harmonyV widgets + their sel demuxers + per-value msg boxes
//   (3 V*Interval × 4 msgs + 3 V*Direction × 3 msgs = 21 msg boxes);
//   the v0.1 mode-routing visibility chain (sel-mode-harmony +
//   msg-voices-hidden-*) and the "VOICES" group label. Phase 4 rebuilds
//   mode-contextual visibility for all 3 modes.
// - MUTATE: obj-w-mode parameter_enum + obj-sel-mode → 3 outlets (+arp);
//   obj-w-scale parameter_enum + obj-sel-scale → 16 outlets
//   (+phrygian-dominant).
// - ADD: msg-mode-arp + msg-scale-phrygian-dominant cascade boxes;
//   chordShape + 8 arp live.* widgets (each with a parallel
//   [prepend setParam <key>] dispatch newobj). The new widgets are
//   placed off-presentation; Phase 4 redesigns the visible strip.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAXPAT_PATH = resolve(__dirname, '..', 'Pointsman.maxpat')
const data = JSON.parse(readFileSync(MAXPAT_PATH, 'utf8'))

const beforeBoxCount = data.patcher.boxes.length
const beforeLineCount = data.patcher.lines.length

// ──────────────────────────────────────────────────────────────────────
// 1. Removed IDs — 6 widgets, sel demuxers, per-value msg boxes,
//    mode-routing visibility helpers, group label.
// ──────────────────────────────────────────────────────────────────────

const harmonyMsgs = []
for (const v of ['V1', 'V2', 'V3']) {
  harmonyMsgs.push(`obj-w-harmony${v}Interval`)
  harmonyMsgs.push(`obj-w-harmony${v}Direction`)
  harmonyMsgs.push(`obj-sel-harmony${v}Interval`)
  harmonyMsgs.push(`obj-sel-harmony${v}Direction`)
  for (const i of ['3rd', '4th', '5th', '6th']) {
    harmonyMsgs.push(`obj-msg-harmony${v}Interval-${i}`)
  }
  for (const d of ['off', 'above', 'below']) {
    harmonyMsgs.push(`obj-msg-harmony${v}Direction-${d}`)
  }
}

const REMOVED_IDS = new Set([
  ...harmonyMsgs,
  // v0.1 chord-only visibility toggle (Phase 4 rebuilds for 3-mode).
  'obj-sel-mode-harmony',
  'obj-msg-voices-hidden-0',
  'obj-msg-voices-hidden-1',
  // "VOICES" group label.
  'obj-grplbl-voices',
])

data.patcher.boxes = data.patcher.boxes.filter(
  (b) => !REMOVED_IDS.has(b.box?.id),
)
data.patcher.lines = data.patcher.lines.filter((l) => {
  const s = l.patchline?.source?.[0]
  const d = l.patchline?.destination?.[0]
  return !REMOVED_IDS.has(s) && !REMOVED_IDS.has(d)
})

// ──────────────────────────────────────────────────────────────────────
// 2. Mode enum: ['scale', 'chord'] → ['scale', 'chord', 'arp'].
//    sel demuxer extends to 'sel 0 1 2'.
// ──────────────────────────────────────────────────────────────────────

const modeBox = data.patcher.boxes.find((b) => b.box.id === 'obj-w-mode')
modeBox.box.saved_attribute_attributes.valueof.parameter_enum =
  ['scale', 'chord', 'arp']

const selModeBox = data.patcher.boxes.find((b) => b.box.id === 'obj-sel-mode')
selModeBox.box.text = 'sel 0 1 2'
selModeBox.box.numoutlets = 4 // 3 valued + 1 fallthrough
selModeBox.box.outlettype = ['bang', 'bang', 'bang', '']

// ──────────────────────────────────────────────────────────────────────
// 3. Scale enum: append 'phrygian-dominant' (16 total). sel extends to
//    'sel 0 1 ... 15'.
// ──────────────────────────────────────────────────────────────────────

const scaleBox = data.patcher.boxes.find((b) => b.box.id === 'obj-w-scale')
const scaleEnums = scaleBox.box.saved_attribute_attributes.valueof.parameter_enum
if (!scaleEnums.includes('phrygian-dominant')) {
  scaleBox.box.saved_attribute_attributes.valueof.parameter_enum =
    [...scaleEnums, 'phrygian-dominant']
}

const selScaleBox = data.patcher.boxes.find((b) => b.box.id === 'obj-sel-scale')
selScaleBox.box.text = 'sel 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15'
selScaleBox.box.numoutlets = 17 // 16 valued + 1 fallthrough
selScaleBox.box.outlettype = [
  ...Array(16).fill('bang'),
  '',
]

// ──────────────────────────────────────────────────────────────────────
// Helper: ensure-box / ensure-line (idempotent).
// ──────────────────────────────────────────────────────────────────────

function ensureBox(id, factory) {
  if (data.patcher.boxes.some((b) => b.box?.id === id)) return
  data.patcher.boxes.push(factory())
}
function hasLine(src, dst) {
  return data.patcher.lines.some((l) =>
    l.patchline?.source?.[0] === src[0] &&
    (src[1] === undefined || l.patchline?.source?.[1] === src[1]) &&
    l.patchline?.destination?.[0] === dst[0] &&
    (dst[1] === undefined || l.patchline?.destination?.[1] === dst[1]),
  )
}
function ensureLine(src, dst) {
  if (hasLine(src, dst)) return
  data.patcher.lines.push({ patchline: { source: src, destination: dst } })
}

// ──────────────────────────────────────────────────────────────────────
// 4. New cascade msg boxes for mode + scale extensions.
// ──────────────────────────────────────────────────────────────────────

ensureBox('obj-msg-mode-arp', () => ({
  box: {
    id: 'obj-msg-mode-arp',
    maxclass: 'message',
    text: 'setParam mode arp',
    numinlets: 2,
    numoutlets: 1,
    outlettype: [''],
    patching_rect: [1180, 630, 200, 22],
  },
}))
ensureLine(['obj-sel-mode', 2], ['obj-msg-mode-arp', 0])
ensureLine(['obj-msg-mode-arp', 0], ['obj-nodescript', 0])

ensureBox('obj-msg-scale-phrygian-dominant', () => ({
  box: {
    id: 'obj-msg-scale-phrygian-dominant',
    maxclass: 'message',
    text: 'setParam scale phrygian-dominant',
    numinlets: 2,
    numoutlets: 1,
    outlettype: [''],
    patching_rect: [1180, 540, 240, 22],
  },
}))
ensureLine(['obj-sel-scale', 15], ['obj-msg-scale-phrygian-dominant', 0])
ensureLine(['obj-msg-scale-phrygian-dominant', 0], ['obj-nodescript', 0])

// ──────────────────────────────────────────────────────────────────────
// 5. chordShape + 8 arp live.* widgets.
//
// Wire pattern (all widgets): widget outlet 0 → [prepend setParam <key>]
// → obj-nodescript. obj-trig-ready outlet 0 → widget inlet 0 (initial
// bang). For enum widgets (parameter_type=2), outlet 0 emits the int
// index; the bridge resolves int → enum string via the resolveX helpers
// in m4l/host/bridge.ts (ADR 004 Phase 3-A).
//
// All new widgets are placed off-presentation (no presentation rect /
// presentation=0) — Phase 4 redesigns the visible strip. Patching rects
// stack in a column below the existing widgets so manual patcher edits
// can find them.
// ──────────────────────────────────────────────────────────────────────

const CHORD_SHAPES = [
  'maj', 'm', 'dim', 'aug', 'sus2', 'sus4', 'power',
  'maj7', 'm7', '7', 'm7b5', 'dim7', '6', 'm6',
  'add9', 'maj9', 'm9', '9', '13', 'octave',
]
const ARP_PATTERNS = ['up', 'down', 'up-down', 'random', 'as-played', 'strike']
const ARP_RATES = [
  '1/4', '1/4D', '1/4T',
  '1/8', '1/8D', '1/8T',
  '1/16', '1/16D', '1/16T',
  '1/32',
]

let nextY = 740 // stack widgets vertically below transport-poll chain
function widgetRect(width = 200) { const y = nextY; nextY += 30; return [40, y, width, 22] }
function prepRect()              { const y = nextY - 30; return [260, y, 220, 22] }

function makeMenu(id, longname, shortname, enums, initialIdx = 0) {
  return {
    box: {
      id,
      maxclass: 'live.menu',
      numinlets: 1,
      numoutlets: 3,
      outlettype: ['', '', 'float'],
      parameter_enable: 1,
      patching_rect: widgetRect(200),
      saved_attribute_attributes: {
        valueof: {
          parameter_enum: enums,
          parameter_initial: [initialIdx],
          parameter_initial_enable: 1,
          parameter_longname: longname,
          parameter_shortname: shortname,
          parameter_type: 2,
        },
      },
    },
  }
}
function makeNumbox(id, longname, shortname, mmin, mmax, initial) {
  // parameter_type=1 (int). live.numbox supports int via parameter_type.
  // Bridge expects ints for arpOctaves / arpStepRepeats (validated 1..N).
  return {
    box: {
      id,
      maxclass: 'live.numbox',
      numinlets: 1,
      numoutlets: 2,
      outlettype: ['', 'float'],
      parameter_enable: 1,
      patching_rect: widgetRect(60),
      saved_attribute_attributes: {
        valueof: {
          parameter_initial: [initial],
          parameter_initial_enable: 1,
          parameter_longname: longname,
          parameter_mmax: mmax,
          parameter_mmin: mmin,
          parameter_shortname: shortname,
          parameter_type: 1,
        },
      },
    },
  }
}
function makeDial(id, longname, shortname, mmin, mmax, initial) {
  // parameter_type=0 (float). Range bound at construct; bridge clamps
  // again (defense-in-depth).
  return {
    box: {
      id,
      maxclass: 'live.dial',
      numinlets: 1,
      numoutlets: 2,
      outlettype: ['', 'float'],
      parameter_enable: 1,
      patching_rect: widgetRect(40),
      saved_attribute_attributes: {
        valueof: {
          parameter_initial: [initial],
          parameter_initial_enable: 1,
          parameter_longname: longname,
          parameter_mmax: mmax,
          parameter_mmin: mmin,
          parameter_shortname: shortname,
          parameter_type: 0,
          parameter_unitstyle: 1,
        },
      },
    },
  }
}
function makeToggle(id, longname, shortname, initial) {
  // live.toggle is semantically a 0/1 int. Set mmin/mmax explicitly so
  // the patcher conformance test (LIVE_PARAMS spec) can read them; Live
  // would otherwise omit these attrs from the saved valueof and the
  // generic-widget spec check fails on undefined === 0.
  return {
    box: {
      id,
      maxclass: 'live.toggle',
      numinlets: 1,
      numoutlets: 2,
      outlettype: ['', ''],
      parameter_enable: 1,
      patching_rect: widgetRect(20),
      saved_attribute_attributes: {
        valueof: {
          parameter_initial: [initial],
          parameter_initial_enable: 1,
          parameter_longname: longname,
          parameter_mmax: 1,
          parameter_mmin: 0,
          parameter_shortname: shortname,
          parameter_type: 1,
        },
      },
    },
  }
}
function makePrepend(id, key) {
  return {
    box: {
      id,
      maxclass: 'newobj',
      text: `prepend setParam ${key}`,
      numinlets: 1,
      numoutlets: 1,
      outlettype: [''],
      patching_rect: prepRect(),
    },
  }
}

const NEW_WIDGETS = [
  // chordShape (live.menu, 20 string enums, default "maj" = index 0)
  ['obj-w-chordShape', 'menu',
    () => makeMenu('obj-w-chordShape',
      'PointsmanChordShape', 'ChrdShp', CHORD_SHAPES, 0),
    'chordShape'],
  // arpPattern (live.menu, 6 enums, default "up" = 0)
  ['obj-w-arpPattern', 'menu',
    () => makeMenu('obj-w-arpPattern',
      'PointsmanArpPattern', 'ArpPat', ARP_PATTERNS, 0),
    'arpPattern'],
  // arpRate (live.menu, 10 enums, default "1/16" = index 6)
  ['obj-w-arpRate', 'menu',
    () => makeMenu('obj-w-arpRate',
      'PointsmanArpRate', 'ArpRate', ARP_RATES, 6),
    'arpRate'],
  // arpOctaves (live.numbox int 1..4, default 1)
  ['obj-w-arpOctaves', 'numbox',
    () => makeNumbox('obj-w-arpOctaves',
      'PointsmanArpOctaves', 'ArpOct', 1, 4, 1),
    'arpOctaves'],
  // arpStepRepeats (live.numbox int 1..8, default 1)
  ['obj-w-arpStepRepeats', 'numbox',
    () => makeNumbox('obj-w-arpStepRepeats',
      'PointsmanArpStepRepeats', 'ArpRep', 1, 8, 1),
    'arpStepRepeats'],
  // arpGate (live.dial float 0..1, default 0.5)
  ['obj-w-arpGate', 'dial',
    () => makeDial('obj-w-arpGate',
      'PointsmanArpGate', 'ArpGate', 0.0, 1.0, 0.5),
    'arpGate'],
  // arpVariation (live.dial float 0..1, default 0.0)
  ['obj-w-arpVariation', 'dial',
    () => makeDial('obj-w-arpVariation',
      'PointsmanArpVariation', 'ArpVar', 0.0, 1.0, 0.0),
    'arpVariation'],
  // arpLatch (live.toggle bool, default 0 = off)
  ['obj-w-arpLatch', 'toggle',
    () => makeToggle('obj-w-arpLatch',
      'PointsmanArpLatch', 'ArpLatch', 0),
    'arpLatch'],
  // arpSwing (live.dial float 0..0.75, default 0.0)
  ['obj-w-arpSwing', 'dial',
    () => makeDial('obj-w-arpSwing',
      'PointsmanArpSwing', 'ArpSw', 0.0, 0.75, 0.0),
    'arpSwing'],
]

for (const [widgetId, _kind, factory, key] of NEW_WIDGETS) {
  ensureBox(widgetId, factory)
  const prepId = `obj-prep-${key}`
  ensureBox(prepId, () => makePrepend(prepId, key))
  ensureLine([widgetId, 0], [prepId, 0])
  ensureLine([prepId, 0], ['obj-nodescript', 0])
  ensureLine(['obj-trig-ready', 0], [widgetId, 0])
}

// Idempotent in-place repair: a prior run of this script created the
// live.toggle without parameter_mmin / parameter_mmax. ensureBox is a
// no-op once the widget exists, so backfill the attrs here so re-runs
// converge on the correct shape.
const latchBox = data.patcher.boxes.find((b) => b.box.id === 'obj-w-arpLatch')
if (latchBox) {
  const v = latchBox.box.saved_attribute_attributes.valueof
  if (v.parameter_mmin === undefined) v.parameter_mmin = 0
  if (v.parameter_mmax === undefined) v.parameter_mmax = 1
}

// ──────────────────────────────────────────────────────────────────────

writeFileSync(MAXPAT_PATH, JSON.stringify(data, null, 4) + '\n')

console.log('ADR 004 Phase 3-C surgery complete (idempotent re-run).')
console.log(`  boxes:  ${beforeBoxCount} → ${data.patcher.boxes.length}`)
console.log(`  lines:  ${beforeLineCount} → ${data.patcher.lines.length}`)
