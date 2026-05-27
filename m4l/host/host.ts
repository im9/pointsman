// Pointsman host — v3 surface (ADR 004 — chord shape + arp).
//
// Owns PointsmanHostState (scalePitches cache, humanizeRng, driftState,
// params, notesOn, lastInputTime, arp pool/state) and exposes methods
// the Max bridge calls. Returns NoteEvent arrays with delayMs already
// in ms — the bridge schedules each event at `now + delayMs` (clamping
// negative delays). No Max API, no timers — fully testable under
// node --test.
//
// v3 changes vs v2 (ADR 004 Phase 3-A / 3-B):
//   - mode: "scale" | "chord" | "arp" (Arp added).
//   - harmonyVoices removed entirely (hard schema break per ADR 004
//     §Persistence). Chord-mode call site swapped from diatonic voice
//     stacking to intervallic chordShape preset.
//   - chordShape (default "maj") drives the 1-in-N-out expansion in
//     both chord mode and arp mode.
//   - Phase 3-B: arp mode now runs a real clock. noteIn populates the
//     held-note pool (no immediate emission); transportTick(positionPpq,
//     bpm, nowMs) emits per-tick events via variation → groove → humanize
//     in fixed order so a given (seed, input, params) reproduces output
//     bit-for-bit.

import {
  applyArpGroove,
  applyArpVariation,
  applyChordShape,
  ARP_PATTERN_ORDER,
  ARP_RATES,
  buildScalePitches,
  CHORD_SHAPE_ORDER,
  INITIAL_ARP_STATE,
  nextArpIndex,
  parseArpRate,
  resolveArpStep,
  snapToScale,
  type ArpPattern,
  type ArpRate,
  type ArpState,
  type ChordShape,
  type MidiNote,
  type ScaleName,
} from "../engine/quantizer.ts";
import { nextU32, seedRng, type RngState } from "../engine/rng.ts";
import {
  composeHumanize,
  NEUTRAL_DRIFT,
  type DriftState,
} from "./humanize.ts";

export type Channel = number; // 1..16 (0 = omni boundary value)
export type PointsmanMode = "scale" | "chord" | "arp";

const POINTSMAN_MODES: readonly PointsmanMode[] = ["scale", "chord", "arp"];

// First-event step fallback for chord / scale modes. With no prior input,
// there is no rhythmic gap to derive sourceStepDuration from; 250 ms is
// generic across common tempos (16th @ 60 BPM, 8th @ 120 BPM, quarter
// @ 240 BPM).
export const FIRST_EVENT_STEP_MS = 250;

// ADR 004 §Groove layer: 16-step rhythm grid is the canonical accent /
// slide pattern length. Bound exported so the bridge + tests share one
// constant.
export const ARP_PATTERN_STEPS = 16;

// Default bridge poll interval (ms). The bridge's [metro] runs at this
// cadence when transport is playing; transportTick uses it as the
// lookahead horizon so any tick due in (now, now + lookahead] is
// pre-scheduled with positive delayMs, smoothing out poll jitter.
// 16 ms = ~60 Hz, matches Live's own UI tick.
export const DEFAULT_TRANSPORT_POLL_MS = 16;

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

// Pool entry — one voice the arp iterates. sourceCh/sourcePitch tag it so
// noteOff removes only the entries from the matching held key (latch
// disables removal). ADR §Held-note pool simplification: dedup by
// (pitch, channel) at insert; a duplicate contributor is dropped rather
// than tracked, so multi-source overlap collapses into the first
// contributor's tag.
interface ArpPoolEntry {
  pitch: number;
  channel: number;
  sourceCh: number;
  sourcePitch: number;
  sourceVel: number;
}

interface ArpHeldKey {
  channel: number;
  pitch: number;
  velocity: number;
}

// Slide-deferred noteOff: the pitches whose noteOff was suppressed at
// their owning tick because arpSlide[tickIdx mod 16] == true. They fire
// at the noteOn time of the next tick (sample-tight overlap for synth
// glide); if the next tick is rest, they fire at the rest's tick
// boundary (no infinite hold).
interface ArpSlideEntry {
  pitch: number;
  channel: number;
}

export class PointsmanHost {
  private params: PointsmanParams;
  private scalePitches: MidiNote[];
  private humanizeRng: RngState;
  private driftState: DriftState;
  private notesOn: Set<string>;
  private lastInputTime: number | null;

  // ── ADR 004 Phase 3-B arp state ──
  private arpPool: ArpPoolEntry[] = [];
  private arpHeldKeys: Map<string, ArpHeldKey> = new Map();
  private arpState: ArpState = { ...INITIAL_ARP_STATE };
  // 16-step groove cycle counter. Zero on transport start, increments
  // one per arp tick regardless of rate (ADR §Arp clock step 4).
  private arpTickIndex: number = 0;
  // Next tick alignment in PPQ. null until anchored by the first
  // transportTick call (or whenever rate / transport changes invalidate
  // the anchor). ADR §Transport semantics §Start: pattern begins on the
  // next clock tick after playing goes true → align to the next rate-
  // grid boundary at or after the current position.
  private arpNextTickPpq: number | null = null;
  // Slide-tied pitches awaiting their deferred noteOff (cleared at the
  // next tick boundary).
  private arpSlidePending: ArpSlideEntry[] = [];

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

  // Empty in mono v1: every emitted noteOn from scale / chord mode pairs
  // with a scheduled noteOff in the same call. notesOn is reserved for
  // future polyphony; arp output is tracked entirely on the bridge side
  // via pendingNoteOns / pendingNoteOffs.
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

    const snapped = snapToScale(pitch, this.scalePitches);

    if (this.params.mode === "arp") {
      // ADR §Held-note pool: arp input populates the pool. Emission is
      // tick-driven by transportTick. No humanize draw here — humanize
      // applies per-tick downstream.
      this.arpAddSourceNote(channel, pitch, velocity, snapped);
      return [];
    }

    // Scale / chord modes share the v0.1 humanize-on-input path.
    const events: NoteEvent[] = [];
    const sourceStepDuration =
      this.lastInputTime === null
        ? FIRST_EVENT_STEP_MS
        : nowMs - this.lastInputTime;
    this.lastInputTime = nowMs;

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
    // chord = 1-in-N-out via applyChordShape (intervallic).
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

  // Input noteOffs in scale / chord modes are silently consumed (output
  // noteOff is scheduled by humanize gate at noteIn dispatch). In arp
  // mode, noteOff drives pool removal (unless arpLatch is on). Non-
  // matching channels pass through (paired with the pass-through noteOn).
  noteOff(pitch: number, channel: number): NoteEvent[] {
    if (!this.channelMatches(channel)) {
      return [{ type: "noteOff", pitch, channel, delayMs: 0 }];
    }
    if (this.params.mode === "arp") {
      this.arpRemoveSourceNote(channel, pitch);
    }
    return [];
  }

  // ── ADR 004 Phase 3-B arp clock ──
  //
  // Called by the bridge on every transport poll (default cadence
  // DEFAULT_TRANSPORT_POLL_MS). Emits zero or more tick events scheduled
  // with delayMs reflecting the PPQ-to-wall-clock projection: a tick
  // already past (positionPpq ≥ tickPpq) fires immediately (delayMs=0);
  // a tick due in (now, now + lookahead] is pre-scheduled with positive
  // delayMs so the bridge's setTimeout dispatcher hits the right grid
  // point even when polls jitter.
  transportTick(
    positionPpq: number,
    bpm: number,
    _nowMs: number,
    pollIntervalMs: number = DEFAULT_TRANSPORT_POLL_MS,
  ): NoteEvent[] {
    if (this.params.mode !== "arp") return [];
    // Empty pool with no latch: nothing to emit. Clear the anchor so a
    // subsequent pool-fill re-aligns to the new grid rather than firing
    // a stale catch-up burst.
    if (this.arpPool.length === 0) {
      this.arpNextTickPpq = null;
      return [];
    }
    if (!Number.isFinite(positionPpq) || !Number.isFinite(bpm) || bpm <= 0) {
      return [];
    }

    const events: NoteEvent[] = [];
    const msPerBeat = 60000 / bpm;
    const rate = parseArpRate(this.params.arpRate);
    const rateInQuarters = rate.num / rate.den;
    if (!(rateInQuarters > 0)) return [];

    // Anchor first tick to the next rate-grid boundary at or after the
    // current position. Using >= boundary (not strictly >) so a position
    // that already lands on the grid fires immediately.
    if (this.arpNextTickPpq === null) {
      const grid = Math.ceil(positionPpq / rateInQuarters) * rateInQuarters;
      // Math.ceil over a value already at a grid boundary returns the
      // same boundary — handle the float-tolerance case explicitly so a
      // position of exactly 0 fires the tick at delayMs=0 rather than
      // hopping forward by one full step.
      this.arpNextTickPpq = (Math.abs(grid - positionPpq) < 1e-9)
        ? positionPpq
        : grid;
    }

    // Lookahead horizon in PPQ. The bridge polls every pollIntervalMs;
    // pre-schedule any tick that will fire before the next poll lands,
    // so dispatch is on the setTimeout grid instead of the poll grid.
    const lookaheadPpq = (pollIntervalMs + 5) / msPerBeat;
    const horizon = positionPpq + lookaheadPpq;

    // Safety bound: 64 ticks per call is well beyond any reasonable
    // poll/rate combination (1/32 @ 240 BPM × 16 ms poll = ~1 tick).
    let safety = 0;
    while (this.arpNextTickPpq <= horizon + 1e-9 && safety++ < 64) {
      const tickDelayMs = Math.max(0,
        (this.arpNextTickPpq - positionPpq) * msPerBeat);
      this.emitArpTick(events, tickDelayMs, msPerBeat, rateInQuarters);
      this.arpNextTickPpq += rateInQuarters;
    }

    return events;
  }

  transportStart(): NoteEvent[] {
    const events: NoteEvent[] = [];
    this.flushNotesOn(events);
    this.driftState = { ...NEUTRAL_DRIFT };
    this.lastInputTime = null;
    this.humanizeRng = seedRng(BigInt(this.params.seed));
    // ADR §Transport semantics §Stop: "the next start resets pattern
    // index to 0 and rebuilds humanize from seed." Pool is preserved
    // — held keys carry across.
    this.resetArpRuntimeState();
    return events;
  }

  transportStop(): NoteEvent[] {
    const events: NoteEvent[] = [];
    this.flushNotesOn(events);
    this.lastInputTime = null;
    // Drop the tick anchor + slide-pending so a subsequent start re-
    // aligns. Pool / held keys persist (they belong to the user's key
    // input, not to transport).
    this.arpNextTickPpq = null;
    this.arpSlidePending = [];
    return events;
  }

  panic(): NoteEvent[] {
    const events: NoteEvent[] = [];
    this.flushNotesOn(events);
    this.arpNextTickPpq = null;
    this.arpSlidePending = [];
    return events;
  }

  setParam<K extends ParamKey>(key: K, value: PointsmanParams[K]): NoteEvent[] {
    const events: NoteEvent[] = [];
    // Mode / scale / root / chordShape change invalidates any in-flight
    // quantize result for scale / chord modes — release sounding pitches
    // before applying. (For arp mode the bridge's flushInFlight handles
    // pending tick-scheduled events.)
    const flushKeys: ParamKey[] = ["scale", "root", "mode", "chordShape"];
    if (flushKeys.includes(key)) {
      this.flushNotesOn(events);
    }
    if (key === "mode") {
      const v = value as PointsmanMode;
      if (!POINTSMAN_MODES.includes(v)) return events;
      const prev = this.params.mode;
      this.params.mode = v;
      if (prev !== v) {
        // Mode switch: drop arp pool + held keys so a future re-entry
        // into arp starts from a clean slate (predictable UX over
        // preservation of stale state across mode hops).
        this.arpPool = [];
        this.arpHeldKeys.clear();
        this.resetArpRuntimeState();
      }
      return events;
    }
    if (key === "chordShape") {
      const v = value as ChordShape;
      if (!CHORD_SHAPE_ORDER.includes(v)) return events;
      this.params.chordShape = v;
      // ADR §Held-note pool: chordShape change in arp mode rebuilds the
      // pool from currently-held keys with the new shape and resets the
      // pattern cursor. Outside arp mode the parameter takes effect on
      // the next noteIn.
      if (this.params.mode === "arp") {
        this.rebuildArpPool();
      }
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
      // Re-anchor the tick scheduler so the new rate's grid takes effect
      // on the next transportTick rather than continuing the prior grid.
      this.arpNextTickPpq = null;
      return events;
    }
    if (key === "arpLatch") {
      const v = !!value;
      const prev = this.params.arpLatch;
      this.params.arpLatch = v;
      // Latch off → on: nothing to do (pool stays).
      // Latch on → off WITH no keys held: pool is "ghost-latched" with
      // no active source — drop it so the next noteOn doesn't surprise
      // the user by adding to a no-longer-anchored set.
      if (prev && !v && this.arpHeldKeys.size === 0) {
        this.arpPool = [];
      }
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
      // Pool snapping invalidates on scale / root change too — the pool's
      // root pitches were snapped against the old scale.
      if (this.params.mode === "arp") {
        this.rebuildArpPool();
      }
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
  // Test-only inspection of arp state. The arp pool is a private detail
  // of the host; tests need a read path to assert "this noteOn added
  // these voices" / "noteOff removed them" without iterating output.
  getArpPoolForTest(): readonly { pitch: number; channel: number }[] {
    return this.arpPool.map((e) => ({ pitch: e.pitch, channel: e.channel }));
  }
  getArpHeldKeysCountForTest(): number {
    return this.arpHeldKeys.size;
  }

  // ── internal: arp pool maintenance ──

  private arpAddSourceNote(
    channel: number,
    pitch: number,
    velocity: number,
    snapped: number,
  ): void {
    // ADR §Held-note pool: if latch is on AND no keys were held just
    // before this noteOn, the prior pool is latched — clear it now so
    // this noteOn establishes a fresh pool rather than additively
    // expanding past the latched set.
    if (this.params.arpLatch && this.arpHeldKeys.size === 0
        && this.arpPool.length > 0) {
      this.arpPool = [];
    }
    const key = `${channel}:${pitch}`;
    this.arpHeldKeys.set(key, { channel, pitch, velocity });
    const voices = applyChordShape(snapped, this.params.chordShape);
    for (const p of voices) {
      // Dedup by (pitch, channel) at insert; ADR §Held-note pool
      // simplification accepts that a duplicate contributor's tag is
      // dropped (single-tagged entries) so noteOff removes the pitch
      // based on the first contributor's source.
      if (this.arpPool.some((e) => e.pitch === p && e.channel === channel)) {
        continue;
      }
      this.arpPool.push({
        pitch: p,
        channel,
        sourceCh: channel,
        sourcePitch: pitch,
        sourceVel: velocity,
      });
    }
    // First voice added: anchor the tick scheduler if it was idle.
    // (transportTick anchors on its own first call too, but this branch
    // covers the case where the user presses a key BEFORE transport
    // ever calls in — the anchor lands at the next tick regardless.)
    if (this.arpPool.length > 0 && this.arpNextTickPpq === null) {
      // Anchor null stays null — transportTick still does the alignment
      // math on its next call. The line above is intentionally a no-op
      // guard; the real anchoring lives in transportTick.
    }
  }

  private arpRemoveSourceNote(channel: number, pitch: number): void {
    const key = `${channel}:${pitch}`;
    this.arpHeldKeys.delete(key);
    // Latched: voices stay until the next noteOn-after-empty (handled in
    // arpAddSourceNote). Otherwise remove voices contributed by this
    // source key.
    if (this.params.arpLatch) return;
    this.arpPool = this.arpPool.filter(
      (e) => !(e.sourceCh === channel && e.sourcePitch === pitch),
    );
  }

  private rebuildArpPool(): void {
    this.arpPool = [];
    for (const k of this.arpHeldKeys.values()) {
      const snapped = snapToScale(k.pitch, this.scalePitches);
      const voices = applyChordShape(snapped, this.params.chordShape);
      for (const p of voices) {
        if (this.arpPool.some((e) => e.pitch === p && e.channel === k.channel)) {
          continue;
        }
        this.arpPool.push({
          pitch: p,
          channel: k.channel,
          sourceCh: k.channel,
          sourcePitch: k.pitch,
          sourceVel: k.velocity,
        });
      }
    }
    // Pattern + groove cursors reset on pool rebuild so the new shape
    // starts from index 0 rather than mid-cycle on a now-stale index.
    this.arpState = { ...INITIAL_ARP_STATE };
    this.arpTickIndex = 0;
    this.arpSlidePending = [];
  }

  private resetArpRuntimeState(): void {
    this.arpState = { ...INITIAL_ARP_STATE };
    this.arpTickIndex = 0;
    this.arpNextTickPpq = null;
    this.arpSlidePending = [];
  }

  // ── internal: arp tick emission ──

  private drawUniform01(): number {
    const u = nextU32(this.humanizeRng);
    this.humanizeRng = u.state;
    // u.value is in [0, 2^32); divide by 2^32 to get [0, 1). Use 0x1_0000_0000
    // as a float constant so the division is exact.
    return u.value / 0x100000000;
  }

  private emitArpTick(
    events: NoteEvent[],
    tickDelayMs: number,
    msPerBeat: number,
    rateInQuarters: number,
  ): void {
    // Sorted-pitch view of the pool. resolveArpStep iterates by index,
    // and tests / the ADR pin "pool = ascending pitch order, ties by
    // insertion". The sort is a no-op on already-sorted pools; the
    // allocation cost is acceptable here (off the audio path).
    const sortedPool = [...this.arpPool]
      .sort((a, b) => a.pitch - b.pitch);
    const poolPitches = sortedPool.map((e) => e.pitch);
    const poolChannels = sortedPool.map((e) => e.channel);
    const poolN = poolPitches.length;

    // Pre-advance: resolve current cursor; advancement to NEXT happens
    // at the end so each tick uses the (index, round, repeatTick) the
    // cursor lands on after the previous tick finished.
    const emission = resolveArpStep(
      poolPitches,
      this.arpState.index,
      this.arpState.round,
      this.params.arpPattern,
    );

    // Variation cascade always consumes two draws (effect + octave sign)
    // — fixed order required for reproducibility against (seed, input,
    // params), per concept.md §"Per-event humanize" + ADR §Variation
    // modulation §Composition guarantees §RNG stream.
    const v1 = this.drawUniform01();
    const v2 = this.drawUniform01();
    const variation = applyArpVariation(
      emission,
      this.params.arpVariation,
      v1,
      v2,
    );

    // Groove cascade is deterministic — no RNG. sixteenthMs is the unit
    // for the swing offset (the function name `sixteenthDurationSamples`
    // is unit-agnostic — we pass ms and get back swing offset in ms).
    const sixteenthMs = msPerBeat / 4;
    const groove = applyArpGroove(
      variation,
      this.arpTickIndex,
      this.params.arpAccent,
      this.params.arpSlide,
      this.params.arpSwing,
      sixteenthMs,
    );

    // Humanize cascade always consumes three draws (velocity / gate /
    // timing), even when the tick is a rest — keeps the RNG stream
    // deterministic regardless of how many ticks were rests. The
    // velocity baseline is groove.velocity (accent); gateBase is arpGate.
    const stepMs = msPerBeat * rateInQuarters;
    const baselineVel = groove.applied ? groove.velocity : 100;
    const hum = composeHumanize(this.humanizeRng, this.driftState, {
      feel: this.params.feel,
      drift: this.params.drift,
      inputVelocity: baselineVel,
      sourceStepDuration: stepMs,
      inputGate: this.params.arpGate,
    });
    this.humanizeRng = hum.rng;
    this.driftState = hum.driftState;

    // Branch on the variation effect. Rest tick first — any slide-
    // pending noteOff fires at this tick boundary (ADR §Groove layer
    // §Composition guarantees §Rest precedence + §Slide across rate
    // changes: deferred noteOff fires at the next tick under the
    // current rate).
    if (variation.effect === "rest") {
      this.flushSlidePending(events, tickDelayMs);
      this.advanceArpCursor(poolN);
      this.arpTickIndex++;
      return;
    }

    // Active emission. Compute final timing:
    //   noteOnDelay = tickDelay + swingOffset + humanize.timingOffset
    const swingMs = groove.applied ? groove.swingOffsetSamples : 0;
    const noteOnDelay = tickDelayMs + swingMs + hum.timingOffset;
    // gate ms: humanize already folded arpGate into gateFinal via
    // inputGate. Multiply by stepMs to get duration in ms.
    const gateMs = hum.gateFinal * stepMs;

    // Emit pitches (1 voice for traversal patterns, N for `strike`).
    // Source channel: traversal patterns pull the per-voice channel
    // from the sorted pool entry at the resolved index; `strike` uses
    // the first entry's channel as a representative (the pool is
    // dedup'd per (pitch, channel), so per-voice channel can differ
    // only if multiple held keys arrived on different channels — rare).
    const isStrike = this.params.arpPattern === "strike";
    const emittedChannels: number[] = [];
    if (isStrike) {
      for (let i = 0; i < variation.pitches.length; i++) {
        emittedChannels.push(poolN > 0 ? poolChannels[i % poolN] : 1);
      }
    } else {
      const idx = poolN === 0 ? 0
        : ((this.arpState.index % poolN) + poolN) % poolN;
      emittedChannels.push(poolN > 0 ? poolChannels[idx] : 1);
    }

    // 1) Emit new noteOns first.
    for (let i = 0; i < variation.pitches.length; i++) {
      const p = variation.pitches[i];
      const ch = emittedChannels[i] ?? emittedChannels[0] ?? 1;
      events.push({
        type: "noteOn",
        pitch: p,
        velocity: hum.velocityFinal,
        channel: ch,
        delayMs: noteOnDelay,
      });
    }

    // 2) Then emit any slide-pending noteOffs at the new noteOn time so
    //    the receiving synth sees overlap-then-release → glide.
    this.flushSlidePending(events, noteOnDelay);

    // 3) Schedule this tick's noteOff. If groove says tie-to-next, defer
    //    by stashing in arpSlidePending (next tick emits it). For flam,
    //    the engine API surfaces the effect but the second-emission
    //    semantics (split timing, "second flam emission ties on slide")
    //    require additional structure; for 3-B we treat flam as a
    //    normal-gate emission (the flam's second pulse is a Phase 4
    //    refinement — TODO comment downstream).
    if (groove.applied && groove.tieToNext) {
      for (let i = 0; i < variation.pitches.length; i++) {
        this.arpSlidePending.push({
          pitch: variation.pitches[i],
          channel: emittedChannels[i] ?? emittedChannels[0] ?? 1,
        });
      }
    } else {
      const noteOffDelay = noteOnDelay + gateMs;
      for (let i = 0; i < variation.pitches.length; i++) {
        const p = variation.pitches[i];
        const ch = emittedChannels[i] ?? emittedChannels[0] ?? 1;
        events.push({
          type: "noteOff",
          pitch: p,
          channel: ch,
          delayMs: noteOffDelay,
        });
      }
    }

    // 4) notePulse per emitted pitch — keyboard pulse anim lockstep
    //    with the audible noteOn.
    for (let i = 0; i < variation.pitches.length; i++) {
      events.push({
        type: "notePulse",
        pitch: variation.pitches[i],
        velocity: hum.velocityFinal,
        delayMs: noteOnDelay,
      });
    }

    // Advance pattern cursor (consumes one RNG draw for `random`).
    this.advanceArpCursor(poolN);
    this.arpTickIndex++;
  }

  private advanceArpCursor(poolN: number): void {
    // nextArpIndex consumes one RNG draw — used only by pattern=random
    // but always advanced so the stream is deterministic regardless of
    // pattern choice. (concept.md §Per-event humanize fixed-order rule.)
    const r = this.drawUniform01();
    this.arpState = nextArpIndex(
      this.params.arpPattern,
      this.arpState,
      poolN,
      this.params.arpOctaves,
      this.params.arpStepRepeats,
      r,
    );
  }

  private flushSlidePending(events: NoteEvent[], delayMs: number): void {
    for (const sp of this.arpSlidePending) {
      events.push({
        type: "noteOff",
        pitch: sp.pitch,
        channel: sp.channel,
        delayMs,
      });
    }
    this.arpSlidePending = [];
  }
}
