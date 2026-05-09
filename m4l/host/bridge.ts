// Pointsman bridge — Max protocol layer per ADR 002 §Host ↔ Max protocol.
//
// Pure JS/TS routing between the Max patch and the PointsmanHost class. All
// Max-specific I/O (Max.outlet, Max.addHandler, Date.now, setTimeout)
// is injected via deps so this module is testable under node:test.
//
// Pointsman differs from TM in two ways:
// - No `step` driver: events are MIDI-driven. The bridge passes
//   `deps.now()` per noteIn so the host can derive sourceStepDuration
//   from input timing.
// - Three event types from host: `noteOn` / `noteOff` / `notePulse`.
//   `noteOn` and `noteOff` go to the MIDI emit path; `notePulse` goes
//   to a side-channel outlet for the jsui scale keyboard (ADR 003).

import {
  buildScalePitches,
  type HarmonyDirection,
  type HarmonyInterval,
  type HarmonyVoice,
  type ScaleName,
} from "../engine/quantizer.ts";
import {
  DEFAULT_PARAMS,
  PointsmanHost,
  type NoteEvent,
  type PointsmanMode,
  type PointsmanParams,
  type TriggerMode,
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
];

const TRIGGER_MODES: readonly TriggerMode[] = ["passthrough", "root"];

const POINTSMAN_MODES: readonly PointsmanMode[] = ["scale", "chord", "harmony"];

// ADR 003 §Pointsman patcher harmony voices widget cluster: 6 live.menu widgets
// in the VOICES panel (3 voice slots × 2 fields), matching inboil's
// QuantizerSheet two-select-per-voice badge. Bridge maintains the
// 3-slot state and projects the dense HarmonyVoice[] to the host.
//
// - Interval enum (inboil display strings): "3rd" | "4th" | "5th" | "6th"
//   → mapped to int 3..6 via INTERVAL_FROM_STRING.
// - Direction enum: "off" | "above" | "below". "off" is the m4l
//   disabled state (replaces inboil's per-voice × remove button) and
//   filters that slot out of the projected list.
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

// MIDI domain guards: pitch 0..127, velocity 0..127, channel 0..16. Live's
// [midiparse] guarantees these ranges, but defense-in-depth here keeps the
// host from emitting pitch>127 to noteout (would silently truncate). Two
// notable looseness choices, both validated empirically against Live in
// v1.0.1:
// - NOT strict integer (Number.isFinite, not Number.isInteger): max-api
//   has been observed to drop the integer type tag on the way through,
//   even though midiparse upstream is int. Strict-integer dropped
//   notes silently.
// - Channel allows 0: track-internal MIDI from an upstream M4L device
//   (e.g. Stencil → Pointsman on the same track) arrives with
//   channel=0. Rejecting that drops every note from such a chain. The
//   host's channelMatches() already treats 0 as omni, so 0 is the
//   correct boundary value.
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
// any held quantize result). Non-flush keys (humanize*, seed, output,
// harmonyV*, channels) leave sounding pitches alone.
const FLUSH_PARAM_KEYS: ReadonlySet<string> = new Set([
  "scale",
  "root",
  "mode",
  "triggerMode",
]);

export class PointsmanBridge {
  private host: PointsmanHost;
  private deps: BridgeDeps;
  // Last emitted chord-context signature ("0,4,7" form). Dedups
  // chordChanged so unchanged sets don't trigger redundant jsui
  // redraws. "" matches the default (empty) chord context, so a fresh
  // bridge in non-chord mode never spurious-emits.
  private lastChordSig: string = "";
  // 3 voice slots × {interval, direction}. Slots persist regardless of
  // mode; rebuildHarmonyVoices() filters out direction="off" and pushes
  // the dense list to the host. Defaults: all off → empty harmonyVoices.
  private harmonySlots: HarmonySlot[] = Array.from(
    { length: HARMONY_SLOT_COUNT },
    () => ({ interval: 3, direction: "off" }),
  );

  // In-flight noteOff tracking. Each entry is keyed `${pitch}:${channel}`
  // and carries a `cancelled` flag the scheduled callback checks before
  // emitting. Cancellation entry points (transportStop / panic / setParam
  // on a flush-key) walk the map: emit immediate noteOff, set cancelled,
  // delete. Same-key noteOn re-trigger also auto-cancels — otherwise the
  // first scheduled noteOff fires mid-second-note and prematurely
  // silences it. See ADR 002 §B2 (audit fix landed in v1.0.1).
  private pendingNoteOffs: Map<
    string,
    { pitch: number; channel: number; cancelled: boolean }
  > = new Map();

  constructor(deps: BridgeDeps, options: BridgeOptions = {}) {
    this.deps = deps;
    this.host = new PointsmanHost({ ...DEFAULT_PARAMS, ...options.initialParams });
    // Seed initial UI state for the jsui keyboard. The "node.script ready"
    // handshake is NOT emitted here — that signal must fire only after
    // every Max.addHandler() in the entry script (pointsman.mjs),
    // otherwise the patcher's setParam cascade races handler installation
    // and dispatches drop with "Node script not ready". The 'ready'
    // outlet fires at the end of pointsman.mjs after addHandler
    // installation completes.
    this.emitScaleChanged();
  }

  // ---- Max → host handlers ----------------------------------------------

  noteIn(pitch: number, velocity: number, channel: number): void {
    if (!isMidiPitch(pitch) || !isMidiVelocity(velocity) || !isMidiChannel(channel)) {
      return;
    }
    const wasRoot =
      this.host.getParams().triggerMode === "root" &&
      channel === this.host.getParams().controlChannel;
    const events = this.host.noteIn(pitch, velocity, channel, this.deps.now());
    for (const ev of events) this.dispatch(ev);
    // Root-mode controlChannel events update the scale → re-emit so jsui
    // refreshes. The host returns [] in that path, so we detect via the
    // pre-call mode check.
    if (wasRoot) this.emitScaleChanged();
    this.maybeEmitChordChanged();
  }

  noteOff(pitch: number, channel: number): void {
    if (!isMidiPitch(pitch) || !isMidiChannel(channel)) return;
    for (const ev of this.host.noteOff(pitch, channel)) this.dispatch(ev);
    this.maybeEmitChordChanged();
  }

  panic(): void {
    this.flushInFlightNoteOffs();
    for (const ev of this.host.panic()) this.dispatch(ev);
    this.maybeEmitChordChanged();
  }

  transportStart(): void {
    for (const ev of this.host.transportStart()) this.dispatch(ev);
    this.maybeEmitChordChanged();
  }

  transportStop(): void {
    this.flushInFlightNoteOffs();
    for (const ev of this.host.transportStop()) this.dispatch(ev);
    this.maybeEmitChordChanged();
  }

  setParam(key: string, value: unknown): void {
    // Mode / scale / root / triggerMode invalidate any in-flight quantize
    // result — release sounding pitches before applying. Non-flush keys
    // (humanize*, seed, channels, harmonyV*, output) leave them alone.
    if (FLUSH_PARAM_KEYS.has(key)) {
      this.flushInFlightNoteOffs();
    }
    let scaleChanged = false;
    let modeChanged = false;
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
        // ADR 003 § quantize mode — 3-enum (scale | chord | harmony).
        // Host clears controlHeldPitches when switching away from chord;
        // the chordChanged emit below mirrors that to the renderer.
        const v = String(value);
        if (!POINTSMAN_MODES.includes(v as PointsmanMode)) return;
        events = this.host.setParam("mode", v as PointsmanMode);
        modeChanged = true;
        break;
      }
      case "humanizeVelocity":
      case "humanizeGate":
      case "humanizeTiming":
      case "humanizeDrift":
      case "outputLevel": {
        const v = Number(value);
        if (!Number.isFinite(v)) return;
        const clamped = Math.max(0, Math.min(1, v));
        events = this.host.setParam(key, clamped);
        break;
      }
      case "triggerMode": {
        const v = String(value);
        if (!TRIGGER_MODES.includes(v as TriggerMode)) return;
        events = this.host.setParam("triggerMode", v as TriggerMode);
        break;
      }
      case "inputChannel": {
        const v = Number(value);
        if (!Number.isInteger(v) || v < 0 || v > 16) return;
        events = this.host.setParam("inputChannel", v);
        break;
      }
      case "controlChannel": {
        const v = Number(value);
        if (!Number.isInteger(v) || v < 1 || v > 16) return;
        events = this.host.setParam("controlChannel", v);
        break;
      }
      case "seed": {
        const v = Number(value);
        if (!Number.isInteger(v) || v < 0 || v > 0x7fffffff) return;
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
    if (modeChanged) this.maybeEmitChordChanged();
  }

  // ---- internal ---------------------------------------------------------

  private dispatch(ev: NoteEvent): void {
    // Negative delays are clamped to 0 (immediate dispatch). The input
    // event has already arrived, so the bridge cannot dispatch in the past.
    const delay = ev.delayMs > 0 ? ev.delayMs : 0;
    if (ev.type === "noteOn") {
      // Same pitch+channel re-trigger: cancel any pending noteOff so it
      // doesn't fire mid-new-note. Without this, mash-the-same-key within
      // the gate window prematurely silences the second hit.
      this.cancelPending(noteKey(ev.pitch, ev.channel));
      if (delay === 0) {
        this.emit(ev);
        return;
      }
      this.deps.scheduleAfter(delay, () => this.emit(ev));
      return;
    }
    if (ev.type === "noteOff") {
      const key = noteKey(ev.pitch, ev.channel);
      if (delay === 0) {
        // Immediate noteOff: covers any pending noteOff for the same
        // key (e.g., a flushed in-flight emission).
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

  // Cancel a pending noteOff for `key` (no-op if none). Does NOT emit a
  // noteOff — caller decides whether the cancellation is paired with a
  // replacement emit (re-trigger / immediate noteOff) or a flush.
  private cancelPending(key: string): void {
    const entry = this.pendingNoteOffs.get(key);
    if (!entry) return;
    entry.cancelled = true;
    this.pendingNoteOffs.delete(key);
  }

  // Cancellation entry point: emit immediate noteOff for every sounding
  // pitch and clear the pending map. Called from transportStop / panic /
  // setParam (on a flush-key) so the host doesn't have to track which
  // noteOns were emitted but not yet released.
  private flushInFlightNoteOffs(): void {
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

  // Emit `chordChanged <pcs...>` when the controlChannel-held pitch-class
  // set changes (ADR 003 §scale keyboard interaction). Sorted ascending
  // for determinism. Dedups on the joined-string signature to avoid
  // redundant jsui redraws when the underlying held pitches change but
  // their pitch-class projection does not (e.g., re-trigger of a held
  // pitch, or release of one octave while the same pc is still held in
  // another octave).
  private maybeEmitChordChanged(): void {
    const sorted = [...this.host.getChordContext()].sort((a, b) => a - b);
    const sig = sorted.join(",");
    if (sig === this.lastChordSig) return;
    this.lastChordSig = sig;
    this.deps.emitOutlet("chordChanged", ...sorted);
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
// scale state without reaching into the host. Intentional weak coupling
// for tools that want to introspect (e.g., a future `dump` debug command).
export { buildScalePitches };
