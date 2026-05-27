// Pointsman host — v3 surface (ADR 004 — chord shape + arp).
//
// Owns PointsmanHostState (scalePitches cache, humanizeRng, driftState,
// params, notesOn, lastInputTime) and exposes methods the Max bridge
// calls. Returns NoteEvent arrays with delayMs already in ms (humanize
// already computed timingOffset against sourceStepDuration). The bridge
// schedules each event at `now + delayMs` (clamping negative delays).
// No Max API, no timers — fully testable under node --test.
//
// v3 changes vs v2 (ADR 004 Phase 3-A):
//   - mode: "scale" | "chord" | "arp" (Arp added).
//   - harmonyVoices removed entirely (hard schema break per ADR 004
//     §Persistence). Chord-mode call site swapped from diatonic voice
//     stacking to intervallic chordShape preset.
//   - chordShape (default "maj") drives the 1-in-N-out expansion in
//     both chord mode and arp mode.
//   - 10 arp params (8 scalars + 2 16-step tables) added. mode=arp
//     currently shares the chord-mode emission branch as a Phase 3-A
//     placeholder — Phase 3-B replaces this with pool maintenance +
//     transportTick clock so the param surface stays audible end-to-end
//     during the transition.

import {
  applyChordShape,
  buildScalePitches,
  CHORD_SHAPE_ORDER,
  ARP_PATTERN_ORDER,
  ARP_RATES,
  snapToScale,
  type ArpPattern,
  type ArpRate,
  type ChordShape,
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
export type PointsmanMode = "scale" | "chord" | "arp";

const POINTSMAN_MODES: readonly PointsmanMode[] = ["scale", "chord", "arp"];

// First-event step fallback. With no prior input, there is no rhythmic
// gap to derive sourceStepDuration from; 250 ms is generic across common
// tempos (16th at 60 BPM, 8th at 120 BPM, quarter at 240 BPM).
export const FIRST_EVENT_STEP_MS = 250;

// ADR 004 §Groove layer: 16-step rhythm grid is the canonical accent /
// slide pattern length. Bound exported so the bridge + tests share one
// constant.
export const ARP_PATTERN_STEPS = 16;

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
  chordShape: ChordShape;  // ADR 004 intervallic preset (default "maj")
  // ── ADR 004 arp params (effective in mode == "arp") ──
  arpPattern: ArpPattern;      // emission shape over pool
  arpRate: ArpRate;            // step duration enum
  arpOctaves: number;          // 1..4
  arpStepRepeats: number;      // 1..8 (ratchet)
  arpGate: number;             // 0..1 fraction of step length the note sounds
  arpVariation: number;        // 0..1 character knob (rest / oct / flam)
  arpLatch: boolean;           // hold pool after all keys released
  arpSwing: number;            // 0..0.75, 16th-grid swing
  arpAccent: number[];         // length=16, each 0..127
  arpSlide: boolean[];         // length=16
  seed: number;                // 0..2^24-1 (float32 round-trip safe)
}

// Default flat accent (matches v0.1's typical output velocity) and flat
// (no-slide) defaults — chord mode UX is identical to v0.1 baseline when
// the arp surface is unused.
const DEFAULT_ARP_ACCENT: readonly number[] =
  Array.from({ length: ARP_PATTERN_STEPS }, () => 100);
const DEFAULT_ARP_SLIDE: readonly boolean[] =
  Array.from({ length: ARP_PATTERN_STEPS }, () => false);

// DEFAULT_PARAMS captures the v3 cold-start surface. Note that seed=0 here
// is a placeholder for the type — the PointsmanHost constructor draws a
// random seed when no explicit value is supplied via initialParams.
export const DEFAULT_PARAMS: PointsmanParams = {
  scale: "major",
  root: 0,
  mode: "scale",
  feel: 0,
  drift: 0,
  inputChannel: 0,
  // ADR 004 §Chord shape primitive: default "maj" (1-3-5) preserves v0.1's
  // 1-3-5 chord-mode behaviour on C major while making out-of-scale colour
  // tones possible on other scales.
  chordShape: "maj",
  // ADR 004 §Arpeggiator parameters: defaults from the spec table.
  arpPattern: "up",
  arpRate: "1/16",
  arpOctaves: 1,
  arpStepRepeats: 1,
  arpGate: 0.5,
  arpVariation: 0.0,
  arpLatch: false,
  arpSwing: 0.0,
  arpAccent: [...DEFAULT_ARP_ACCENT],
  arpSlide: [...DEFAULT_ARP_SLIDE],
  seed: 0,
};

export type ParamKey = keyof PointsmanParams;

function randomSeed(): number {
  // concept.md §"Per-event humanize": random per fresh instance, range
  // 0..2^24-1 (float32 exact-representation).
  return Math.floor(Math.random() * (SEED_MAX + 1));
}

function normalizeAccentTable(input: readonly unknown[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < ARP_PATTERN_STEPS; i++) {
    const raw = i < input.length ? Number(input[i]) : 100;
    const v = Number.isFinite(raw) ? Math.round(raw) : 100;
    out.push(Math.max(0, Math.min(127, v)));
  }
  return out;
}

function normalizeSlideTable(input: readonly unknown[]): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < ARP_PATTERN_STEPS; i++) {
    out.push(i < input.length ? Boolean(input[i]) : false);
  }
  return out;
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
    const accent = initialParams.arpAccent
      ? normalizeAccentTable(initialParams.arpAccent)
      : [...DEFAULT_ARP_ACCENT];
    const slide = initialParams.arpSlide
      ? normalizeSlideTable(initialParams.arpSlide)
      : [...DEFAULT_ARP_SLIDE];
    this.params = {
      ...DEFAULT_PARAMS,
      ...initialParams,
      arpAccent: accent,
      arpSlide: slide,
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
  // in the same call. notesOn is reserved for future polyphony (and the
  // arp clock in Phase 3-B, where output voices are emitted by the tick
  // scheduler rather than the noteIn cascade).
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

    // All three modes start with scale-snap. Chord / arp then expand the
    // snapped root via the active chordShape.
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

    // scale = 1-in-1-out (snapped pitch only).
    // chord / arp = 1-in-N-out via applyChordShape (intervallic). For arp
    // this is a Phase 3-A placeholder: the chord pulses on every noteIn
    // so the chordShape primitive is audible end-to-end while the arp
    // clock + pool maintenance land in Phase 3-B. The ADR-defined arp
    // behaviour (pool population on noteOn, tick-driven emission) replaces
    // this branch in Phase 3-B.
    const pitches: MidiNote[] = (this.params.mode === "scale")
      ? [snapped]
      : applyChordShape(snapped, this.params.chordShape);

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
    // Mode / scale / root change invalidates any in-flight quantize
    // result — release sounding pitches before applying. chordShape is in
    // this set because the chord branch reads it on the next noteIn and a
    // mid-hold chordShape change would otherwise mix old + new voicings.
    const flushKeys: ParamKey[] = ["scale", "root", "mode", "chordShape"];
    if (flushKeys.includes(key)) {
      this.flushNotesOn(events);
    }
    if (key === "mode") {
      const v = value as PointsmanMode;
      // Silent rejection for removed / unknown values — the bridge is the
      // user-facing legacy-state discard log boundary.
      if (!POINTSMAN_MODES.includes(v)) return events;
      this.params.mode = v;
      return events;
    }
    if (key === "chordShape") {
      const v = value as ChordShape;
      if (!CHORD_SHAPE_ORDER.includes(v)) return events;
      this.params.chordShape = v;
      return events;
    }
    if (key === "arpPattern") {
      const v = value as ArpPattern;
      if (!ARP_PATTERN_ORDER.includes(v)) return events;
      this.params.arpPattern = v;
      return events;
    }
    if (key === "arpRate") {
      const v = value as ArpRate;
      if (!ARP_RATES.some((r) => r.name === v)) return events;
      this.params.arpRate = v;
      return events;
    }
    if (key === "arpAccent") {
      this.params.arpAccent = normalizeAccentTable(value as readonly unknown[]);
      return events;
    }
    if (key === "arpSlide") {
      this.params.arpSlide = normalizeSlideTable(value as readonly unknown[]);
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
