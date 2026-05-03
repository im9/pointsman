#!/usr/bin/env node
// Bake `m4l/Stencil-${dev}.maxpat` into `m4l/Stencil-${dev}.amxd`.
//
// Per ADR 004 §Bake script. Ported from oedipa with two changes:
// 1. Accepts `argv[2] in {TM, QT}` (validated; reject else).
// 2. Resolves I/O as `m4l/Stencil-${dev}.maxpat` ->
//    `m4l/Stencil-${dev}.amxd` (flat, matches oedipa's `m4l/Oedipa.amxd`).
//
// Why hand-build the AMPF wrapper rather than reuse Max's clipboard paste:
// pasting boxes into an existing .amxd transfers boxes only, NOT
// patcher-level attributes (openinpresentation, devicewidth, default_*,
// gridsize, ...). To get the full .maxpat into the .amxd we synthesize
// the AMPF wrapper bytes from scratch. The header layout is documented
// inline below; verified empirically against an `.amxd` Max wrote
// (oedipa) byte-for-byte at the header / trailer offsets.
//
// AMPF layout (verified against oedipa's Max-written `.amxd`):
//   bytes 0..3       : "ampf"
//   bytes 4..7       : LE uint32 = 4   (format version)
//   bytes 8..11      : "mmmm"          (container magic)
//   bytes 12..15     : "ptch"          (patcher chunk magic)
//   bytes 16..19     : LE uint32       = JSON length + 2 (chunk size = JSON + trailer)
//   bytes 20..len-3  : UTF-8 JSON      (the .maxpat verbatim, starts "{", ends "}")
//   byte  len-2      : 0x0a            ("\n")
//   byte  len-1      : 0x00            (null terminator)
//
// Usage:
//   node scripts/maxpat-to-amxd.mjs TM            # writes m4l/Stencil-TM.amxd
//   node scripts/maxpat-to-amxd.mjs TM --check    # exit 1 if .amxd would change
//   node scripts/maxpat-to-amxd.mjs QT            # symmetric for QT
//
// Exported `bake({ device, check })` is also called by the bake-script
// tests; CLI behavior delegates to it.

import { readFile, writeFile, access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HEADER_SIZE = 20
export const SIZE_OFFSET = 16
export const TRAILER = Buffer.from([0x0a, 0x00])
const MAGIC_AMPF = Buffer.from('ampf', 'ascii')
const MAGIC_MMMM = Buffer.from('mmmm', 'ascii')
const MAGIC_PTCH = Buffer.from('ptch', 'ascii')
const FORMAT_VERSION = 4

export const VALID_DEVICES = /** @type {const} */ (['TM', 'QT'])

// Build the AMPF wrapper around the .maxpat JSON. Pure function: takes
// the JSON Buffer, returns the .amxd Buffer. No I/O.
export function wrapMaxpatJson(maxpatJson) {
  if (!Buffer.isBuffer(maxpatJson)) {
    throw new TypeError('maxpatJson must be a Buffer')
  }
  const header = Buffer.alloc(HEADER_SIZE)
  MAGIC_AMPF.copy(header, 0)
  header.writeUInt32LE(FORMAT_VERSION, 4)
  MAGIC_MMMM.copy(header, 8)
  MAGIC_PTCH.copy(header, 12)
  header.writeUInt32LE(maxpatJson.length + TRAILER.length, SIZE_OFFSET)
  return Buffer.concat([header, maxpatJson, TRAILER])
}

// Inverse of wrapMaxpatJson — used by tests to round-trip and by guard
// checks that need to read the JSON back out of an `.amxd`.
export function unwrapAmxd(amxd) {
  if (!Buffer.isBuffer(amxd)) {
    throw new TypeError('amxd must be a Buffer')
  }
  if (amxd.length < HEADER_SIZE + TRAILER.length) {
    throw new Error(`amxd too short to contain AMPF wrapper (${amxd.length} bytes)`)
  }
  if (amxd.subarray(0, 4).toString('ascii') !== 'ampf') {
    throw new Error('amxd does not start with "ampf" magic')
  }
  if (amxd.subarray(8, 12).toString('ascii') !== 'mmmm') {
    throw new Error('amxd missing "mmmm" container magic')
  }
  if (amxd.subarray(12, 16).toString('ascii') !== 'ptch') {
    throw new Error('amxd missing "ptch" chunk magic')
  }
  const declaredChunkSize = amxd.readUInt32LE(SIZE_OFFSET)
  const jsonEnd = amxd.length - TRAILER.length
  const actualChunkSize = jsonEnd - HEADER_SIZE + TRAILER.length
  if (declaredChunkSize !== actualChunkSize) {
    throw new Error(
      `amxd chunk size mismatch: header says ${declaredChunkSize}, actual ${actualChunkSize}`,
    )
  }
  if (amxd[jsonEnd] !== TRAILER[0] || amxd[jsonEnd + 1] !== TRAILER[1]) {
    throw new Error('amxd does not end with the expected "\\n\\0" trailer')
  }
  return amxd.subarray(HEADER_SIZE, jsonEnd)
}

async function fileExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

// Bake one device. Returns { wrote, prevSize, nextSize } in non-check
// mode and { upToDate, prevSize, nextSize } in check mode.
export async function bake({ device, check, m4lRoot }) {
  if (!VALID_DEVICES.includes(device)) {
    throw new Error(
      `unknown device "${device}"; expected one of ${VALID_DEVICES.join(', ')}`,
    )
  }
  const maxpatPath = resolve(m4lRoot, `Stencil-${device}.maxpat`)
  const amxdPath = resolve(m4lRoot, `Stencil-${device}.amxd`)
  const maxpat = await readFile(maxpatPath)

  // Validate JSON before shipping a broken .amxd to Live. Parse cost is
  // negligible compared to the round-trip via Live's loader.
  try {
    JSON.parse(maxpat.toString('utf8'))
  } catch (e) {
    throw new Error(`${maxpatPath} is not valid JSON: ${e.message}`)
  }

  const amxd = wrapMaxpatJson(maxpat)
  const prev = (await fileExists(amxdPath)) ? await readFile(amxdPath) : null

  if (check) {
    const upToDate = prev !== null && prev.equals(amxd)
    return {
      upToDate,
      prevSize: prev?.length ?? 0,
      nextSize: amxd.length,
      maxpatPath,
      amxdPath,
    }
  }

  await writeFile(amxdPath, amxd)
  return {
    wrote: true,
    prevSize: prev?.length ?? 0,
    nextSize: amxd.length,
    maxpatPath,
    amxdPath,
  }
}

// CLI guard — only run main when invoked directly (not when imported by tests).
const invokedAsCli = (() => {
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
  } catch {
    return false
  }
})()

if (invokedAsCli) {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const device = args.find((a) => !a.startsWith('--'))
  if (!device) {
    console.error('usage: maxpat-to-amxd.mjs <TM|QT> [--check]')
    process.exit(2)
  }
  if (!VALID_DEVICES.includes(device)) {
    console.error(`unknown device "${device}"; expected one of ${VALID_DEVICES.join(', ')}`)
    process.exit(2)
  }
  const m4lRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  try {
    const r = await bake({ device, check, m4lRoot })
    if (check) {
      if (r.upToDate) {
        console.log(`Stencil-${device}.amxd is up to date.`)
        process.exit(0)
      } else {
        console.log(
          `Stencil-${device}.amxd differs from baked .maxpat (${r.prevSize} -> ${r.nextSize} bytes).`,
        )
        process.exit(1)
      }
    } else {
      console.log(
        `Wrote ${r.amxdPath} (${r.nextSize} bytes; header ${HEADER_SIZE} + JSON ${r.nextSize - HEADER_SIZE - TRAILER.length} + trailer ${TRAILER.length}).`,
      )
    }
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
