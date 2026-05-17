// Pointsman vertical separator (jsui). Ported from oedipa's
// separator-renderer.js: a sub-pixel anti-aliased line, thinner than the
// 1 px [panel] minimum. Mimics Live's native section dividers between
// SCALE / KEYBOARD / HUMAN groups.

inlets = 1
outlets = 0

mgraphics.init()
mgraphics.relative_coords = 0
mgraphics.autofill = 0

function paint() {
  var w = box.rect[2] - box.rect[0]
  var h = box.rect[3] - box.rect[1]

  mgraphics.set_source_rgba(0.10, 0.10, 0.10, 1)
  mgraphics.set_line_width(1)
  mgraphics.move_to(w / 2, 0)
  mgraphics.line_to(w / 2, h)
  mgraphics.stroke()
}
