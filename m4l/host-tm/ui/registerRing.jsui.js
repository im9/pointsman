// Stencil TM register-ring renderer (jsui).
// Spec: docs/ai/adr/003-m4l-ui-design.md "TM register ring".
// Reference: inboil's TuringSheet.svelte ring visualization.
//
// Radial ring of `length` dots. Active bits filled, inactive outlined.
// Read-head dot drawn in the highlight color. Click a bit to toggle and
// emit `setBit <index> <value>` upstream so the host's register updates
// and re-emits the canonical `register` snapshot.
//
// Pure layout & hit-test logic lives in m4l/host-tm/ui/registerRing.logic.ts
// (with unit tests). Max's [jsui] runs Max's bundled JS engine, not Node,
// so the formula is re-implemented here as plain JS rather than imported.
// Keep MIN_LENGTH / MAX_LENGTH / MAX_BIT_RADIUS / BIT_GAP / CANVAS_MARGIN
// in sync with registerRing.logic.ts. A drift test
// (registerRing.mirror.test.ts) asserts the constants line up.
//
// Comments and string literals are ASCII; non-ASCII glyphs are written as
// \uXXXX escapes -- Max's classic JS parser has been observed to choke on
// UTF-8 in source files (oedipa convention).

inlets = 1
outlets = 1

mgraphics.init()
mgraphics.relative_coords = 0
mgraphics.autofill = 0

post('registerRing.jsui.js loaded build=2026-05-03\n')

// --- Constants (mirror m4l/host-tm/ui/registerRing.logic.ts) ---

var MIN_LENGTH = 2
var MAX_LENGTH = 32
var MAX_BIT_RADIUS = 14
var BIT_GAP = 2
var CANVAS_MARGIN = 4

// --- Visual identity (placeholder until slice (i) samples inboil) ---
//
// ADR 003 "Visual identity" names the tokens; exact hex picked when
// the patcher work captures inboil screenshots. These approximations let
// the renderer ship visually before the official sampling pass.

var COL_BG          = [0.96, 0.94, 0.86] // cream / oat
var COL_OUTLINE     = [0.70, 0.66, 0.54] // pale taupe (inactive bits)
var COL_ACTIVE_FILL = [0.42, 0.45, 0.21] // olive / sage (filled bits)
var COL_HIGHLIGHT   = [0.95, 0.55, 0.40] // warm peach / coral (read-head)

// --- State ---
//
// bits: 0/1 array, length implies the current TM register length. Replaced
// wholesale by the bridge's `register` outlet on every step and on length
// changes, so we don't track length separately.
// readHead: 0..bits.length-1, position from the bridge's `position` outlet.

var bits = []
var readHead = 0

// --- Message dispatch ---
//
// register <bit0> <bit1> ... <bitN-1>   replace bits, redraw
// position <n>                          set read-head, redraw
//
// Use `anything` so message routing is explicit and unhandled messages get
// a clear post() instead of a silent drop.

function anything() {
  var msg = messagename
  var args = arrayfromargs(arguments)
  if (msg === 'register') { setRegister(args); return }
  if (msg === 'position') { setReadHead(args[0]); return }
  post('registerRing.jsui.js: unhandled message ' + msg + '\n')
}

function setRegister(args) {
  var next = []
  for (var i = 0; i < args.length; i++) {
    next.push(Number(args[i]) & 1)
  }
  bits = next
  if (bits.length > 0 && readHead >= bits.length) {
    readHead = bits.length - 1
  }
  mgraphics.redraw()
}

function setReadHead(n) {
  n = Number(n)
  if (!isFinite(n) || bits.length === 0) return
  var len = bits.length
  var w = ((Math.floor(n) % len) + len) % len
  readHead = w
  mgraphics.redraw()
}

// --- Layout (mirrors registerRing.logic.ts) ---

function clampLength(n) {
  n = Number(n)
  if (!isFinite(n)) return MIN_LENGTH
  var r = Math.round(n)
  if (r < MIN_LENGTH) return MIN_LENGTH
  if (r > MAX_LENGTH) return MAX_LENGTH
  return r
}

function computeGeometry(boxW, boxH, len) {
  len = clampLength(len)
  var cx = boxW / 2
  var cy = boxH / 2
  var minDim = boxW < boxH ? boxW : boxH
  var maxRadius = minDim / 2 - CANVAS_MARGIN
  if (maxRadius < 0) maxRadius = 0
  var arcHalf = (Math.PI * maxRadius) / Math.max(len, 4)
  var bitRadius = arcHalf - BIT_GAP
  if (bitRadius > MAX_BIT_RADIUS) bitRadius = MAX_BIT_RADIUS
  if (bitRadius < 1) bitRadius = 1
  var radius = maxRadius - bitRadius
  if (radius < 0) radius = 0
  return { cx: cx, cy: cy, radius: radius, bitRadius: bitRadius, length: len }
}

function bitPosition(idx, g) {
  var angle = (idx / g.length) * Math.PI * 2 - Math.PI / 2
  return {
    x: g.cx + g.radius * Math.cos(angle),
    y: g.cy + g.radius * Math.sin(angle)
  }
}

function hitTest(x, y, g) {
  var r2 = g.bitRadius * g.bitRadius
  for (var i = 0; i < g.length; i++) {
    var p = bitPosition(i, g)
    var dx = x - p.x
    var dy = y - p.y
    if (dx * dx + dy * dy <= r2) return i
  }
  return -1
}

// --- Drawing ---

function fillCircle(x, y, r, c) {
  mgraphics.set_source_rgba(c[0], c[1], c[2], 1)
  mgraphics.ellipse(x - r, y - r, r * 2, r * 2)
  mgraphics.fill()
}

function strokeCircle(x, y, r, c, lineW) {
  mgraphics.set_source_rgba(c[0], c[1], c[2], 1)
  mgraphics.set_line_width(lineW)
  mgraphics.ellipse(x - r, y - r, r * 2, r * 2)
  mgraphics.stroke()
}

function paint() {
  var w = box.rect[2] - box.rect[0]
  var h = box.rect[3] - box.rect[1]

  // Background fill so the ring sits on the inboil cream rather than Live's
  // default device gray. Patcher-side bgcolor would also work; doing it
  // here keeps the visual self-contained per [jsui].
  mgraphics.set_source_rgba(COL_BG[0], COL_BG[1], COL_BG[2], 1)
  mgraphics.rectangle(0, 0, w, h)
  mgraphics.fill()

  if (bits.length === 0) return

  var g = computeGeometry(w, h, bits.length)

  for (var i = 0; i < g.length; i++) {
    var p = bitPosition(i, g)
    var isHead = (i === readHead)
    var isOn = (bits[i] === 1)

    if (isHead) {
      // Highlight read-head as a filled coral dot regardless of bit value
      // -- the read-head's job is to show "where", and bit value is read
      // separately from the surrounding outlined/filled dots. Matches
      // inboil bit-reading style (filled accent).
      fillCircle(p.x, p.y, g.bitRadius, COL_HIGHLIGHT)
    } else if (isOn) {
      fillCircle(p.x, p.y, g.bitRadius, COL_ACTIVE_FILL)
    } else {
      // Inactive: hollow with taupe outline. 1.5px line matches inboil's
      // bit-circle stroke-width.
      strokeCircle(p.x, p.y, g.bitRadius, COL_OUTLINE, 1.5)
    }
  }
}

// --- Mouse interaction ---
//
// Single primary-button click toggles the bit at the cursor. Out-of-bound
// or modifier clicks are ignored -- modifiers reserved for future drag-paint
// (ADR 003 "Open questions").

function onclick(x, y, button, cmd, shift, capslock, option, ctrl) {
  if (button !== 1) return
  if (cmd || shift || option || ctrl) return
  if (bits.length === 0) return

  var w = box.rect[2] - box.rect[0]
  var h = box.rect[3] - box.rect[1]
  var g = computeGeometry(w, h, bits.length)

  var idx = hitTest(x, y, g)
  if (idx < 0) return

  // Optimistic local toggle so the UI feels instant; the bridge's
  // re-emitted `register` will correct this within one round-trip if the
  // host disagrees (e.g. setBit ignored due to validation).
  var newValue = (bits[idx] === 1) ? 0 : 1
  bits[idx] = newValue
  mgraphics.redraw()
  outlet(0, 'setBit', idx, newValue)
}
