// Consistency + guard tests for Pointsman.maxpat. Encodes the patcher
// checklist + guard tests inherited from the bootstrap clone (ADR 003 /
// 004 over there). Hand-written .maxpat JSON is easy to drift; this
// suite catches the cases Live's own loader would surface as silent
// no-wires or "Node script not ready".
//
// What's covered:
//   Guard tests (apply to the patcher):
//     - abs-path scrub (no /Users/, /home/, drive letters)
//     - external-file resolution (every `filename` field is a real
//       sibling file under m4l/)
//     - structural sanity (parses, has patcher.boxes / patcher.lines)
//     - patchline endpoints resolve to known box ids
//   Pointsman patcher checklist:
//     - devicewidth = 1000, openinpresentation = 1
//     - SCALE / I/O, KEYBOARD, HUMAN group legends present
//     - [jsui] referencing scaleKeyboard.jsui.js (flat path, m4l/ root)
//     - [node.script pointsman.mjs ...] present (flat path, m4l/ root)
//     - midiin / midiparse / noteout MIDI I/O
//     - live.* widgets per the Pointsman parameter surface (numeric +
//       string-enum + int-enum) including ranges, defaults, dispatch
//       wires to node.script
//     - chordChanged / scaleChanged / notePulse outlets reach the jsui
//     - jsui setRoot outlet routes through [route setRoot] into qt.root
//     - node.script "ready" outlet bangs each live.* for value bootstrap
//
// NOTE on widget naming: the patcher carries `StencilQt*` parameter
// longnames inherited from the bootstrap clone. Renaming them to
// `Pointsman*` is a patcher-side surgery deferred to a follow-up
// (out of ADR 001 §7 scope, which only simplifies the bake pipeline).
// The longname strings below match what's on disk, not what the device
// will eventually carry.
//
// Out-of-scope (manual): visual quality, host-loading behavior in Live,
// font / palette correctness, audio output. These are pre-release manual
// checks per CLAUDE.md "GUI / UI components".

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const M4L_ROOT = resolve(__dirname, '..')

const POINTSMAN_MAXPAT = resolve(M4L_ROOT, 'Pointsman.maxpat')

// ---- helpers ------------------------------------------------------------

function loadPatcher(path) {
  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw)
  return { raw, parsed, boxes: parsed.patcher?.boxes ?? [], lines: parsed.patcher?.lines ?? [] }
}

function boxesByMaxclass(boxes, cls) {
  return boxes.filter((b) => b.box?.maxclass === cls)
}

function findLiveWidget(boxes, longname) {
  // Every widget is identified by its parameter_longname (the symbol
  // Live shows in the parameter list). Searching by longname is more
  // stable than by box id since ids are arbitrary while the longname
  // is a public API.
  return boxes.find(
    (b) =>
      b.box?.saved_attribute_attributes?.valueof?.parameter_longname === longname,
  )
}

function widgetParamAttrs(box) {
  return box.box.saved_attribute_attributes.valueof
}

function findPrependBox(boxes, prefix) {
  // `[newobj] prepend <prefix>` — patcher-side message factory. We search
  // by exact `text` so a typo (`setParams` vs `setParam`) shows up as a
  // missing-prepend rather than a silent no-op in Live.
  return boxes.find(
    (b) => b.box?.maxclass === 'newobj' && b.box?.text === `prepend ${prefix}`,
  )
}

function followsLineFromTo(lines, srcId, dstId) {
  // Direct edge srcId -> dstId on any inlet/outlet. Order-tolerant: we
  // care that the wire exists, not which port number is used (port nums
  // would be redundant with the box's own outlettype declaration).
  return lines.some(
    (l) =>
      l.patchline?.source?.[0] === srcId && l.patchline?.destination?.[0] === dstId,
  )
}

// Reachability with bounded depth — for "live.numbox -> ... -> node.script"
// where intermediate nodes (prepend, sel, route) aren't important. Uses
// BFS; depth cap prevents pathological cycles from looping forever.
function reachable(lines, srcId, dstId, maxDepth = 6) {
  if (srcId === dstId) return true
  const visited = new Set([srcId])
  let frontier = [srcId]
  for (let d = 0; d < maxDepth; d++) {
    const next = []
    for (const id of frontier) {
      for (const l of lines) {
        if (l.patchline?.source?.[0] !== id) continue
        const to = l.patchline?.destination?.[0]
        if (!to) continue
        if (to === dstId) return true
        if (!visited.has(to)) {
          visited.add(to)
          next.push(to)
        }
      }
    }
    frontier = next
  }
  return false
}

// ---- Pointsman live.* parameter surface ---------------------------------

// Source of truth: the bridge dispatch in m4l/host/bridge.ts setParam +
// the parameter table in docs/ai/concept.md §Parameter surface. Bridge
// keys mirror the Pointsman params field names exactly.
//
// Ranges / defaults encoded here:
// - `outputLevel` (0..1 float, default 1.0).
// - `controlChannel` (1..16) for `triggerMode = root` and chord context.
// - Four humanize axes (Vel/Gate/Time/Drift), all 0..1 floats.
// - `mode` is a 3-enum (scale | chord | harmony).
const LIVE_PARAMS = [
  // longname,                   shortname, bridgeKey,           type, mmin, mmax, initial
  // Humanize shortnames are bare (VEL/GATE/TIME/DRIFT) — these are
  // rendered by live.dial as the knob's built-in label, so a separate
  // comment label is unnecessary.
  ['StencilQtHumanizeVelocity',  'VEL',     'humanizeVelocity',  0, 0,    1,          0],
  ['StencilQtHumanizeGate',      'GATE',    'humanizeGate',      0, 0,    1,          0],
  ['StencilQtHumanizeTiming',    'TIME',    'humanizeTiming',    0, 0,    1,          0],
  ['StencilQtHumanizeDrift',     'DRIFT',   'humanizeDrift',     0, 0,    1,          0],
  ['StencilQtOutputLevel',       'LVL',     'outputLevel',       0, 0,    1,          1.0],
  ['StencilQtInputChannel',      'InCh',    'inputChannel',      1, 0,    16,         0],
  ['StencilQtControlChannel',    'CtlCh',   'controlChannel',    1, 1,    16,         16],
  ['StencilQtSeed',              'Seed',    'seed',              1, 0,    2147483647, 42],
]

// String enums mirror m4l/host/bridge.ts SCALE_NAMES / TRIGGER_MODES /
// MODES exactly. Drift in either list is what this test catches.
const LIVE_ENUMS = [
  // longname,              shortname, bridgeKey,     enumStrings, initialIdx
  ['StencilQtScale',        'Scl',     'scale',
    ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian',
     'locrian', 'pentatonic', 'minor-pentatonic', 'blues', 'harmonic',
     'melodic', 'whole', 'chromatic', 'chromatic-half'], 0],
  ['StencilQtTriggerMode',  'Trig',    'triggerMode', ['passthrough', 'root'], 0],
  // mode: 3-enum (scale | chord | harmony). Bridge dispatches per-value
  // setParam messages through the standard [sel]+[message] fanout.
  // controlChannel held notes form the chord context in chord mode.
  ['StencilQtMode',         'Mode',    'mode',        ['scale', 'chord', 'harmony'], 0],
  // Harmony voice cluster (3 rows × 2 menus): per voice slot, an
  // Interval menu and a Direction menu. Direction enum adds "off" as
  // the per-slot disabled state. Bridge maps interval string → int 3..6
  // and validates direction; slots set to "off" are filtered out of
  // the projected harmonyVoices list.
  ['StencilQtHarmonyV1Interval',  'V1Iv', 'harmonyV1Interval',
    ['3rd', '4th', '5th', '6th'], 0],
  ['StencilQtHarmonyV1Direction', 'V1Dr', 'harmonyV1Direction',
    ['off', 'above', 'below'], 0],
  ['StencilQtHarmonyV2Interval',  'V2Iv', 'harmonyV2Interval',
    ['3rd', '4th', '5th', '6th'], 0],
  ['StencilQtHarmonyV2Direction', 'V2Dr', 'harmonyV2Direction',
    ['off', 'above', 'below'], 0],
  ['StencilQtHarmonyV3Interval',  'V3Iv', 'harmonyV3Interval',
    ['3rd', '4th', '5th', '6th'], 0],
  ['StencilQtHarmonyV3Direction', 'V3Dr', 'harmonyV3Direction',
    ['off', 'above', 'below'], 0],
]
// Int-enum widgets: live.menu showing labels but emitting the int
// index 0..N-1 directly. Bridge accepts the int (no [sel] -> [message]
// fanout). `root` is note-name display (C..B); bridge `setParam root`
// takes the int.
const LIVE_INT_ENUMS = [
  // longname,        shortname, bridgeKey, enumValues, initialIdx
  ['StencilQtRoot',   'Root',    'root',
    ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], 0],
]

// ---- guard tests --------------------------------------------------------

test('Pointsman.maxpat exists', () => {
  // Hard-fail loudly if the patcher is missing — every other test below
  // reads this file and the chained errors would be confusing.
  assert.ok(existsSync(POINTSMAN_MAXPAT), `${POINTSMAN_MAXPAT} not found`)
})

test('Pointsman.maxpat — parses as JSON', () => {
  // Hand-written JSON is easy to break with a stray comma. Catch
  // the parse failure here rather than at bake time (where the
  // error message is less precise about line/column).
  assert.doesNotThrow(() => loadPatcher(POINTSMAN_MAXPAT))
})

test('Pointsman.maxpat — patcher.boxes and patcher.lines are arrays', () => {
  const { boxes, lines } = loadPatcher(POINTSMAN_MAXPAT)
  assert.ok(Array.isArray(boxes), 'boxes')
  assert.ok(Array.isArray(lines), 'lines')
})

test('Pointsman.maxpat — abs-path scrub (no /Users/, /home/, drive letter)', () => {
  // A leaked absolute path would make the .amxd loadable on the build
  // machine only — the export reviewer would never spot it.
  const { raw } = loadPatcher(POINTSMAN_MAXPAT)
  const FORBIDDEN = [/\/Users\//, /\/home\//, /[A-Za-z]:\\/]
  for (const re of FORBIDDEN) {
    assert.ok(!re.test(raw), `forbidden absolute path matched ${re}`)
  }
})

test('Pointsman.maxpat — every box.filename resolves as a sibling file', () => {
  // Both [jsui] and [node.script @file ...] (when written that way)
  // pull a filename, plus any future bpatcher. Walk every box; for
  // each `filename` (jsui, node.script with @file, ...) or `name`
  // (bpatcher) attribute, assert the file exists relative to m4l/.
  // Catches typos (jsui.js vs .jsui.js) and missed renames after a
  // directory move.
  const { boxes } = loadPatcher(POINTSMAN_MAXPAT)
  for (const b of boxes) {
    const fn = b.box?.filename ?? (b.box?.maxclass === 'bpatcher' ? b.box?.name : undefined)
    if (typeof fn !== 'string') continue
    const resolved = resolve(M4L_ROOT, fn)
    assert.ok(
      existsSync(resolved),
      `referenced file does not exist: ${fn} (resolved to ${resolved})`,
    )
  }
})

test('Pointsman.maxpat — every patchline source/destination id resolves to a known box', () => {
  // A typo in a patchline endpoint silently drops the wire in Live.
  // Catch it here.
  const { boxes, lines } = loadPatcher(POINTSMAN_MAXPAT)
  const ids = new Set(boxes.map((b) => b.box?.id).filter(Boolean))
  for (const l of lines) {
    const src = l.patchline?.source?.[0]
    const dst = l.patchline?.destination?.[0]
    assert.ok(ids.has(src), `unknown patchline source id: ${src}`)
    assert.ok(ids.has(dst), `unknown patchline destination id: ${dst}`)
  }
})

// ---- patcher checklist --------------------------------------------------

test('Pointsman.maxpat — devicewidth = 1000 and openinpresentation = 1', () => {
  const { parsed } = loadPatcher(POINTSMAN_MAXPAT)
  assert.equal(parsed.patcher.devicewidth, 1000)
  assert.equal(parsed.patcher.openinpresentation, 1)
})

test('Pointsman.maxpat — no in-strip device-name banner and no "im9" byline', () => {
  // Live's device-strip header already labels the device and shows the
  // author in its own metadata; duplicating that inside the presentation
  // strip adds clutter at small sizes.
  const { boxes } = loadPatcher(POINTSMAN_MAXPAT)
  const comments = boxesByMaxclass(boxes, 'comment').map((b) => b.box.text)
  assert.ok(!comments.some((t) => /STENCIL\s*QT/.test(t)), 'no STENCIL QT banner')
  assert.ok(!comments.some((t) => /POINTSMAN/i.test(t)), 'no POINTSMAN banner')
  assert.ok(!comments.some((t) => /\bim9\b/.test(t)), 'no im9 byline')
})

test('Pointsman.maxpat — has SCALE / I\\/O, KEYBOARD, HUMAN group legends', () => {
  // Three-column layout legends. The first legend literally contains
  // a slash (`SCALE / I/O`).
  const { boxes } = loadPatcher(POINTSMAN_MAXPAT)
  const comments = boxesByMaxclass(boxes, 'comment').map((b) => b.box.text)
  assert.ok(
    comments.some((t) => /^SCALE\s*\/\s*I\/O$/.test(t)),
    'SCALE / I/O legend',
  )
  assert.ok(comments.some((t) => /^KEYBOARD$/.test(t)), 'KEYBOARD legend')
  assert.ok(comments.some((t) => /^HUMAN$/.test(t)), 'HUMAN legend')
})

test('Pointsman.maxpat — [jsui] references scaleKeyboard.jsui.js (flat path, m4l/ root)', () => {
  // [jsui] filename MUST be a flat sibling at m4l/ root. Subdirectory
  // paths render as a generic gray placeholder in Live.
  const { boxes } = loadPatcher(POINTSMAN_MAXPAT)
  const jsuis = boxesByMaxclass(boxes, 'jsui')
  assert.ok(
    jsuis.some((b) => b.box.filename === 'scaleKeyboard.jsui.js'),
    'expected jsui referencing scaleKeyboard.jsui.js (flat path)',
  )
})

test('Pointsman.maxpat — [node.script] references pointsman.mjs (flat path)', () => {
  // Same flat-root rule as [jsui]. `.mjs` is load-bearing — `.mjs` is
  // unconditionally ESM; `.js` would default to CJS in [node.script]'s
  // tempdir and fail to parse the import.
  const { boxes } = loadPatcher(POINTSMAN_MAXPAT)
  const newobjs = boxesByMaxclass(boxes, 'newobj')
  assert.ok(
    newobjs.some((b) => /^node\.script\s+pointsman\.mjs\b/.test(b.box.text)),
    'expected node.script referencing pointsman.mjs',
  )
})

test('Pointsman.maxpat — has midiin / midiparse / noteout for MIDI I/O', () => {
  // midiin -> noteIn/noteOff path, Max.outlet "note" -> noteout.
  const { boxes } = loadPatcher(POINTSMAN_MAXPAT)
  const newobjs = boxesByMaxclass(boxes, 'newobj').map((b) => b.box.text)
  assert.ok(newobjs.some((t) => /^midiin\b/.test(t)), 'midiin')
  assert.ok(newobjs.some((t) => /^midiparse\b/.test(t)), 'midiparse')
  assert.ok(newobjs.some((t) => /^(noteout|midiout)\b/.test(t)), 'noteout/midiout')
})

for (const [longname, shortname, bridgeKey, type, mmin, mmax, initial] of LIVE_PARAMS) {
  test(`Pointsman.maxpat — live.* widget ${longname} matches spec`, () => {
    const { boxes } = loadPatcher(POINTSMAN_MAXPAT)
    const w = findLiveWidget(boxes, longname)
    assert.ok(w, `widget ${longname} missing`)
    const attrs = widgetParamAttrs(w)
    assert.equal(attrs.parameter_shortname, shortname, 'shortname')
    assert.equal(attrs.parameter_type, type, 'parameter_type')
    assert.equal(attrs.parameter_mmin, mmin, 'mmin')
    assert.equal(attrs.parameter_mmax, mmax, 'mmax')
    assert.equal(attrs.parameter_initial[0], initial, 'initial')
  })

  test(`Pointsman.maxpat — ${longname} change fires setParam ${bridgeKey} to node.script`, () => {
    const { boxes, lines } = loadPatcher(POINTSMAN_MAXPAT)
    const w = findLiveWidget(boxes, longname)
    const prep = findPrependBox(boxes, `setParam ${bridgeKey}`)
    assert.ok(prep, `missing [prepend setParam ${bridgeKey}]`)
    assert.ok(
      followsLineFromTo(lines, w.box.id, prep.box.id),
      `${w.box.id} -> ${prep.box.id} wire missing`,
    )
    const nodescript = boxesByMaxclass(boxes, 'newobj').find((b) =>
      /^node\.script\s+pointsman\.mjs\b/.test(b.box.text),
    )
    assert.ok(
      followsLineFromTo(lines, prep.box.id, nodescript.box.id),
      `${prep.box.id} -> node.script wire missing`,
    )
  })
}

for (const [longname, shortname, bridgeKey, enumValues, initialIdx] of LIVE_ENUMS) {
  test(`Pointsman.maxpat — enum widget ${longname} matches spec`, () => {
    const { boxes } = loadPatcher(POINTSMAN_MAXPAT)
    const w = findLiveWidget(boxes, longname)
    assert.ok(w, `widget ${longname} missing`)
    const attrs = widgetParamAttrs(w)
    assert.equal(attrs.parameter_shortname, shortname, 'shortname')
    assert.equal(attrs.parameter_type, 2, 'parameter_type=2 (enum)')
    assert.deepEqual(attrs.parameter_enum, enumValues, 'enum values')
    assert.equal(attrs.parameter_initial[0], initialIdx, 'initial index')
  })

  test(`Pointsman.maxpat — ${longname} dispatches one [message setParam ${bridgeKey} <enum>] per value`, () => {
    // Single-value enums still get one message; the wiring is in place
    // even when the bridge no-ops the dispatch.
    const { boxes } = loadPatcher(POINTSMAN_MAXPAT)
    const messages = boxesByMaxclass(boxes, 'message').map((b) => b.box.text)
    for (const v of enumValues) {
      const expected = `setParam ${bridgeKey} ${v}`
      assert.ok(
        messages.includes(expected),
        `missing message: "${expected}"`,
      )
    }
  })
}

for (const [longname, shortname, bridgeKey, enumValues, initialIdx] of LIVE_INT_ENUMS) {
  test(`Pointsman.maxpat — int-enum widget ${longname} matches spec`, () => {
    // live.menu with parameter_type=2 + parameter_enum, but emits the
    // INT INDEX (not the enum string). Bridge accepts the int directly
    // for `root`.
    const { boxes } = loadPatcher(POINTSMAN_MAXPAT)
    const w = findLiveWidget(boxes, longname)
    assert.ok(w, `widget ${longname} missing`)
    assert.equal(w.box.maxclass, 'live.menu', 'maxclass should be live.menu')
    const attrs = widgetParamAttrs(w)
    assert.equal(attrs.parameter_shortname, shortname, 'shortname')
    assert.equal(attrs.parameter_type, 2, 'parameter_type=2 (enum)')
    assert.deepEqual(attrs.parameter_enum, enumValues, 'enum values')
    assert.equal(attrs.parameter_initial[0], initialIdx, 'initial index')
  })

  test(`Pointsman.maxpat — ${longname} change fires setParam ${bridgeKey} (int) to node.script`, () => {
    // Wiring: [live.menu] -> [prepend setParam <key>] -> [node.script].
    // Same as numeric-param wiring (no [sel]+[message] fanout, because
    // the bridge takes int payload).
    const { boxes, lines } = loadPatcher(POINTSMAN_MAXPAT)
    const w = findLiveWidget(boxes, longname)
    const prep = findPrependBox(boxes, `setParam ${bridgeKey}`)
    assert.ok(prep, `missing [prepend setParam ${bridgeKey}]`)
    assert.ok(
      followsLineFromTo(lines, w.box.id, prep.box.id),
      `${w.box.id} -> ${prep.box.id} wire missing`,
    )
    const nodescript = boxesByMaxclass(boxes, 'newobj').find((b) =>
      /^node\.script\s+pointsman\.mjs\b/.test(b.box.text),
    )
    assert.ok(
      followsLineFromTo(lines, prep.box.id, nodescript.box.id),
      `${prep.box.id} -> node.script wire missing`,
    )
  })
}

test('Pointsman.maxpat — all live.* parameters present per LIVE_PARAMS + LIVE_ENUMS + LIVE_INT_ENUMS', () => {
  const { boxes } = loadPatcher(POINTSMAN_MAXPAT)
  const liveWidgets = boxes.filter((b) => {
    const cls = b.box?.maxclass
    return (cls === 'live.numbox' || cls === 'live.dial' || cls === 'live.slider' || cls === 'live.menu')
      && b.box?.saved_attribute_attributes?.valueof?.parameter_longname?.startsWith('StencilQt')
  })
  const expected = LIVE_PARAMS.length + LIVE_ENUMS.length + LIVE_INT_ENUMS.length
  assert.equal(liveWidgets.length, expected, `expected ${expected} live.* widgets`)
})

test('Pointsman.maxpat — chordChanged outlet routes from node.script to jsui', () => {
  // Bridge emits Max.outlet('chordChanged', ...pcs) when controlChannel-held
  // notes mutate the chord context. The patcher must split that off the
  // [route ... chordChanged ...] outlet and forward to [jsui], so the
  // renderer can highlight held PCs as a third tier between in-scale dot
  // and pulse glow.
  const { boxes, lines } = loadPatcher(POINTSMAN_MAXPAT)
  const route = boxesByMaxclass(boxes, 'newobj').find((b) =>
    /^route\b.*\bchordChanged\b/.test(b.box.text),
  )
  assert.ok(route, 'expected [route ... chordChanged ...] consuming node.script outlet')
  const tokens = route.box.text.split(/\s+/).slice(1)
  const ccIdx = tokens.indexOf('chordChanged')
  assert.ok(ccIdx >= 0, 'route must include "chordChanged" token')
  const jsui = boxesByMaxclass(boxes, 'jsui').find(
    (b) => b.box.filename === 'scaleKeyboard.jsui.js',
  )
  assert.ok(jsui, 'jsui scaleKeyboard.jsui.js missing')
  const ccConsumers = lines
    .filter(
      (l) =>
        l.patchline?.source?.[0] === route.box.id &&
        l.patchline?.source?.[1] === ccIdx,
    )
    .map((l) => l.patchline.destination[0])
  assert.ok(
    ccConsumers.length >= 1,
    `[route ${tokens.join(' ')}] outlet ${ccIdx} (chordChanged) has no consumer`,
  )
  const reaches = ccConsumers.some((id) => reachable(lines, id, jsui.box.id))
  assert.ok(reaches, 'chordChanged -> ... -> jsui chain missing')
})

test('Pointsman.maxpat — scaleChanged / notePulse outlets route from node.script to jsui', () => {
  // Bridge emits Max.outlet("scaleChanged", scale, root) on scale or
  // root change, and Max.outlet("notePulse", pitch, velocity) per
  // quantized noteOn. Routing chain: [node.script] -> [route note
  // ready scaleChanged notePulse] -> [prepend scaleChanged] /
  // [prepend notePulse] -> [jsui scaleKeyboard.jsui.js]. Reachability
  // check rather than exact intermediate nodes.
  const { boxes, lines } = loadPatcher(POINTSMAN_MAXPAT)
  const nodescript = boxesByMaxclass(boxes, 'newobj').find((b) =>
    /^node\.script\s+pointsman\.mjs\b/.test(b.box.text),
  )
  const jsui = boxesByMaxclass(boxes, 'jsui').find(
    (b) => b.box.filename === 'scaleKeyboard.jsui.js',
  )
  assert.ok(nodescript, 'node.script pointsman.mjs missing')
  assert.ok(jsui, 'jsui scaleKeyboard.jsui.js missing')
  assert.ok(
    reachable(lines, nodescript.box.id, jsui.box.id),
    'node.script -> ... -> jsui chain missing',
  )
})

test('Pointsman.maxpat — jsui setRoot outlet routes through [route setRoot] into root live.menu', () => {
  // Clicking a key on the jsui keyboard must update root via the
  // live.menu (so Live's parameter state stays the single source of
  // truth and the existing setParam root chain re-emits scaleChanged
  // for the keyboard's own dot pattern). Wiring:
  //   [jsui scaleKeyboard.jsui.js] outlet 0
  //     -> [route setRoot]
  //     -> [live.menu parameter_longname StencilQtRoot] inlet 0
  // The route box strips the "setRoot" symbol so the bare int reaches
  // the live.menu (which sets its parameter to that index).
  const { boxes, lines } = loadPatcher(POINTSMAN_MAXPAT)
  const jsui = boxesByMaxclass(boxes, 'jsui').find(
    (b) => b.box.filename === 'scaleKeyboard.jsui.js',
  )
  assert.ok(jsui, 'jsui scaleKeyboard.jsui.js missing')
  const route = boxesByMaxclass(boxes, 'newobj').find((b) =>
    /^route\b.*\bsetRoot\b/.test(b.box.text),
  )
  assert.ok(route, 'expected [route setRoot] consuming jsui outlet 0')
  const rootMenu = boxes.find(
    (b) =>
      b.box?.maxclass === 'live.menu' &&
      b.box?.saved_attribute_attributes?.valueof?.parameter_longname ===
        'StencilQtRoot',
  )
  assert.ok(rootMenu, 'live.menu StencilQtRoot missing')
  const jsuiToRoute = lines.some(
    (l) =>
      l.patchline?.source?.[0] === jsui.box.id &&
      l.patchline?.destination?.[0] === route.box.id,
  )
  assert.ok(jsuiToRoute, 'jsui outlet 0 -> [route setRoot] wire missing')
  const tokens = route.box.text.split(/\s+/).slice(1)
  const setRootOutletIdx = tokens.indexOf('setRoot')
  assert.ok(setRootOutletIdx >= 0, 'route must include "setRoot" token')
  const routeToMenu = lines.some(
    (l) =>
      l.patchline?.source?.[0] === route.box.id &&
      l.patchline?.source?.[1] === setRootOutletIdx &&
      l.patchline?.destination?.[0] === rootMenu.box.id,
  )
  assert.ok(routeToMenu, '[route setRoot] outlet -> root live.menu wire missing')
})

test('Pointsman.maxpat — node.script "ready" outlet bangs each live.* widget for initial value bootstrap', () => {
  // On device load the setParam messages race against [node.script]
  // startup; without a handshake they drop with "Node script not
  // ready". Fix: pointsman.mjs emits Max.outlet('ready') after all
  // addHandler calls; the patcher's [route ... ready ...] outlet bangs
  // each live.* widget so it re-emits its current value through the
  // existing prep -> nodescript chain.
  //
  // `getvalueof` mechanism does not work with live.numbox / live.slider
  // / live.menu (only live.toggle). Banging the widget directly is the
  // alternative — a bang causes the widget to emit its current value
  // through outlet 0, which the existing wiring carries.
  const { boxes, lines } = loadPatcher(POINTSMAN_MAXPAT)
  const route = boxesByMaxclass(boxes, 'newobj').find((b) =>
    /^route\b.*\bready\b/.test(b.box.text),
  )
  assert.ok(route, 'expected [route ... ready ...] consuming node.script outlet')
  const tokens = route.box.text.split(/\s+/).slice(1)
  const readyOutletIdx = tokens.indexOf('ready')
  assert.ok(readyOutletIdx >= 0, 'route must include "ready" token')
  const readyConsumers = lines
    .filter(
      (l) =>
        l.patchline?.source?.[0] === route.box.id &&
        l.patchline?.source?.[1] === readyOutletIdx,
    )
    .map((l) => l.patchline.destination[0])
  assert.ok(
    readyConsumers.length >= 1,
    `[route ${tokens.join(' ')}] outlet ${readyOutletIdx} (ready) has no consumer`,
  )
  for (const [longname] of [...LIVE_PARAMS, ...LIVE_ENUMS]) {
    const w = findLiveWidget(boxes, longname)
    const ok = readyConsumers.some((id) => reachable(lines, id, w.box.id))
    assert.ok(ok, `ready -> ${longname} (${w.box.id}) chain missing`)
  }
})
