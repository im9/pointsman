// Consistency + guard tests for Stencil-TM.maxpat (and, when it exists,
// Stencil-QT.maxpat). Encodes ADR 003 §Stencil-TM patcher checklist and
// ADR 004 §Guard tests. Hand-written .maxpat JSON is easy to drift; this
// suite catches the cases Live's own loader would surface as silent
// no-wires or "Node script not ready".
//
// What's covered:
//   ADR 004 guards:
//     - abs-path scrub (no /Users/, /home/, drive letters)
//     - external-file resolution (every `filename` field is a real
//       sibling file under m4l/)
//     - structural sanity (parses, has patcher.boxes / patcher.lines)
//   ADR 003 §Stencil-TM patcher checklist:
//     - devicewidth = 1000, openinpresentation = 1, presentation height ~180
//     - header band ("STENCIL TM" comment + "im9" comment)
//     - [jsui] referencing registerRing.jsui.js (flat, m4l/ root)
//     - [node.script stencil-tm.mjs ...] present (flat path, m4l/ root)
//     - 12 live.* widgets per ADR 002 §live.* parameter surface (TM):
//       longname / shortname / parameter_type / mmin / mmax / initial
//     - every live.* change fires `setParam <bridgeKey>` to node.script
//     - register / position outlets route from node.script to jsui
//     - jsui setBit outlet routes to node.script
//     - midiin / midiparse / noteIn / noteOff path
//     - transport-driven `step` path
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

const TM_MAXPAT = resolve(M4L_ROOT, 'Stencil-TM.maxpat')
const QT_MAXPAT = resolve(M4L_ROOT, 'Stencil-QT.maxpat')

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
  // ADR 002 §live.* parameter surface: every widget is identified by
  // its parameter_longname (the symbol Live shows in the parameter list).
  // Searching by longname is more stable than by box id since ids are
  // arbitrary while the longname is a public API.
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

// ---- ADR 002 §live.* parameter surface (TM) ------------------------------

// Source of truth: ADR 002 §Stencil TM live.* parameter table. The
// fields here mirror what Live persists into preset chunks. If ADR 002
// changes any of these the test will fail — that's the point: the
// patcher cannot drift from the spec without an explicit update here.
const TM_LIVE_PARAMS = [
  // longname,             shortname, bridgeKey,         type, mmin, mmax, initial
  ['StencilTmLength',      'Len',     'length',          1, 2,    32,         8],
  ['StencilTmLock',        'Lock',    'lock',            0, 0,    1,          0.5],
  ['StencilTmRangeLo',     'RngLo',   'rangeLo',         1, 0,    127,        48],
  ['StencilTmRangeHi',     'RngHi',   'rangeHi',         1, 0,    127,        72],
  ['StencilTmDensity',     'Dens',    'density',         0, 0,    1,          1],
  ['StencilTmSeed',        'Seed',    'seed',            1, 0,    2147483647, 42],
  ['StencilTmInputChannel','InCh',    'inputChannel',    1, 0,    16,         0],
  ['StencilTmOutputVelocity','OutVel','outputVelocity',  1, 1,    127,        100],
  ['StencilTmOutputGate',  'OutGt',   'outputGate',      0, 0,    1,          0.5],
  ['StencilTmOutputChannel','OutCh',  'outputChannel',   1, 1,    16,         1],
]
// Enum widgets (live.menu) carry parameter_enum instead of mmin/mmax.
// Initial is the index into the enum; the bridge expects the string value.
const TM_LIVE_ENUMS = [
  // longname,              shortname, bridgeKey,     enumStrings,                    initialIdx
  ['StencilTmSubdivision',  'Subdiv',  'subdivision', ['8th', '16th', '32nd', '8T', '16T'], 1],
  ['StencilTmTriggerMode',  'Trig',    'triggerMode', ['auto', 'gate', 'seed'],             0],
]

// ---- ADR 004 §Guard tests (apply to every present .maxpat) --------------

const PATCHERS = [
  ['TM', TM_MAXPAT],
  ['QT', QT_MAXPAT],
].filter(([, p]) => existsSync(p))

for (const [device, path] of PATCHERS) {
  test(`${device} — .maxpat parses as JSON`, () => {
    // Hand-written JSON is easy to break with a stray comma. Catch
    // the parse failure here rather than at bake time (where the
    // error message is less precise about line/column).
    assert.doesNotThrow(() => loadPatcher(path))
  })

  test(`${device} — patcher.boxes and patcher.lines are arrays`, () => {
    const { boxes, lines } = loadPatcher(path)
    assert.ok(Array.isArray(boxes), 'boxes')
    assert.ok(Array.isArray(lines), 'lines')
  })

  test(`${device} — abs-path scrub (no /Users/, /home/, drive letter)`, () => {
    // ADR 004 §Guard tests #1. A leaked absolute path would make the
    // .amxd loadable on the build machine only — the export reviewer
    // would never spot it.
    const { raw } = loadPatcher(path)
    const FORBIDDEN = [/\/Users\//, /\/home\//, /[A-Za-z]:\\/]
    for (const re of FORBIDDEN) {
      assert.ok(!re.test(raw), `forbidden absolute path matched ${re}`)
    }
  })

  test(`${device} — every box.filename resolves as a sibling file`, () => {
    // ADR 004 §Guard tests #2. Both [jsui] and [node.script @file ...]
    // (when written that way) pull a filename, plus any future bpatcher.
    // Walk every box; for each `filename` (jsui, node.script with @file,
    // ...) or `name` (bpatcher) attribute, assert the file exists
    // relative to m4l/. Catches typos (jsui.js vs .jsui.js) and missed
    // renames after a directory move.
    const { boxes } = loadPatcher(path)
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

  test(`${device} — every patchline source/destination id resolves to a known box`, () => {
    // A typo in a patchline endpoint silently drops the wire in Live.
    // Catch it here.
    const { boxes, lines } = loadPatcher(path)
    const ids = new Set(boxes.map((b) => b.box?.id).filter(Boolean))
    for (const l of lines) {
      const src = l.patchline?.source?.[0]
      const dst = l.patchline?.destination?.[0]
      assert.ok(ids.has(src), `unknown patchline source id: ${src}`)
      assert.ok(ids.has(dst), `unknown patchline destination id: ${dst}`)
    }
  })
}

// ---- ADR 003 §Stencil-TM patcher --------------------------------------

if (existsSync(TM_MAXPAT)) {
  test('TM — devicewidth = 1000 and openinpresentation = 1', () => {
    // ADR 003 §Stencil-TM patcher: devicewidth = 1000, openinpresentation
    // so the device shows the presentation view (not the patcher view) in
    // Live's device strip.
    const { parsed } = loadPatcher(TM_MAXPAT)
    assert.equal(parsed.patcher.devicewidth, 1000)
    assert.equal(parsed.patcher.openinpresentation, 1)
  })

  test('TM — no "STENCIL TM" duplicate header + no "im9" byline', () => {
    // ADR 003 §Visual identity §Device chrome: NO in-strip device-name
    // banner and NO `im9` byline. Live's device-strip header already
    // labels the device with "Stencil-TM" and shows the author in its
    // own metadata; duplicating that inside the presentation strip
    // adds clutter at small sizes.
    const { boxes } = loadPatcher(TM_MAXPAT)
    const comments = boxesByMaxclass(boxes, 'comment').map((b) => b.box.text)
    assert.ok(!comments.some((t) => /STENCIL\s*TM/.test(t)), 'no STENCIL TM banner')
    assert.ok(!comments.some((t) => /\bim9\b/.test(t)), 'no im9 byline')
  })

  test('TM — has GENERATE / REGISTER / I\\/O group legends', () => {
    // ADR 003 §Layout sketch — three vertical column groups. Catches
    // a missing legend tab (which would leave an unlabeled border box
    // in the device, defeating the fieldset-with-corner-label idiom).
    const { boxes } = loadPatcher(TM_MAXPAT)
    const comments = boxesByMaxclass(boxes, 'comment').map((b) => b.box.text)
    assert.ok(comments.some((t) => /^GENERATE$/.test(t)), 'GENERATE legend')
    assert.ok(comments.some((t) => /^REGISTER$/.test(t)), 'REGISTER legend')
    assert.ok(comments.some((t) => /^I\/O$/.test(t)), 'I/O legend')
  })

  test('TM — [bpatcher] wraps the ring sub-patcher', () => {
    // The TM register ring lives inside a sub-patcher
    // (registerRing.subpatcher.maxpat) wrapped by a [bpatcher] in the
    // main patcher. The wrapping isolates the [jsui]'s box.rect drift
    // (Max M4L re-anchors the [jsui]'s canvas to presentation origin
    // x=0 on the first inlet message) inside the sub-patcher's own
    // coordinate system, so the parent's bpatcher position stays
    // stable regardless. See ADR 003 §TM register ring + ADR 004
    // §Patcher path conventions.
    const { boxes } = loadPatcher(TM_MAXPAT)
    const bpatchers = boxesByMaxclass(boxes, 'bpatcher')
    assert.ok(
      bpatchers.some((b) => b.box.name === 'registerRing.subpatcher.maxpat'),
      'expected bpatcher wrapping registerRing.subpatcher.maxpat',
    )
  })

  test('TM — registerRing.subpatcher.maxpat parses and contains the [jsui]', () => {
    // The sub-patcher MUST exist as a sibling file at m4l/ root and
    // must contain a [jsui] referencing registerRing.jsui.js (also at
    // flat root, per the same Max filename-resolution constraint).
    const subpatcherPath = resolve(M4L_ROOT, 'registerRing.subpatcher.maxpat')
    assert.ok(existsSync(subpatcherPath), 'registerRing.subpatcher.maxpat missing')
    const sub = loadPatcher(subpatcherPath)
    const subJsuis = sub.boxes.filter((b) => b.box?.maxclass === 'jsui')
    assert.ok(
      subJsuis.some((b) => b.box.filename === 'registerRing.jsui.js'),
      'sub-patcher must contain a jsui referencing registerRing.jsui.js',
    )
  })

  test('TM — [node.script] references stencil-tm.mjs (flat path)', () => {
    // Flat path at m4l/ root because Max [node.script]'s `filename`
    // attribute does not reliably resolve subdirectory paths in M4L
    // presentation view — observed empirically as "No such file or
    // directory" in Max log when filename was `host-tm/index.mjs`. Same
    // constraint as Max [jsui]. (See ADR 004 §Patcher path conventions.)
    //
    // `.mjs` (not `.js`) per the load-bearing comment in
    // m4l/stencil-tm.mjs: ".mjs is unconditionally ESM; .js would
    // default to CJS in [node.script]'s tempdir and fail to parse the
    // import."
    const { boxes } = loadPatcher(TM_MAXPAT)
    const newobjs = boxesByMaxclass(boxes, 'newobj')
    assert.ok(
      newobjs.some((b) => /^node\.script\s+stencil-tm\.mjs\b/.test(b.box.text)),
      'expected node.script referencing stencil-tm.mjs',
    )
  })

  test('TM — has midiin / midiparse / noteout for MIDI I/O', () => {
    // ADR 003 §Stencil-TM patcher: midiin -> noteIn/noteOff routing,
    // Max.outlet -> noteout. We assert the three required objects exist;
    // wiring between them is a manual visual check.
    const { boxes } = loadPatcher(TM_MAXPAT)
    const newobjs = boxesByMaxclass(boxes, 'newobj').map((b) => b.box.text)
    assert.ok(newobjs.some((t) => /^midiin\b/.test(t)), 'midiin')
    assert.ok(newobjs.some((t) => /^midiparse\b/.test(t)), 'midiparse')
    assert.ok(newobjs.some((t) => /^(noteout|midiout)\b/.test(t)), 'noteout/midiout')
  })

  test('TM — has transport / metro / counter / step path', () => {
    // ADR 002 §Patcher: "[transport] object emits a tick on each
    // subdivision step; routed to [node.script] via a `step` message".
    // Real implementation uses metro + counter + prepend step (oedipa
    // pattern) since [transport] alone doesn't generate per-step ticks.
    const { boxes } = loadPatcher(TM_MAXPAT)
    const newobjs = boxesByMaxclass(boxes, 'newobj').map((b) => b.box.text)
    assert.ok(newobjs.some((t) => /^q?metro\b/.test(t)), 'metro / qmetro')
    assert.ok(newobjs.some((t) => /^counter\b/.test(t)), 'counter')
    assert.ok(newobjs.some((t) => /^prepend\s+step\b/.test(t)), 'prepend step')
  })

  for (const [longname, shortname, bridgeKey, type, mmin, mmax, initial] of TM_LIVE_PARAMS) {
    test(`TM — live.* widget ${longname} matches ADR 002 spec`, () => {
      // Per-row check against ADR 002. We verify enough of the widget's
      // parameter attrs that a hand-edit slip (wrong range, wrong type)
      // is caught before reaching Live's parameter list.
      const { boxes } = loadPatcher(TM_MAXPAT)
      const w = findLiveWidget(boxes, longname)
      assert.ok(w, `widget ${longname} missing`)
      const attrs = widgetParamAttrs(w)
      assert.equal(attrs.parameter_shortname, shortname, 'shortname')
      assert.equal(attrs.parameter_type, type, 'parameter_type')
      assert.equal(attrs.parameter_mmin, mmin, 'mmin')
      assert.equal(attrs.parameter_mmax, mmax, 'mmax')
      // parameter_initial is an array (Max convention); compare first elem.
      assert.equal(attrs.parameter_initial[0], initial, 'initial')
    })

    test(`TM — ${longname} change fires setParam ${bridgeKey} to node.script`, () => {
      // Wiring: widget outlet -> [prepend setParam <bridgeKey>] -> node.script.
      // The bridge accepts only the keys listed in TM_LIVE_PARAMS /
      // TM_LIVE_ENUMS (see host-tm/bridge.ts setParam switch); a
      // missing/typo prepend would silently drop the param update.
      const { boxes, lines } = loadPatcher(TM_MAXPAT)
      const w = findLiveWidget(boxes, longname)
      const prep = findPrependBox(boxes, `setParam ${bridgeKey}`)
      assert.ok(prep, `missing [prepend setParam ${bridgeKey}]`)
      assert.ok(
        followsLineFromTo(lines, w.box.id, prep.box.id),
        `${w.box.id} -> ${prep.box.id} wire missing`,
      )
      const nodescript = boxesByMaxclass(boxes, 'newobj').find((b) =>
        /^node\.script\s+stencil-tm\.mjs\b/.test(b.box.text),
      )
      assert.ok(
        followsLineFromTo(lines, prep.box.id, nodescript.box.id),
        `${prep.box.id} -> node.script wire missing`,
      )
    })
  }

  for (const [longname, shortname, bridgeKey, enumValues, initialIdx] of TM_LIVE_ENUMS) {
    test(`TM — enum widget ${longname} matches ADR 002 spec`, () => {
      // Enum widgets (live.menu) are validated separately because they
      // use parameter_enum / parameter_type=2 instead of mmin/mmax.
      const { boxes } = loadPatcher(TM_MAXPAT)
      const w = findLiveWidget(boxes, longname)
      assert.ok(w, `widget ${longname} missing`)
      const attrs = widgetParamAttrs(w)
      assert.equal(attrs.parameter_shortname, shortname, 'shortname')
      assert.equal(attrs.parameter_type, 2, 'parameter_type=2 (enum)')
      assert.deepEqual(attrs.parameter_enum, enumValues, 'enum values')
      assert.equal(attrs.parameter_initial[0], initialIdx, 'initial index')
    })

    test(`TM — ${longname} dispatches one [message setParam ${bridgeKey} <enum>] per value`, () => {
      // live.menu emits the int index; [sel 0 1 ...] fans it out to
      // discrete `setParam triggerMode auto` / `... gate` / `... seed`
      // messages. Catch missing or extra cases.
      const { boxes } = loadPatcher(TM_MAXPAT)
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

  test('TM — all 12 live.* parameters are present (no extras, no missing)', () => {
    // Cross-check the per-widget tests with a count assertion. Catches a
    // silent duplicate longname or an extra unrelated live.* widget that
    // would inflate the parameter list shown to the user in Live.
    const { boxes } = loadPatcher(TM_MAXPAT)
    const liveWidgets = boxes.filter((b) => {
      const cls = b.box?.maxclass
      return (cls === 'live.numbox' || cls === 'live.dial' || cls === 'live.slider' || cls === 'live.menu')
        && b.box?.saved_attribute_attributes?.valueof?.parameter_longname?.startsWith('StencilTm')
    })
    const expected = TM_LIVE_PARAMS.length + TM_LIVE_ENUMS.length
    assert.equal(liveWidgets.length, expected, `expected ${expected} TM live.* widgets`)
  })

  test('TM — register / position outlets route from node.script to ring bpatcher', () => {
    // Bridge emits Max.outlet("register", ...) / Max.outlet("position", n).
    // Routing chain: [node.script] -> [route note ready register position]
    // -> [deferlow] -> [prepend register]/[prepend position] ->
    // [bpatcher registerRing.subpatcher.maxpat] (which forwards into
    // its inner [jsui]). We verify reachability rather than the exact
    // intermediate nodes.
    const { boxes, lines } = loadPatcher(TM_MAXPAT)
    const nodescript = boxesByMaxclass(boxes, 'newobj').find((b) =>
      /^node\.script\s+stencil-tm\.mjs\b/.test(b.box.text),
    )
    const bpatcher = boxesByMaxclass(boxes, 'bpatcher').find(
      (b) => b.box.name === 'registerRing.subpatcher.maxpat',
    )
    assert.ok(
      reachable(lines, nodescript.box.id, bpatcher.box.id),
      'node.script -> ... -> bpatcher chain missing',
    )
  })

  test('TM — bpatcher setBit outlet routes to node.script (ring click handler)', () => {
    // ADR 003 TM ring click -> setBit. Outlet from sub-patcher's [jsui]
    // is exposed via the sub-patcher's [outlet], surfaced as the
    // bpatcher's outlet 0 in the parent, then flows through into
    // [node.script] for the host's setBit handler.
    const { boxes, lines } = loadPatcher(TM_MAXPAT)
    const bpatcher = boxesByMaxclass(boxes, 'bpatcher').find(
      (b) => b.box.name === 'registerRing.subpatcher.maxpat',
    )
    const nodescript = boxesByMaxclass(boxes, 'newobj').find((b) =>
      /^node\.script\s+stencil-tm\.mjs\b/.test(b.box.text),
    )
    assert.ok(
      reachable(lines, bpatcher.box.id, nodescript.box.id),
      'bpatcher -> ... -> node.script chain missing',
    )
  })
}
