// Pointsman scale-keyboard renderer (jsui).
// Spec: docs/ai/adr/003-m4l-ui-design.md "scale keyboard".
// Reference: inboil's QuantizerSheet.svelte one-octave keyboard.
//
// One-octave (12-key) piano keyboard. White keys flat, black keys raised
// (BLACK_KEY_HEIGHT_RATIO of the white-key area). Each in-scale key
// carries a dot drawn INSIDE the key near its bottom edge; out-of-scale
// keys carry no dot. Black keys are shorter, so their dots end up
// visually higher than white-key dots -- gives an inboil-style two-row
// separation between black and white in-scale membership for free. On a
// notePulse from the bridge the corresponding key glows briefly and
// decays back over PULSE_DECAY_MS. Keyboard is display-only in v1 (no
// click-to-edit-scale -- ADR 003 "scale keyboard").
//
// Pure layout, scale-membership, and pulse-decay logic live in
// m4l/host/ui/scaleKeyboard.logic.ts (with unit tests). Max's [jsui]
// runs Max's bundled JS engine (no module system), so the formulas are
// re-implemented here as plain JS rather than imported. Keep
// NUM_PITCH_CLASSES / PULSE_DECAY_MS / WHITE_KEYS_PER_OCTAVE /
// BLACK_KEY_WIDTH_RATIO / BLACK_KEY_HEIGHT_RATIO / DOT_INSET_RATIO /
// DOT_RADIUS_RATIO and the SCALE_INTERVALS table in sync with
// scaleKeyboard.logic.ts (and with m4l/engine/quantizer.ts for the
// intervals). A drift test (scaleKeyboard.mirror.test.ts) asserts the
// constants and intervals line up.
//
// Comments and string literals are ASCII; non-ASCII glyphs are written as
// \uXXXX escapes -- Max's classic JS parser has been observed to choke on
// UTF-8 in source files (oedipa convention).

inlets = 1
outlets = 1

mgraphics.init()
mgraphics.relative_coords = 0
mgraphics.autofill = 0

post('scaleKeyboard.jsui.js loaded build=2026-05-04\n')

// --- Constants (mirror m4l/host/ui/scaleKeyboard.logic.ts) ---

var NUM_PITCH_CLASSES = 12
var WHITE_KEYS_PER_OCTAVE = 7
var PULSE_DECAY_MS = 250
var BLACK_KEY_WIDTH_RATIO = 0.6
var BLACK_KEY_HEIGHT_RATIO = 0.6
var DOT_INSET_RATIO = 0.15
var DOT_RADIUS_RATIO = 0.08
var DOT_RADIUS_MIN_PX = 1.5

// Pitch-class intervals per scale, root-relative. Mirror of
// SCALE_INTERVALS in m4l/engine/quantizer.ts. The drift test
// (scaleKeyboard.mirror.test.ts) reads this table from text and asserts
// each entry matches the engine's definition.
var SCALE_INTERVALS = {
  'major':            [0, 2, 4, 5, 7, 9, 11],
  'minor':            [0, 2, 3, 5, 7, 8, 10],
  'dorian':           [0, 2, 3, 5, 7, 9, 10],
  'phrygian':         [0, 1, 3, 5, 7, 8, 10],
  'lydian':           [0, 2, 4, 6, 7, 9, 11],
  'mixolydian':       [0, 2, 4, 5, 7, 9, 10],
  'locrian':          [0, 1, 3, 5, 6, 8, 10],
  'pentatonic':       [0, 2, 4, 7, 9],
  'minor-pentatonic': [0, 3, 5, 7, 10],
  'blues':            [0, 3, 5, 6, 7, 10],
  'harmonic':         [0, 2, 3, 5, 7, 8, 11],
  'melodic':          [0, 2, 3, 5, 7, 9, 11],
  'whole':            [0, 2, 4, 6, 8, 10],
  'chromatic':        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
}

// Pitch classes that are black keys on a piano (C# D# F# G# A#).
var BLACK_PCS = { 1: 1, 3: 1, 6: 1, 8: 1, 10: 1 }

// White-key index (0..6, left to right) for each white pitch class.
var WHITE_INDEX_OF = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 }

// Boundary white-key index (left of the black key) for each black pitch class.
var BLACK_BOUNDARY_INDEX = { 1: 1, 3: 2, 6: 4, 8: 5, 10: 6 }

// --- Visual identity (placeholder until slice (i) samples inboil) ---

var COL_BG          = [0.96, 0.94, 0.86] // cream / oat
var COL_OUTLINE     = [0.70, 0.66, 0.54] // pale taupe (key borders, hollow dots)
var COL_BLACK       = [0.20, 0.18, 0.14] // near-black (black key fill)
var COL_ACTIVE_FILL = [0.42, 0.45, 0.21] // olive / sage (in-scale dot)
var COL_HIGHLIGHT   = [0.95, 0.55, 0.40] // warm peach / coral (pulse glow)

// --- State ---

var inScale = []
for (var i = 0; i < NUM_PITCH_CLASSES; i++) inScale.push(false)

// pulses: array of { pitchClass, baseIntensity, intensity, ageMs }. Same
// shape as scaleKeyboard.logic.ts Pulse type. baseIntensity is the
// velocity-derived value at age=0 and never changes; intensity is the
// current decayed value, recomputed each tick from
// baseIntensity * (1 - ageMs / PULSE_DECAY_MS). Storing the base
// separately avoids the "current * (1 - newAge/decay)" recurrence,
// which compounds into exponential decay under multi-tick frames.
// Pruned in tick() when ageMs >= PULSE_DECAY_MS.
var pulses = []

var lastTickMs = 0
var animTask = new Task(tick)
animTask.interval = 16

// --- Message dispatch ---
//
// scaleChanged <scale-name> <root>   replace inScale[]
// notePulse <pitch> <velocity>       append pulse, start anim
//
// `anything` so unhandled messages get a clear post().

function anything() {
  var msg = messagename
  var args = arrayfromargs(arguments)
  if (msg === 'scaleChanged') { handleScaleChanged(args[0], args[1]); return }
  if (msg === 'notePulse')    { handleNotePulse(args[0], args[1]); return }
  post('scaleKeyboard.jsui.js: unhandled message ' + msg + '\n')
}

function handleScaleChanged(scale, root) {
  var r = Number(root)
  if (!isFinite(r)) r = 0
  r = ((Math.floor(r) % 12) + 12) % 12
  inScale = recomputeInScale(String(scale), r)
  mgraphics.redraw()
}

function handleNotePulse(pitch, velocity) {
  var p = Number(pitch)
  var v = Number(velocity)
  if (!isFinite(p) || !isFinite(v) || v <= 0) return
  var pc = ((Math.floor(p) % NUM_PITCH_CLASSES) + NUM_PITCH_CLASSES) % NUM_PITCH_CLASSES
  var base = v / 127
  if (base > 1) base = 1
  pulses.push({ pitchClass: pc, baseIntensity: base, intensity: base, ageMs: 0 })
  startAnim()
  mgraphics.redraw()
}

// --- Scale logic (mirrors scaleKeyboard.logic.ts) ---

function recomputeInScale(scale, root) {
  var arr = []
  for (var i = 0; i < NUM_PITCH_CLASSES; i++) arr.push(false)
  if (scale === 'chromatic-half') {
    for (var j = 0; j < NUM_PITCH_CLASSES; j++) arr[j] = true
    return arr
  }
  var intervals = SCALE_INTERVALS[scale]
  if (!intervals) return arr
  for (var k = 0; k < intervals.length; k++) {
    arr[(root + intervals[k]) % NUM_PITCH_CLASSES] = true
  }
  return arr
}

function isBlackKey(pc) { return BLACK_PCS[pc] === 1 }

// --- Pulse animation ---
//
// Task fires every ~16 ms (~60 fps) while pulses is non-empty. It computes
// real-elapsed dt from Date.now() rather than the nominal interval, so the
// decay matches wall-clock time even if Max throttles the task under load.

function startAnim() {
  if (pulses.length === 0) return
  if (animTask.running) return
  lastTickMs = Date.now()
  animTask.repeat()
}

function tick() {
  var now = Date.now()
  var dt = now - lastTickMs
  lastTickMs = now
  if (dt <= 0) { mgraphics.redraw(); return }

  var next = []
  for (var i = 0; i < pulses.length; i++) {
    var p = pulses[i]
    var ageMs = p.ageMs + dt
    if (ageMs >= PULSE_DECAY_MS) continue
    next.push({
      pitchClass: p.pitchClass,
      baseIntensity: p.baseIntensity,
      intensity: p.baseIntensity * (1 - ageMs / PULSE_DECAY_MS),
      ageMs: ageMs
    })
  }
  pulses = next
  if (pulses.length === 0) animTask.cancel()
  mgraphics.redraw()
}

// --- Layout (mirrors scaleKeyboard.logic.ts computeGeometry / keyBoundsAt) ---

function computeGeometry(boxW, boxH) {
  var whiteKeyWidth = boxW / WHITE_KEYS_PER_OCTAVE
  var blackKeyWidth = whiteKeyWidth * BLACK_KEY_WIDTH_RATIO
  var whiteKeyAreaHeight = boxH
  var blackKeyHeight = whiteKeyAreaHeight * BLACK_KEY_HEIGHT_RATIO
  var dotRadius = whiteKeyWidth * DOT_RADIUS_RATIO
  if (dotRadius < DOT_RADIUS_MIN_PX) dotRadius = DOT_RADIUS_MIN_PX
  return {
    canvasWidth: boxW,
    canvasHeight: boxH,
    whiteKeyWidth: whiteKeyWidth,
    blackKeyWidth: blackKeyWidth,
    whiteKeyAreaHeight: whiteKeyAreaHeight,
    blackKeyHeight: blackKeyHeight,
    dotRadius: dotRadius
  }
}

function keyBoundsAt(pc, g) {
  if (isBlackKey(pc)) {
    var bIdx = BLACK_BOUNDARY_INDEX[pc]
    return {
      x: bIdx * g.whiteKeyWidth - g.blackKeyWidth / 2,
      y: 0,
      w: g.blackKeyWidth,
      h: g.blackKeyHeight,
      isBlack: true
    }
  }
  var wIdx = WHITE_INDEX_OF[pc]
  return {
    x: wIdx * g.whiteKeyWidth,
    y: 0,
    w: g.whiteKeyWidth,
    h: g.whiteKeyAreaHeight,
    isBlack: false
  }
}

function dotCenterAt(pc, g) {
  var b = keyBoundsAt(pc, g)
  return {
    cx: b.x + b.w / 2,
    cy: b.h * (1 - DOT_INSET_RATIO)
  }
}

// Inverse of WHITE_INDEX_OF: white-key index 0..6 -> pitch class. Used
// by hitTest to map a click's whiteIdx back to a pc. Mirrors
// PC_OF_WHITE_INDEX in scaleKeyboard.logic.ts.
var PC_OF_WHITE_INDEX = [0, 2, 4, 5, 7, 9, 11]

// Pitch classes ordered by ascending boundary index, so hitTest can
// iterate the black-key x-bounds without re-deriving boundary positions.
// Mirrors BLACK_PCS_BY_BOUNDARY in scaleKeyboard.logic.ts.
var BLACK_PCS_BY_BOUNDARY = [1, 3, 6, 8, 10]

// Map a canvas-relative click point to a pitch class. Mirrors hitTest
// in scaleKeyboard.logic.ts. Black overlay applies in y < blackKeyHeight;
// below that, the click falls through to the white below.
function hitTest(x, y, g) {
  if (!isFinite(x) || !isFinite(y)) return -1
  if (x < 0 || x >= g.canvasWidth) return -1
  if (y < 0 || y >= g.canvasHeight) return -1

  if (y < g.blackKeyHeight) {
    for (var i = 0; i < BLACK_PCS_BY_BOUNDARY.length; i++) {
      var pc = BLACK_PCS_BY_BOUNDARY[i]
      var boundaryIdx = BLACK_BOUNDARY_INDEX[pc]
      var bx = boundaryIdx * g.whiteKeyWidth - g.blackKeyWidth / 2
      if (x >= bx && x < bx + g.blackKeyWidth) return pc
    }
  }
  var whiteIdx = Math.floor(x / g.whiteKeyWidth)
  if (whiteIdx < 0 || whiteIdx >= WHITE_KEYS_PER_OCTAVE) return -1
  return PC_OF_WHITE_INDEX[whiteIdx]
}

// --- Drawing ---

function setRgb(c) { mgraphics.set_source_rgba(c[0], c[1], c[2], 1) }
function setRgba(c, a) { mgraphics.set_source_rgba(c[0], c[1], c[2], a) }

function fillRect(x, y, w, h) {
  mgraphics.rectangle(x, y, w, h)
  mgraphics.fill()
}

function strokeRect(x, y, w, h, lineW) {
  mgraphics.set_line_width(lineW)
  mgraphics.rectangle(x, y, w, h)
  mgraphics.stroke()
}

function fillCircle(cx, cy, r) {
  mgraphics.ellipse(cx - r, cy - r, r * 2, r * 2)
  mgraphics.fill()
}

// Sum overlapping pulses on the same pitch class, capped at 1. Lets a
// fast trill stack visually rather than collapse to one steady glow
// (ADR 003 "Pulses stack visually (the most recent dominates)").
function pulseGlow(pc) {
  var sum = 0
  for (var i = 0; i < pulses.length; i++) {
    if (pulses[i].pitchClass === pc) sum += pulses[i].intensity
  }
  return sum > 1 ? 1 : sum
}

function paint() {
  var w = box.rect[2] - box.rect[0]
  var h = box.rect[3] - box.rect[1]
  var g = computeGeometry(w, h)

  setRgb(COL_BG)
  fillRect(0, 0, w, h)

  // White keys first (base layer).
  for (var pc = 0; pc < NUM_PITCH_CLASSES; pc++) {
    if (isBlackKey(pc)) continue
    var b = keyBoundsAt(pc, g)
    setRgb(COL_BG)
    fillRect(b.x, b.y, b.w, b.h)
    setRgb(COL_OUTLINE)
    strokeRect(b.x, b.y, b.w, b.h, 1)
    var glow = pulseGlow(pc)
    if (glow > 0) {
      setRgba(COL_HIGHLIGHT, glow)
      fillRect(b.x, b.y, b.w, b.h)
    }
  }

  // Black keys on top.
  for (var pc2 = 0; pc2 < NUM_PITCH_CLASSES; pc2++) {
    if (!isBlackKey(pc2)) continue
    var bb = keyBoundsAt(pc2, g)
    setRgb(COL_BLACK)
    fillRect(bb.x, bb.y, bb.w, bb.h)
    var glow2 = pulseGlow(pc2)
    if (glow2 > 0) {
      setRgba(COL_HIGHLIGHT, glow2)
      fillRect(bb.x, bb.y, bb.w, bb.h)
    }
  }

  // In-scale dots, drawn INSIDE each in-scale key (no out-of-scale dots
  // -- ADR 003 sec scale keyboard). Black-key dots are cream so they
  // read against the near-black fill; white-key dots are olive
  // (COL_ACTIVE_FILL) for contrast against the cream background.
  // Drawn last so the dots stay visible on top of any pulse glow.
  for (var pc3 = 0; pc3 < NUM_PITCH_CLASSES; pc3++) {
    if (!inScale[pc3]) continue
    var d = dotCenterAt(pc3, g)
    if (isBlackKey(pc3)) {
      setRgb(COL_BG)
    } else {
      setRgb(COL_ACTIVE_FILL)
    }
    fillCircle(d.cx, d.cy, g.dotRadius)
  }
}

// --- Mouse interaction ---
//
// Single primary-button click on any key surface emits `setRoot <pc>`
// to outlet 0. The patcher routes this into root's [live.menu] so
// Live's parameter state stays the single source of truth -- the menu
// then fires the existing setParam root chain. Mirrors inboil's
// tapKey UX (QuantizerSheet.svelte:165-167). Out-of-bounds or modifier
// clicks ignored (modifiers reserved for future extensions).

function onclick(x, y, button, cmd, shift, capslock, option, ctrl) {
  if (button !== 1) return
  if (cmd || shift || option || ctrl) return

  var w = box.rect[2] - box.rect[0]
  var h = box.rect[3] - box.rect[1]
  var g = computeGeometry(w, h)

  var pc = hitTest(x, y, g)
  if (pc < 0) return

  outlet(0, 'setRoot', pc)
}
