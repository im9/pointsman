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
  type ScaleName,
} from "../engine/quantizer.ts";
import {
  DEFAULT_PARAMS,
  QtHost,
  type NoteEvent,
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

export class QtBridge {
  private host: QtHost;
  private deps: BridgeDeps;

  constructor(deps: BridgeDeps, options: BridgeOptions = {}) {
    this.deps = deps;
    this.host = new QtHost({ ...DEFAULT_PARAMS, ...options.initialParams });
    // Seed initial UI state for the jsui keyboard. The "node.script ready"
    // handshake is NOT emitted here — that signal must fire only after
    // every Max.addHandler() in the entry script (stencil-qt.mjs),
    // otherwise the patcher's setParam cascade races handler installation
    // and dispatches drop with "Node script not ready". Mirrors TM:
    // see m4l/host-tm/bridge.ts constructor and stencil-qt.mjs's
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
  }

  noteOff(pitch: number, channel: number): void {
    if (!Number.isFinite(pitch) || !Number.isFinite(channel)) return;
    for (const ev of this.host.noteOff(pitch, channel)) this.dispatch(ev);
  }

  panic(): void {
    for (const ev of this.host.panic()) this.dispatch(ev);
  }

  transportStart(): void {
    for (const ev of this.host.transportStart()) this.dispatch(ev);
  }

  transportStop(): void {
    for (const ev of this.host.transportStop()) this.dispatch(ev);
  }

  setParam(key: string, value: unknown): void {
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
}

// Re-export buildScalePitches so callers can sanity-check the bridge's
// scale state without reaching into the host. Intentional weak coupling
// for tools that want to introspect (e.g., a future `dump` debug command).
export { buildScalePitches };
