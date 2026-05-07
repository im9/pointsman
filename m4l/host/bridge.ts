// Stencil QT bridge — Max protocol layer per ADR 002 §Host ↔ Max protocol.
//
// Pure JS/TS routing between the Max patch and the QtHost class. All
// Max-specific I/O (Max.outlet, Max.addHandler, Date.now, setTimeout)
// is injected via deps so this module is testable under node:test.
//
// QT differs from TM in two ways:
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
  QtHost,
  type NoteEvent,
  type QtMode,
  type QtParams,
  type TriggerMode,
} from "./host.ts";

export interface BridgeDeps {
  emitNote: (pitch: number, velocity: number, channel: number) => void;
  emitOutlet: (channel: string, ...args: Array<number | string>) => void;
  now: () => number;
  scheduleAfter: (ms: number, cb: () => void) => void;
}

export interface BridgeOptions {
  initialParams?: Partial<QtParams>;
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

const QT_MODES: readonly QtMode[] = ["scale", "chord", "harmony"];

// ADR 003 §QT patcher harmony voices widget cluster: 6 live.menu widgets
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

export class QtBridge {
  private host: QtHost;
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

  constructor(deps: BridgeDeps, options: BridgeOptions = {}) {
    this.deps = deps;
    this.host = new QtHost({ ...DEFAULT_PARAMS, ...options.initialParams });
    // Seed initial UI state for the jsui keyboard. The "node.script ready"
    // handshake is NOT emitted here — that signal must fire only after
    // every Max.addHandler() in the entry script (pointsman.mjs),
    // otherwise the patcher's setParam cascade races handler installation
    // and dispatches drop with "Node script not ready". Mirrors TM:
    // see m4l/host-tm/bridge.ts constructor and pointsman.mjs's
    // end-of-script Max.outlet('ready', 1).
    this.emitScaleChanged();
  }

  // ---- Max → host handlers ----------------------------------------------

  noteIn(pitch: number, velocity: number, channel: number): void {
    if (
      !Number.isFinite(pitch) ||
      !Number.isFinite(velocity) ||
      !Number.isFinite(channel)
    ) {
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
    if (!Number.isFinite(pitch) || !Number.isFinite(channel)) return;
    for (const ev of this.host.noteOff(pitch, channel)) this.dispatch(ev);
    this.maybeEmitChordChanged();
  }

  panic(): void {
    for (const ev of this.host.panic()) this.dispatch(ev);
    this.maybeEmitChordChanged();
  }

  transportStart(): void {
    for (const ev of this.host.transportStart()) this.dispatch(ev);
    this.maybeEmitChordChanged();
  }

  transportStop(): void {
    for (const ev of this.host.transportStop()) this.dispatch(ev);
    this.maybeEmitChordChanged();
  }

  setParam(key: string, value: unknown): void {
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
        // ADR 003 §QT quantize mode — 3-enum (scale | chord | harmony).
        // Host clears controlHeldPitches when switching away from chord;
        // the chordChanged emit below mirrors that to the renderer.
        const v = String(value);
        if (!QT_MODES.includes(v as QtMode)) return;
        events = this.host.setParam("mode", v as QtMode);
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
    if (delay === 0) {
      this.emit(ev);
      return;
    }
    this.deps.scheduleAfter(delay, () => this.emit(ev));
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
  // set changes (ADR 003 §QT scale keyboard interaction). Sorted ascending
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
