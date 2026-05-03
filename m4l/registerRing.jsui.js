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

// --- Visual identity (sampled from inboil src/app.css) ---
//
// Exact hex values per ADR 003 "Visual identity". These are the inboil
// design tokens transcoded to 0..1 RGB for mgraphics. Update both the
// ADR and this block together if the palette ever changes.

var COL_BG          = [0.929, 0.910, 0.863] // #EDE8DC --color-bg     warm cream
var COL_FG          = [0.118, 0.125, 0.157] // #1E2028 --color-fg     dark navy (text)
var COL_ACTIVE_FILL = [0.471, 0.471, 0.271] // #787845 --color-olive  olive (active bits)
var COL_HIGHLIGHT   = [0.910, 0.627, 0.565] // #E8A090 --color-salmon salmon (read-head)
// Inactive-bit outline: olive at 0.55 alpha. Inboil uses 0.35 but at
// inboil's larger scale (250x250 svg viewport) 0.35 reads fine; in the
// M4L 320x132 jsui the dots are smaller and 0.35 reads as nearly
// invisible. 0.55 keeps the same hue but with enough presence to be
// legible at the smaller scale.
var COL_OUTLINE     = [0.471, 0.471, 0.271] // olive base
var OUTLINE_ALPHA   = 0.55

// --- State ---
//
// bits: 0/1 array, length implies the current TM register length. Replaced
// wholesale by the bridge's `register` outlet on every step and on length
// changes, so we don't track length separately.
// readHead: 0..bits.length-1, position from the bridge's `ringHead` outlet.
//
// Empty until the bridge's first `register` message arrives. paint()
// handles bits.length === 0 by drawing a DEFAULT_LENGTH-dot outline
// fallback so the device looks alive on first paint.

var bits = []
var readHead = 0

// --- Message dispatch ---
//
// register <bit0> <bit1> ... <bitN-1>   replace bits, redraw
// ringHead <n>                          set read-head, redraw
//
// Use `anything` so message routing is explicit and unhandled messages get
// a clear post() instead of a silent drop.
//
// Outlet symbol from the bridge is `ringHead` (NOT `position`): when a
// [jsui] inlet receives a message whose first symbol matches a Max
// box-level attribute name (`position` is one such reserved word), Max
// interprets it as a setter and shifts the box's screen position --
// observed empirically as a 1px-per-message creep in M4L locked view.
// `ringHead` is a domain-specific non-colliding name. Keep this in
// sync with bridge.ts's emitOutlet call and the patcher's
// [route ... ringHead] / [prepend ringHead] objects.

function anything() {
  var msg = messagename
  var args = arrayfromargs(arguments)
  if (msg === 'register') { setRegister(args); return }
  if (msg === 'ringHead') { setReadHead(args[0]); return }
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

function strokeCircle(x, y, r, c, alpha, lineW) {
  mgraphics.set_source_rgba(c[0], c[1], c[2], alpha)
  mgraphics.set_line_width(lineW)
  mgraphics.ellipse(x - r, y - r, r * 2, r * 2)
  mgraphics.stroke()
}

// Default ring length to draw before the bridge has emitted its first
// `register` message. Matches DEFAULT_PARAMS.length in host-tm/host.ts.
// Without this, a freshly-loaded device shows a blank cream rectangle
// until the first transport step (or any param dump) -- confusing.
var DEFAULT_LENGTH = 8

// Compute the register's value as a fraction in [0, 1]. Mirrors the
// engine's `registerToFraction(register, length)` (m4l/engine/turing.ts):
// num = sum(bits[i] << i), den = (1 << length) - 1, value = num/den.
// Used for the ring center text per ADR 003 "Layout sketch".
function registerFraction(bs) {
  if (bs.length === 0) return 0
  var num = 0
  for (var i = 0; i < bs.length; i++) {
    if (bs[i] === 1) num |= (1 << i)
  }
  num = num >>> 0
  var den = bs.length >= 32 ? 0xffffffff : (((1 << bs.length) - 1) >>> 0)
  return den > 0 ? num / den : 0
}

// Format a fraction in [0, 1] as "0.XX" (matches inboil
// TuringSheet.svelte `displaySnap.value.toFixed(2)`).
function formatFraction(f) {
  if (f >= 1) return '1.00'
  if (f <= 0) return '0.00'
  // toFixed isn't available in Max's classic JS engine; do it by hand.
  var hundredths = Math.round(f * 100)
  var tens = Math.floor(hundredths / 10)
  var ones = hundredths % 10
  return '0.' + tens + ones
}

function paint() {
  var w = box.rect[2] - box.rect[0]
  var h = box.rect[3] - box.rect[1]

  // Background fill so the ring sits on the inboil cream rather than
  // Live's default device gray.
  mgraphics.set_source_rgba(COL_BG[0], COL_BG[1], COL_BG[2], 1)
  mgraphics.rectangle(0, 0, w, h)
  mgraphics.fill()

  // Empty state: draw an outlined ring at DEFAULT_LENGTH so the device
  // looks alive on first load. The bridge replaces this with the real
  // register on `ready` (see TmBridge constructor) within one event
  // loop tick; this is a fallback for the in-between frame.
  var len = bits.length > 0 ? bits.length : DEFAULT_LENGTH
  var g = computeGeometry(w, h, len)

  for (var i = 0; i < len; i++) {
    var p = bitPosition(i, g)
    var isHead = (bits.length > 0 && i === readHead)
    var isOn = (bits.length > 0 && bits[i] === 1)

    if (isHead) {
      // Read-head: filled salmon disk regardless of bit value. The
      // read-head's job is to show "where"; bit value is read from
      // the surrounding ring. Matches inboil `.bit-reading` style.
      fillCircle(p.x, p.y, g.bitRadius, COL_HIGHLIGHT)
    } else if (isOn) {
      fillCircle(p.x, p.y, g.bitRadius, COL_ACTIVE_FILL)
    } else {
      // Inactive: hollow olive at low alpha. 1.5px line matches inboil
      // `.bit-circle { stroke-width: 1.5 }`.
      strokeCircle(p.x, p.y, g.bitRadius, COL_OUTLINE, OUTLINE_ALPHA, 1.5)
    }
  }

  // DIAGNOSTIC: center text rendering temporarily disabled to test
  // whether mgraphics.select_font_face / set_font_size / show_text is
  // what causes the canvas to drift after the first paint.
  // Hypothesis correlation: drift happens only when bits.length > 0,
  // which is exactly when this text block runs.
  // if (bits.length > 0) {
  //   mgraphics.set_source_rgba(COL_FG[0], COL_FG[1], COL_FG[2], 1)
  //   mgraphics.select_font_face('Andale Mono')
  //   mgraphics.set_font_size(16)
  //   var label = formatFraction(registerFraction(bits))
  //   var tm = mgraphics.text_measure(label)
  //   mgraphics.move_to(g.cx - tm[0] / 2, g.cy + tm[1] / 2)
  //   mgraphics.show_text(label)
  // }
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
