// Stencil QT host — pure logic per ADR 002 §Stencil QT.
//
// Owns QtHostState (scalePitches cache, humanizeRng, driftState, params,
// notesOn, lastInputTime) and exposes methods the Max bridge calls.
// Returns NoteEvent arrays with delayMs already in ms (humanize already
// computed timingOffset against sourceStepDuration). The bridge schedules
// each event at `now + delayMs` (clamping negative delays). No Max API,
// no timers — fully testable under node --test.

import {
  buildScalePitches,
  diatonicShift,
  snapToChordTones,
  snapToScale,
  type HarmonyVoice,
  type MidiNote,
  type ScaleName,
} from "../engine/quantizer.ts";
import { seedRng, type RngState } from "../engine/rng.ts";
import {
  composeHumanize,
  NEUTRAL_DRIFT,
  type DriftState,
} from "./humanize.ts";

export type Channel = number; // 1..16
export type TriggerMode = "passthrough" | "root";
export type QtMode = "scale" | "chord" | "harmony";

const QT_MODES: readonly QtMode[] = ["scale", "chord", "harmony"];

// First-event step fallback. With no prior input, there is no rhythmic
// gap to derive sourceStepDuration from; 250 ms is generic across common
// tempos (16th at 60 BPM, 8th at 120 BPM, quarter at 240 BPM).
export const FIRST_EVENT_STEP_MS = 250;

export type NoteEvent =
  | { type: "noteOn"; pitch: MidiNote; velocity: number; channel: Channel; delayMs: number }
  | { type: "noteOff"; pitch: MidiNote; channel: Channel; delayMs: number }
  | { type: "notePulse"; pitch: MidiNote; velocity: number; delayMs: number };

export interface QtParams {
  scale: ScaleName;
  root: number; // 0..11
  mode: QtMode;
  humanizeVelocity: number; // 0..1
  humanizeGate: number; // 0..1
  humanizeTiming: number; // 0..1
  humanizeDrift: number; // 0..1
  outputLevel: number; // 0..1
  triggerMode: TriggerMode;
  inputChannel: number; // 0..16, 0 = omni
  controlChannel: number; // 1..16
  harmonyVoices: HarmonyVoice[]; // length 0..3 (UI exposes 3 slots)
  seed: number; // u31
}

export const DEFAULT_PARAMS: QtParams = {
  scale: "major",
  root: 0,
  mode: "scale",
  humanizeVelocity: 0,
  humanizeGate: 0,
  humanizeTiming: 0,
  humanizeDrift: 0,
  outputLevel: 1.0,
  triggerMode: "passthrough",
  inputChannel: 0,
  controlChannel: 16,
  harmonyVoices: [],
  seed: 42,
};

export type ParamKey = keyof QtParams;

function noteKey(pitch: number, channel: number): string {
  return `${pitch}:${channel}`;
}

export class QtHost {
  private params: QtParams;
  private scalePitches: MidiNote[];
  private humanizeRng: RngState;
  private driftState: DriftState;
  private notesOn: Set<string>;
  private lastInputTime: number | null;
  // Chord-mode: controlChannel-held pitch set. chordContext is the
  // unique pitch-class projection. Stored as Set<pitch> (not pcs) so
  // we can correctly handle multiple octaves of the same pc — pc only
  // leaves the chord context when ALL its octave-instances are released.
  private controlHeldPitches: Set<MidiNote>;

  constructor(params: QtParams = DEFAULT_PARAMS) {
    this.params = { ...params, harmonyVoices: [...params.harmonyVoices] };
    this.scalePitches = buildScalePitches(this.params.scale, this.params.root);
    this.humanizeRng = seedRng(BigInt(this.params.seed));
    this.driftState = { ...NEUTRAL_DRIFT };
    this.notesOn = new Set();
    this.lastInputTime = null;
    this.controlHeldPitches = new Set();
  }

  private channelMatches(ch: number): boolean {
    return this.params.inputChannel === 0 || ch === this.params.inputChannel;
  }

  // Empty in mono v1: every emitted noteOn pairs with a scheduled noteOff
  // in the same call. notesOn is reserved for future polyphony / chord-mode
  // QT extensions where output gating spans multiple input events.
  private flushNotesOn(events: NoteEvent[]): void {
    for (const k of this.notesOn) {
      const [p, c] = k.split(":").map(Number);
      events.push({ type: "noteOff", pitch: p, channel: c, delayMs: 0 });
    }
    this.notesOn.clear();
  }

  noteIn(
    pitch: number,
    velocity: number,
    channel: number,
    nowMs: number,
  ): NoteEvent[] {
    // Chord mode dominates controlChannel semantics: the held set forms
    // the chord context, and controlChannel notes are consumed (no quantize
    // output, no lastInputTime update — control taps are not on the
    // musical timeline). triggerMode=root is suppressed for that channel.
    if (
      this.params.mode === "chord" &&
      channel === this.params.controlChannel
    ) {
      this.controlHeldPitches.add(pitch);
      return [];
    }

    // Root-mode short-circuit: controlChannel events update root and are
    // not forwarded to the quantize path. Does not update lastInputTime —
    // root taps are not "musical" events on the rhythmic timeline.
    if (
      this.params.triggerMode === "root" &&
      channel === this.params.controlChannel
    ) {
      this.params.root = pitch % 12;
      this.scalePitches = buildScalePitches(
        this.params.scale,
        this.params.root,
      );
      return [];
    }

    if (!this.channelMatches(channel)) return [];

    const events: NoteEvent[] = [];

    const sourceStepDuration =
      this.lastInputTime === null
        ? FIRST_EVENT_STEP_MS
        : nowMs - this.lastInputTime;
    this.lastInputTime = nowMs;

    const snapped = this.params.mode === "chord"
      ? snapToChordTones(pitch, this.computeChordContext(), this.scalePitches)
      : snapToScale(pitch, this.scalePitches);

    const out = composeHumanize(this.humanizeRng, this.driftState, {
      velocity: this.params.humanizeVelocity,
      gate: this.params.humanizeGate,
      timing: this.params.humanizeTiming,
      driftFactor: this.params.humanizeDrift,
      inputVelocity: velocity,
      outputLevel: this.params.outputLevel,
      outputGateBase: 1.0,
      sourceStepDuration,
    });
    this.humanizeRng = out.rng;
    this.driftState = out.driftState;

    const noteOnDelay = out.timingOffset;
    const noteOffDelay = noteOnDelay + out.gateFinal * sourceStepDuration;

    // Harmony mode appends parallel diatonic voices; all voices are pitches
    // of the *same* musical event, so they share velocity / timing / gate
    // (one humanize draw covers them all). Declared order is preserved so
    // the patcher's voice-1/2/3 widgets map predictably to output order.
    const pitches: MidiNote[] = [snapped];
    if (this.params.mode === "harmony") {
      for (const v of this.params.harmonyVoices) {
        pitches.push(
          diatonicShift(snapped, v.interval, v.direction, this.scalePitches),
        );
      }
    }

    for (const p of pitches) {
      events.push({
        type: "noteOn",
        pitch: p,
        velocity: out.velocityFinal,
        channel,
        delayMs: noteOnDelay,
      });
      events.push({
        type: "noteOff",
        pitch: p,
        channel,
        delayMs: noteOffDelay,
      });
      events.push({
        type: "notePulse",
        pitch: p,
        velocity: out.velocityFinal,
        delayMs: noteOnDelay,
      });
    }

    return events;
  }

  // Input-channel noteOffs do not gate output (output noteOff is scheduled
  // by humanize gate timer at noteIn dispatch). Chord-mode controlChannel
  // noteOffs DO matter: they release a held pitch from the chord context.
  noteOff(pitch: number, channel: number): NoteEvent[] {
    if (
      this.params.mode === "chord" &&
      channel === this.params.controlChannel
    ) {
      this.controlHeldPitches.delete(pitch);
    }
    return [];
  }

  transportStart(): NoteEvent[] {
    const events: NoteEvent[] = [];
    this.flushNotesOn(events);
    this.driftState = { ...NEUTRAL_DRIFT };
    this.lastInputTime = null;
    this.humanizeRng = seedRng(BigInt(this.params.seed));
    this.controlHeldPitches.clear();
    return events;
  }

  transportStop(): NoteEvent[] {
    const events: NoteEvent[] = [];
    this.flushNotesOn(events);
    this.lastInputTime = null;
    this.controlHeldPitches.clear();
    return events;
  }

  panic(): NoteEvent[] {
    const events: NoteEvent[] = [];
    this.flushNotesOn(events);
    this.controlHeldPitches.clear();
    return events;
  }

  setParam<K extends ParamKey>(key: K, value: QtParams[K]): NoteEvent[] {
    const events: NoteEvent[] = [];
    const flushKeys: ParamKey[] = ["scale", "root", "triggerMode", "mode"];
    if (flushKeys.includes(key)) {
      this.flushNotesOn(events);
    }
    if (key === "mode") {
      // Reject invalid mode (silent — bridge already validates, but
      // defense-in-depth here). Switching away from chord clears the
      // held set: chord context is meaningless outside chord mode and
      // would resurface stale on a later switch back.
      const v = value as QtMode;
      if (!QT_MODES.includes(v)) return events;
      if (this.params.mode === "chord" && v !== "chord") {
        this.controlHeldPitches.clear();
      }
      this.params.mode = v;
      return events;
    }
    if (key === "harmonyVoices") {
      // Defensive copy so external mutation of the bridge-side array does
      // not silently shift voicing on the host.
      this.params.harmonyVoices = [...(value as HarmonyVoice[])];
      return events;
    }
    this.params[key] = value;
    if (key === "scale" || key === "root") {
      this.scalePitches = buildScalePitches(
        this.params.scale,
        this.params.root,
      );
    }
    if (key === "seed") {
      this.humanizeRng = seedRng(BigInt(this.params.seed));
    }
    return events;
  }

  // Compute pitch-class chord context from the controlChannel held set.
  // pc enters when any octave of it is held; pc leaves when ALL its
  // octave-instances are released.
  private computeChordContext(): number[] {
    const pcs = new Set<number>();
    for (const p of this.controlHeldPitches) pcs.add(p % 12);
    return [...pcs];
  }

  // Inspection (for tests and bridge-side outlet emission).
  getScalePitches(): readonly MidiNote[] {
    return this.scalePitches;
  }
  getDriftState(): Readonly<DriftState> {
    return this.driftState;
  }
  getParams(): Readonly<QtParams> {
    return this.params;
  }
  getChordContext(): readonly number[] {
    return this.computeChordContext();
  }
}
