// TM register-ring jsui pure logic — ADR 003 §TM register ring.
//
// Pure data + math, no Max APIs. Runs in Node for tests. Mirrored (by
// hand, ASCII-only) into registerRing.jsui.js for Max's [jsui] consumer.
// A drift test (registerRing.mirror.test.ts) asserts the named constants
// below appear in the renderer text. Function bodies are not auto-checked
// — keep them in sync by discipline; surface is small (~5 functions).

export type Bit = 0 | 1;

export const MIN_LENGTH = 2;
export const MAX_LENGTH = 32;

// Caps on the per-bit dot radius: anything larger reads as a button rather
// than a register bit. Anything smaller than 1 is degenerate. Both are
// musical/visual choices — adjust together with the renderer.
export const MAX_BIT_RADIUS = 14;

// Pixel gap subtracted from the arc-half spacing when sizing dots, so
// adjacent bits never touch even at MAX_LENGTH.
export const BIT_GAP = 2;

// Padding between the canvas edge and the outermost dot edge.
export const CANVAS_MARGIN = 4;

export interface RingModel {
  bits: Bit[];
  readHead: number;
  hovered: number;
}

export interface RingGeometry {
  cx: number;
  cy: number;
  radius: number;
  bitRadius: number;
  length: number;
}

export interface Point {
  x: number;
  y: number;
}

export function createModel(length: number): RingModel {
  const len = clampLength(length);
  const bits: Bit[] = new Array(len).fill(0) as Bit[];
  return { bits, readHead: 0, hovered: -1 };
}

export function computeGeometry(
  canvasWidth: number,
  canvasHeight: number,
  length: number,
): RingGeometry {
  const len = clampLength(length);
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  const maxRadius = Math.max(
    0,
    Math.min(canvasWidth, canvasHeight) / 2 - CANVAS_MARGIN,
  );
  // Arc-half spacing between adjacent bits at radius=maxRadius. Floor at
  // length=4 so very short registers (2/3) don't get oversized dots.
  const arcHalf = (Math.PI * maxRadius) / Math.max(len, 4);
  const bitRadius = Math.max(
    1,
    Math.min(MAX_BIT_RADIUS, arcHalf - BIT_GAP),
  );
  // Pull the placement radius in by bitRadius so dots sit inside the
  // canvas, not centered on its edge.
  const radius = Math.max(0, maxRadius - bitRadius);
  return { cx, cy, radius, bitRadius, length: len };
}

export function bitPosition(index: number, geometry: RingGeometry): Point {
  // Index 0 at top, advancing clockwise (screen y-down). Matches inboil
  // TuringSheet so the visual carries over unmodified.
  const angle = (index / geometry.length) * Math.PI * 2 - Math.PI / 2;
  return {
    x: geometry.cx + geometry.radius * Math.cos(angle),
    y: geometry.cy + geometry.radius * Math.sin(angle),
  };
}

export function hitTest(x: number, y: number, geometry: RingGeometry): number {
  const r2 = geometry.bitRadius * geometry.bitRadius;
  for (let i = 0; i < geometry.length; i++) {
    const p = bitPosition(i, geometry);
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx * dx + dy * dy <= r2) return i;
  }
  return -1;
}

export function toggleBitAt(model: RingModel, index: number): RingModel {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= model.bits.length
  ) {
    return model;
  }
  const bits = model.bits.slice();
  bits[index] = (bits[index] === 1 ? 0 : 1) as Bit;
  return { ...model, bits };
}

export function advanceReadHead(model: RingModel): RingModel {
  if (model.bits.length === 0) return model;
  const next = (model.readHead + 1) % model.bits.length;
  return { ...model, readHead: next };
}

export function setRegister(
  model: RingModel,
  bits: ReadonlyArray<number>,
): RingModel {
  const sanitized: Bit[] = [];
  for (let i = 0; i < bits.length; i++) {
    sanitized.push((bits[i] & 1) as Bit);
  }
  const readHead =
    sanitized.length > 0
      ? Math.min(model.readHead, sanitized.length - 1)
      : 0;
  return { ...model, bits: sanitized, readHead };
}

export function setReadHead(model: RingModel, position: number): RingModel {
  if (!Number.isFinite(position) || model.bits.length === 0) return model;
  const len = model.bits.length;
  const wrapped = ((Math.floor(position) % len) + len) % len;
  return { ...model, readHead: wrapped };
}

export function setHovered(model: RingModel, index: number): RingModel {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= model.bits.length
  ) {
    return { ...model, hovered: -1 };
  }
  return { ...model, hovered: index };
}

function clampLength(length: number): number {
  if (!Number.isInteger(length)) return MIN_LENGTH;
  return Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, length));
}
