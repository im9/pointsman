// Pointsman host — v2 surface (concept.md §"Parameter surface").
//
// Owns PointsmanHostState (scalePitches cache, humanizeRng, driftState,
// params, notesOn, lastInputTime) and exposes methods the Max bridge
// calls. Returns NoteEvent arrays with delayMs already in ms (humanize
// already computed timingOffset against sourceStepDuration). The bridge
// schedules each event at `now + delayMs` (clamping negative delays).
// No Max API, no timers — fully testable under node --test.
//
// v2 changes vs v1 (m4l Phase 5 handoff):
//   - mode: "scale" | "chord" (drop "harmony"). chord = 1-in-N-out
//     expansion (formerly harmony semantic), with default voices = 1-3-5.
//   - dropped pids: humanizeVelocity/Gate/Timing, humanizeDrift,
//     outputLevel, triggerMode, controlChannel.
//   - added pids: feel / drift (single-amp humanize per concept.md).
//   - random seed per fresh instance (concept.md §"Per-event humanize").
//   - non-matching `inputChannel` notes pass through verbatim (MPE).

import {
  buildScalePitches,
  diatonicShift,
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

export type Channel = number; // 1..16 (0 = omni boundary value)
export type PointsmanMode = "scale" | "chord";

const POINTSMAN_MODES: readonly PointsmanMode[] = ["scale", "chord"];

// First-event step fallback. With no prior input, there is no rhythmic
// gap to derive sourceStepDuration from; 250 ms is generic across common
// tempos (16th at 60 BPM, 8th at 120 BPM, quarter at 240 BPM).
export const FIRST_EVENT_STEP_MS = 250;

// concept.md §"Parameter surface": harmonyVoices length is 0..3. The
// bridge's 3-slot widget cluster naturally caps emitted voices at 3, but
// setParam / initialParams are public ingress and must clamp too —
// mirrors the vst setHarmonyVoices() boundary.
export const MAX_HARMONY_VOICES = 3;

// Random seed range bound: APVTS-style hosts (vst target) store
// parameter values as IEEE-754 single-precision floats; every integer in
// [0, 2^24] is exactly representable, so seeds round-trip bit-identical.
// m4l mirrors this for cross-target preset compatibility (concept.md
// §"Parameter surface").
const SEED_MAX = 0xffffff;

export type NoteEvent =
  | { type: "noteOn"; pitch: MidiNote; velocity: number; channel: Channel; delayMs: number }
  | { type: "noteOff"; pitch: MidiNote; channel: Channel; delayMs: number }
  | { type: "notePulse"; pitch: MidiNote; velocity: number; delayMs: number };

export interface PointsmanParams {
  scale: ScaleName;
  root: number;            // 0..11
  mode: PointsmanMode;
  feel: number;            // 0..1
  drift: number;           // 0..1
  inputChannel: number;    // 0..16, 0 = omni
  harmonyVoices: HarmonyVoice[]; // length 0..3
  seed: number;            // 0..2^24-1 (float32 round-trip safe)
}

// DEFAULT_PARAMS captures the v2 cold-start surface. Note that seed=0 here
// is a placeholder for the type — the PointsmanHost constructor draws a
// random seed when no explicit value is supplied via initialParams.
export const DEFAULT_PARAMS: PointsmanParams = {
  scale: "major",
  root: 0,
  mode: "scale",
  feel: 0,
  drift: 0,
  inputChannel: 0,
  // concept.md §"Scale and chord modes": default 1-3-5 triad so chord
  // mode ships "single note becomes a chord" out of the box.
  harmonyVoices: [
    { interval: 3, direction: "above" },
    { interval: 5, direction: "above" },
  ],
  seed: 0,
};

export type ParamKey = keyof PointsmanParams;

function randomSeed(): number {
  // concept.md §"Per-event humanize": random per fresh instance, range
  // 0..2^24-1 (float32 exact-representation).
  return Math.floor(Math.random() * (SEED_MAX + 1));
}

export class PointsmanHost {
  private params: PointsmanParams;
  private scalePitches: MidiNote[];
  private humanizeRng: RngState;
  private driftState: DriftState;
  private notesOn: Set<string>;
  private lastInputTime: number | null;

  constructor(initialParams: Partial<PointsmanParams> = {}) {
    // Random seed unless caller explicitly supplied one (preset-load
    // path). The constructor is the single source of "new instance ==
    // new seed"; setParam("seed", N) overrides at any later point.
    const seed = initialParams.seed ?? randomSeed();
    const voices = (initialParams.harmonyVoices ?? DEFAULT_PARAMS.harmonyVoices)
      .slice(0, MAX_HARMONY_VOICES);
    this.params = {
      ...DEFAULT_PARAMS,
      ...initialParams,
      harmonyVoices: [...voices],
      seed,
    };
    this.scalePitches = buildScalePitches(this.params.scale, this.params.root);
    this.humanizeRng = seedRng(BigInt(this.params.seed));
    this.driftState = { ...NEUTRAL_DRIFT };
    this.notesOn = new Set();
    this.lastInputTime = null;
  }

  private channelMatches(ch: number): boolean {
    return this.params.inputChannel === 0 || ch === this.params.inputChannel;
  }

  // Empty in mono v1: every emitted noteOn pairs with a scheduled noteOff
  // in the same call. notesOn is reserved for future polyphony.
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
    // MPE / inputChannel pass-through: notes on non-matching channels are
    // forwarded verbatim (no quantize, no humanize, no chord expansion).
    // concept.md §"Input handling".
    if (!this.channelMatches(channel)) {
      return [{ type: "noteOn", pitch, velocity, channel, delayMs: 0 }];
    }

    const events: NoteEvent[] = [];

    const sourceStepDuration =
      this.lastInputTime === null
        ? FIRST_EVENT_STEP_MS
        : nowMs - this.lastInputTime;
    this.lastInputTime = nowMs;

    // Both modes start with scale-snap. Chord mode then expands across
    // harmonyVoices; scale mode emits only the primary.
    const snapped = snapToScale(pitch, this.scalePitches);

    const out = composeHumanize(this.humanizeRng, this.driftState, {
      feel: this.params.feel,
      drift: this.params.drift,
      inputVelocity: velocity,
      sourceStepDuration,
    });
    this.humanizeRng = out.rng;
    this.driftState = out.driftState;

    const noteOnDelay = out.timingOffset;
    const noteOffDelay = noteOnDelay + out.gateFinal * sourceStepDuration;

    // chord = 1-in-N-out: primary + N diatonic voices.
    // scale = 1-in-1-out: primary only.
    const pitches: MidiNote[] = [snapped];
    if (this.params.mode === "chord") {
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

  // Input noteOffs on the matching channel are silently consumed (output
  // noteOff is scheduled by humanize gate at noteIn dispatch). Non-matching
  // channels pass through (paired with the pass-through noteOn).
  noteOff(pitch: number, channel: number): NoteEvent[] {
    if (!this.channelMatches(channel)) {
      return [{ type: "noteOff", pitch, channel, delayMs: 0 }];
    }
    return [];
  }

  transportStart(): NoteEvent[] {
    const events: NoteEvent[] = [];
    this.flushNotesOn(events);
    this.driftState = { ...NEUTRAL_DRIFT };
    this.lastInputTime = null;
    this.humanizeRng = seedRng(BigInt(this.params.seed));
    return events;
  }

  transportStop(): NoteEvent[] {
    const events: NoteEvent[] = [];
    this.flushNotesOn(events);
    this.lastInputTime = null;
    return events;
  }

  panic(): NoteEvent[] {
    const events: NoteEvent[] = [];
    this.flushNotesOn(events);
    return events;
  }

  setParam<K extends ParamKey>(key: K, value: PointsmanParams[K]): NoteEvent[] {
    const events: NoteEvent[] = [];
    const flushKeys: ParamKey[] = ["scale", "root", "mode"];
    if (flushKeys.includes(key)) {
      this.flushNotesOn(events);
    }
    if (key === "mode") {
      const v = value as PointsmanMode;
      // Silent rejection for removed / unknown values — the bridge is the
      // user-facing v1-discard log boundary.
      if (!POINTSMAN_MODES.includes(v)) return events;
      this.params.mode = v;
      return events;
    }
    if (key === "harmonyVoices") {
      // Defensive copy so external mutation of the bridge-side array does
      // not silently shift voicing on the host. Clamp to MAX_HARMONY_VOICES
      // — the bridge caps at 3 today via its slot widget, but this is
      // public API and must enforce the contract independently.
      this.params.harmonyVoices = [...(value as HarmonyVoice[])]
        .slice(0, MAX_HARMONY_VOICES);
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

  // Inspection (for tests and bridge-side outlet emission).
  getScalePitches(): readonly MidiNote[] {
    return this.scalePitches;
  }
  getDriftState(): Readonly<DriftState> {
    return this.driftState;
  }
  getParams(): Readonly<PointsmanParams> {
    return this.params;
  }
}
