// Pointsman bridge — v2 surface protocol layer.
//
// Pure JS/TS routing between the Max patch and the PointsmanHost class.
// All Max-specific I/O (Max.outlet, Max.addHandler, Date.now, setTimeout)
// is injected via deps so this module is testable under node:test.
//
// v2 changes vs v1 (m4l Phase 5 handoff):
//   - mode enum {scale, chord} (drop "harmony")
//   - removed pids: humanizeVelocity/Gate/Timing/Drift, outputLevel,
//     triggerMode, controlChannel — incoming setParam for any of these is
//     a silent no-op (concept.md §"Parameter surface" v2 removes section)
//     with a single console.warn the first time we see one (stale .maxpat
//     or pre-v2 preset).
//   - added pids: feel / drift (concept.md §"Per-event humanize")
//   - chordChanged outlet removed (no held-context concept)
//   - random seed at construction (unless overridden via initialParams)
//
// Pointsman differs from a TM device:
//   - No `step` driver: events are MIDI-driven. The bridge passes
//     `deps.now()` per noteIn so the host can derive sourceStepDuration
//     from input timing.
//   - Three event types from host: `noteOn` / `noteOff` / `notePulse`.
//     `noteOn` and `noteOff` go to the MIDI emit path; `notePulse` goes
//     to a side-channel outlet for the jsui scale keyboard.

import {
  buildScalePitches,
  type HarmonyDirection,
  type HarmonyInterval,
  type HarmonyVoice,
  type ScaleName,
} from "../engine/quantizer.ts";
import {
  PointsmanHost,
  type NoteEvent,
  type PointsmanMode,
  type PointsmanParams,
} from "./host.ts";

export interface BridgeDeps {
  emitNote: (pitch: number, velocity: number, channel: number) => void;
  emitOutlet: (channel: string, ...args: Array<number | string>) => void;
  now: () => number;
  scheduleAfter: (ms: number, cb: () => void) => void;
}

export interface BridgeOptions {
  initialParams?: Partial<PointsmanParams>;
}

const SCALE_NAMES: readonly ScaleName[] = [
  "major",
  "minor",
  "dorian",
  "phrygian",
  "lydian",
  "mixolydian",
  "locrian",
  "pentatonic",
  "minor-pentatonic",
  "blues",
  "harmonic",
  "melodic",
  "whole",
  "chromatic",
  "chromatic-half",
  "phrygian-dominant",
];

const POINTSMAN_MODES: readonly PointsmanMode[] = ["scale", "chord"];

// 3 live.menu pairs (interval + direction) per slot. v2 defaults:
//   V1 = { 3rd, above }
//   V2 = { 5th, above }
//   V3 = { 3rd, off }
// → projected harmonyVoices = [{3,above},{5,above}] = 1-3-5 triad.
type HarmonySlotDirection = "off" | HarmonyDirection;
const HARMONY_SLOT_COUNT = 3;
const HARMONY_SLOT_DIRECTIONS: readonly HarmonySlotDirection[] = ["off", "above", "below"];
const INTERVAL_FROM_STRING: Readonly<Record<string, HarmonyInterval>> = {
  "3rd": 3,
  "4th": 4,
  "5th": 5,
  "6th": 6,
};

interface HarmonySlot {
  interval: HarmonyInterval;
  direction: HarmonySlotDirection;
}

const DEFAULT_HARMONY_SLOTS: readonly HarmonySlot[] = [
  { interval: 3, direction: "above" },
  { interval: 5, direction: "above" },
  { interval: 3, direction: "off" },
];

// MIDI domain guards: pitch 0..127, velocity 0..127, channel 0..16. Live's
// [midiparse] guarantees these ranges, but defense-in-depth keeps the host
// from emitting pitch>127 to noteout. Looseness choices, both validated
// empirically against Live in v1.0.1:
// - NOT strict integer (Number.isFinite, not Number.isInteger): max-api
//   has been observed to drop the integer type tag in transit.
// - Channel allows 0: track-internal MIDI from an upstream M4L device
//   (e.g. Stencil → Pointsman on the same track) arrives with channel=0.
const isMidiPitch = (n: number): boolean =>
  Number.isFinite(n) && n >= 0 && n <= 127;
const isMidiVelocity = (n: number): boolean =>
  Number.isFinite(n) && n >= 0 && n <= 127;
const isMidiChannel = (n: number): boolean =>
  Number.isFinite(n) && n >= 0 && n <= 16;

const noteKey = (pitch: number, channel: number): string =>
  `${pitch}:${channel}`;

// setParam keys that require flushing in-flight noteOffs (mirror of the
// host's flushKeys list — these are the params whose change invalidates
// any held quantize result).
const FLUSH_PARAM_KEYS: ReadonlySet<string> = new Set([
  "scale",
  "root",
  "mode",
]);

// Removed pids (concept.md §"Parameter surface" v2 removes section). An
// incoming setParam for any of these is a stale-state message from an
// out-of-date .maxpat or pre-v2 preset; bridge logs once per pid and
// otherwise silently no-ops.
const REMOVED_PIDS: ReadonlySet<string> = new Set([
  "humanizeVelocity",
  "humanizeGate",
  "humanizeTiming",
  "humanizeDrift",
  "outputLevel",
  "triggerMode",
  "controlChannel",
]);

export class PointsmanBridge {
  private host: PointsmanHost;
  private deps: BridgeDeps;
  private harmonySlots: HarmonySlot[] = DEFAULT_HARMONY_SLOTS.map((s) => ({ ...s }));

  // First-time-seen tracker for removed-pid setParam warnings. Avoids
  // spamming the Max console when a stale patch fires its initial pid
  // cascade — one log per unique pid is enough signal.
  private warnedRemovedPids: Set<string> = new Set();

  // In-flight noteOn / noteOff tracking. Each entry is keyed
  // `${pitch}:${channel}` and carries a `cancelled` flag the scheduled
  // callback checks before emitting.
  //
  // pendingNoteOns: humanize timing can push a noteOn into the future
  // (delay > 0). If panic / transportStop arrives between schedule and
  // fire, the noteOn must not be played — otherwise the note sounds AFTER
  // the panic and the paired pendingNoteOff finally silences it, audible
  // as a brief blip post-panic. VST emitPanicTo clears its `pending_`
  // vector for the same reason; this is the m4l mirror.
  //
  // pendingNoteOffs: paired with an already-emitted (sounding) noteOn.
  // Cancellation entry points (transportStop / panic / setParam on a
  // flush-key) walk this map: emit immediate noteOff so any sounding
  // output is silenced. Same-key noteOn re-trigger also auto-cancels —
  // otherwise the first scheduled noteOff fires mid-second-note and
  // prematurely silences it.
  private pendingNoteOns: Map<
    string,
    { pitch: number; velocity: number; channel: number; cancelled: boolean }
  > = new Map();
  private pendingNoteOffs: Map<
    string,
    { pitch: number; channel: number; cancelled: boolean }
  > = new Map();

  constructor(deps: BridgeDeps, options: BridgeOptions = {}) {
    this.deps = deps;
    // Bridge passes initialParams (if any) through to the host. The host
    // draws a random seed when no explicit value is supplied — that is
    // the "fresh instance" path. Preset-load passes seed explicitly.
    // Note: we deliberately do NOT pre-merge DEFAULT_PARAMS here; the host
    // owns its own defaults, and pre-merging would clobber the
    // "seed === undefined → draw random" sentinel with the placeholder 0.
    this.host = new PointsmanHost(options.initialParams ?? {});
    // Seed initial UI state for the jsui keyboard. The "node.script ready"
    // handshake is NOT emitted here — it must fire only after every
    // Max.addHandler() in the entry script (pointsman.mjs), otherwise the
    // patcher's setParam cascade races handler installation and dispatches
    // drop with "Node script not ready".
    this.emitScaleChanged();
  }

  // ---- Max → host handlers ----------------------------------------------

  noteIn(pitch: number, velocity: number, channel: number): void {
    if (!isMidiPitch(pitch) || !isMidiVelocity(velocity) || !isMidiChannel(channel)) {
      return;
    }
    const events = this.host.noteIn(pitch, velocity, channel, this.deps.now());
    for (const ev of events) this.dispatch(ev);
  }

  noteOff(pitch: number, channel: number): void {
    if (!isMidiPitch(pitch) || !isMidiChannel(channel)) return;
    for (const ev of this.host.noteOff(pitch, channel)) this.dispatch(ev);
  }

  panic(): void {
    this.flushInFlight();
    for (const ev of this.host.panic()) this.dispatch(ev);
  }

  transportStart(): void {
    for (const ev of this.host.transportStart()) this.dispatch(ev);
  }

  transportStop(): void {
    this.flushInFlight();
    for (const ev of this.host.transportStop()) this.dispatch(ev);
  }

  setParam(key: string, value: unknown): void {
    // v1 → v2 discard: stale .maxpat / pre-v2 preset may fire setParam for
    // pids removed in Phase 5. Log once per pid then silent no-op so the
    // user sees the signal without console spam.
    if (REMOVED_PIDS.has(key)) {
      if (!this.warnedRemovedPids.has(key)) {
        this.warnedRemovedPids.add(key);
        // eslint-disable-next-line no-console
        console.warn(
          `Pointsman: discarding pre-v2 state (setParam ${key}=${String(value)})`,
        );
      }
      return;
    }

    // Mode / scale / root invalidate any in-flight quantize result —
    // release sounding pitches before applying.
    if (FLUSH_PARAM_KEYS.has(key)) {
      this.flushInFlight();
    }
    let scaleChanged = false;
    let events: NoteEvent[] | null = null;

    switch (key) {
      case "scale": {
        const v = String(value);
        if (!SCALE_NAMES.includes(v as ScaleName)) return;
        events = this.host.setParam("scale", v as ScaleName);
        scaleChanged = true;
        break;
      }
      case "root": {
        const v = Number(value);
        if (!Number.isInteger(v) || v < 0 || v > 11) return;
        events = this.host.setParam("root", v);
        scaleChanged = true;
        break;
      }
      case "mode": {
        const v = String(value);
        if (!POINTSMAN_MODES.includes(v as PointsmanMode)) return;
        events = this.host.setParam("mode", v as PointsmanMode);
        break;
      }
      case "feel":
      case "drift": {
        const v = Number(value);
        if (!Number.isFinite(v)) return;
        const clamped = Math.max(0, Math.min(1, v));
        events = this.host.setParam(key, clamped);
        break;
      }
      case "inputChannel": {
        const v = Number(value);
        if (!Number.isInteger(v) || v < 0 || v > 16) return;
        events = this.host.setParam("inputChannel", v);
        break;
      }
      case "seed": {
        // Range derivation: APVTS-style hosts (vst target) store
        // parameter values as IEEE-754 single-precision floats; every
        // integer in [0, 2^24] is exactly representable, so seed values
        // up to 0xffffff round-trip bit-identical. The m4l bridge mirrors
        // this bound for cross-target preset compatibility.
        const v = Number(value);
        if (!Number.isInteger(v) || v < 0 || v > 0xffffff) return;
        events = this.host.setParam("seed", v);
        break;
      }
      case "harmonyV1Interval":
      case "harmonyV2Interval":
      case "harmonyV3Interval": {
        // key.charAt(8) is the slot digit ("1" | "2" | "3"); subtract
        // 1 for the zero-based slot index.
        const idx = Number(key.charAt(8)) - 1;
        const v = INTERVAL_FROM_STRING[String(value)];
        if (v === undefined) return;
        this.harmonySlots[idx].interval = v;
        this.rebuildHarmonyVoices();
        return;
      }
      case "harmonyV1Direction":
      case "harmonyV2Direction":
      case "harmonyV3Direction": {
        const idx = Number(key.charAt(8)) - 1;
        const v = String(value);
        if (!HARMONY_SLOT_DIRECTIONS.includes(v as HarmonySlotDirection)) return;
        this.harmonySlots[idx].direction = v as HarmonySlotDirection;
        this.rebuildHarmonyVoices();
        return;
      }
      default:
        return;
    }

    if (events !== null) for (const ev of events) this.dispatch(ev);
    if (scaleChanged) this.emitScaleChanged();
  }

  // ---- internal ---------------------------------------------------------

  private dispatch(ev: NoteEvent): void {
    // Negative delays are clamped to 0 (immediate dispatch). The input
    // event has already arrived, so the bridge cannot dispatch in the past.
    const delay = ev.delayMs > 0 ? ev.delayMs : 0;
    if (ev.type === "noteOn") {
      // Same pitch+channel re-trigger: cancel any pending noteOn /
      // noteOff for that key so the prior schedule doesn't fire
      // mid-new-note.
      const key = noteKey(ev.pitch, ev.channel);
      this.cancelPending(key);
      if (delay === 0) {
        this.emit(ev);
        return;
      }
      const entry = {
        pitch: ev.pitch,
        velocity: ev.velocity,
        channel: ev.channel,
        cancelled: false,
      };
      this.pendingNoteOns.set(key, entry);
      this.deps.scheduleAfter(delay, () => {
        if (entry.cancelled) return;
        this.pendingNoteOns.delete(key);
        this.emit(ev);
      });
      return;
    }
    if (ev.type === "noteOff") {
      const key = noteKey(ev.pitch, ev.channel);
      if (delay === 0) {
        // Immediate noteOff: covers any pending noteOff for the same
        // key (e.g., a flushed in-flight emission, or pass-through
        // noteOff for non-matching channel).
        this.cancelPending(key);
        this.emit(ev);
        return;
      }
      const entry = {
        pitch: ev.pitch,
        channel: ev.channel,
        cancelled: false,
      };
      this.pendingNoteOffs.set(key, entry);
      this.deps.scheduleAfter(delay, () => {
        if (entry.cancelled) return;
        this.pendingNoteOffs.delete(key);
        this.emit(ev);
      });
      return;
    }
    // notePulse: not tracked (display-only side-channel).
    if (delay === 0) {
      this.emit(ev);
      return;
    }
    this.deps.scheduleAfter(delay, () => this.emit(ev));
  }

  // Cancel any pending noteOn / noteOff for `key` (no-op if none). Does
  // NOT emit a noteOff — caller decides whether the cancellation is paired
  // with a replacement emit (re-trigger / immediate noteOff) or a flush.
  private cancelPending(key: string): void {
    const on = this.pendingNoteOns.get(key);
    if (on) {
      on.cancelled = true;
      this.pendingNoteOns.delete(key);
    }
    const off = this.pendingNoteOffs.get(key);
    if (off) {
      off.cancelled = true;
      this.pendingNoteOffs.delete(key);
    }
  }

  // Cancellation entry point: cancel pending noteOns (they never sounded —
  // drop them), emit immediate noteOff for any sounding output (paired
  // with an already-fired noteOn, tracked via pendingNoteOffs), and clear
  // both maps. Called from transportStop / panic / setParam (on a
  // flush-key). Spurious noteOff emission avoided by recognising the
  // noteOn-also-pending case: if the noteOn for the same key never fired,
  // the matching noteOff is suppressed too.
  private flushInFlight(): void {
    for (const [key, entry] of this.pendingNoteOns) {
      entry.cancelled = true;
      const off = this.pendingNoteOffs.get(key);
      if (off) {
        off.cancelled = true;
        this.pendingNoteOffs.delete(key);
      }
    }
    this.pendingNoteOns.clear();
    for (const [, entry] of this.pendingNoteOffs) {
      entry.cancelled = true;
      this.deps.emitNote(entry.pitch, 0, entry.channel);
    }
    this.pendingNoteOffs.clear();
  }

  private emit(ev: NoteEvent): void {
    if (ev.type === "noteOn") {
      this.deps.emitNote(ev.pitch, ev.velocity, ev.channel);
      return;
    }
    if (ev.type === "noteOff") {
      this.deps.emitNote(ev.pitch, 0, ev.channel);
      return;
    }
    // notePulse → side-channel outlet for jsui keyboard pulse anim.
    this.deps.emitOutlet("notePulse", ev.pitch, ev.velocity);
  }

  private emitScaleChanged(): void {
    const p = this.host.getParams();
    this.deps.emitOutlet("scaleChanged", p.scale, p.root);
  }

  // Project the 3-slot state to a dense HarmonyVoice[] (filter "off",
  // map slot fields to engine voice fields) and push to the host. Host
  // defensive-copies the array so subsequent slot mutations don't alias.
  private rebuildHarmonyVoices(): void {
    const voices: HarmonyVoice[] = this.harmonySlots
      .filter(
        (s): s is { interval: HarmonyInterval; direction: HarmonyDirection } =>
          s.direction !== "off",
      )
      .map((s) => ({ interval: s.interval, direction: s.direction }));
    this.host.setParam("harmonyVoices", voices);
  }
}

// Re-export buildScalePitches so callers can sanity-check the bridge's
// scale state without reaching into the host. Intentional weak coupling.
export { buildScalePitches };

// Test-only inspector for setParam validation coverage. The bridge's
// setParam validates inputs before dispatching to host.setParam — to
// observe that an out-of-range value was rejected (no host mutation),
// tests need a public read of the host's current params snapshot.
// Mirrors the vst processor's `*ForTest` accessor convention.
export function getHostParamsForTest(b: PointsmanBridge): Readonly<PointsmanParams> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (b as any).host.getParams();
}

// Test-only accessors for the in-flight note tracking. Used to drive
// the panic / flush cancellation contract without depending on humanize
// timing landing in the scheduled path for a particular seed.
export function getPendingCountsForTest(b: PointsmanBridge): {
  noteOns: number;
  noteOffs: number;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const any_ = b as any;
  return {
    noteOns: any_.pendingNoteOns.size,
    noteOffs: any_.pendingNoteOffs.size,
  };
}

// Test-only direct dispatch — exercises the scheduled branch of
// dispatch() for arbitrary NoteEvents without having to coax the
// humanize layer into producing a positive timingOffset.
export function dispatchEventForTest(b: PointsmanBridge, ev: NoteEvent): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (b as any).dispatch(ev);
}
