// Stencil TM host — pure logic per ADR 002 §Stencil TM.
//
// Owns TmHostState (register, rng, position, held/seed input tracking) and
// exposes methods that the Max bridge calls. Returns NoteEvent arrays;
// the bridge schedules them (delaySteps → ms via msPerStep). No Max API,
// no timers, no I/O — fully testable under node --test.

import {
  createRegister,
  mapToNote,
  nextU32,
  registerToFraction,
  seedRng,
  shiftAndFlip,
  shiftAndForce,
  type RngState,
} from "../engine/turing.ts";

export type MidiNote = number; // 0..127
export type Channel = number; // 1..16
export type Subdivision = "8th" | "16th" | "32nd" | "8T" | "16T";
export type TriggerMode = "auto" | "gate" | "seed";

export type NoteEvent =
  | { type: "noteOn"; pitch: MidiNote; velocity: number; channel: Channel; delaySteps: number }
  | { type: "noteOff"; pitch: MidiNote; channel: Channel; delaySteps: number };

export interface HostParams {
  length: number; // 2..32
  lock: number; // 0..1
  rangeLo: MidiNote; // 0..127
  rangeHi: MidiNote; // 0..127, ≥ rangeLo
  density: number; // 0..1
  subdivision: Subdivision;
  seed: number; // u31
  triggerMode: TriggerMode;
  inputChannel: number; // 0..16, 0 = omni
  outputVelocity: number; // 1..127
  outputGate: number; // 0..1, fraction of step
  outputChannel: Channel; // 1..16
}

export const DEFAULT_PARAMS: HostParams = {
  length: 8,
  lock: 0.5,
  rangeLo: 48,
  rangeHi: 72,
  density: 1.0,
  subdivision: "16th",
  seed: 42,
  triggerMode: "auto",
  inputChannel: 0,
  outputVelocity: 100,
  outputGate: 0.5,
  outputChannel: 1,
};

// Threshold for u32-space probability comparison (mirrors engine convention).
function probabilityThreshold(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 0x100000000;
  return Math.floor(p * 0x100000000);
}

function noteKey(pitch: number, channel: number): string {
  return `${pitch}:${channel}`;
}

// ParamKey is the union of all HostParams scalar keys (excludes the
// range-tuple setRange() path). Used for generic setParam(key, value).
export type ParamKey = keyof HostParams;

export class TmHost {
  private params: HostParams;
  private register: number;
  private rng: RngState;
  private position: number;
  private notesOn: Set<string>;
  private heldInputs: Set<string>; // gate mode
  private seedActivated: boolean; // seed mode: false until first input

  constructor(params: HostParams = DEFAULT_PARAMS) {
    this.params = { ...params };
    this.notesOn = new Set();
    this.heldInputs = new Set();
    this.seedActivated = false;
    const init = this.freshRegister();
    this.register = init.register;
    this.rng = init.rng;
    this.position = 0;
  }

  private freshRegister(): { register: number; rng: RngState } {
    const rng = seedRng(BigInt(this.params.seed));
    const r = createRegister(this.params.length, rng);
    return { register: r.register, rng: r.state };
  }

  private channelMatches(ch: number): boolean {
    return this.params.inputChannel === 0 || ch === this.params.inputChannel;
  }

  private flushNotesOn(events: NoteEvent[]): void {
    for (const key of this.notesOn) {
      const [p, c] = key.split(":").map(Number);
      events.push({ type: "noteOff", pitch: p, channel: c, delaySteps: 0 });
    }
    this.notesOn.clear();
  }

  // Transport: advance to host step index `_position`. The position param is
  // informational (passed through for UI side-channels in the bridge); the
  // host advances exactly one step per call. Patcher ensures one step per
  // subdivision tick.
  step(_position: number): NoteEvent[] {
    const events: NoteEvent[] = [];

    // gate mode + no input held → silent, register and rng both frozen
    if (this.params.triggerMode === "gate" && this.heldInputs.size === 0) {
      return events;
    }

    // Read current register for output note (read-then-shift per ADR 001)
    const f = registerToFraction(this.register, this.params.length);
    const note = mapToNote(
      f.num,
      f.den,
      this.params.rangeLo,
      this.params.rangeHi,
    );

    // Density draw — always consumed from rng (so density=0 still advances
    // the PRNG state, keeping cross-target reproducibility intact)
    const dDraw = nextU32(this.rng);
    const dThresh = probabilityThreshold(this.params.density);
    const active = dDraw.value < dThresh;
    this.rng = dDraw.state;

    // Register advancement
    const isSeedActive =
      this.params.triggerMode === "seed" && this.seedActivated;
    if (!isSeedActive) {
      // auto / seed-pre-activation / gate-with-input → shiftAndFlip
      const sf = shiftAndFlip(
        this.register,
        this.params.length,
        this.params.lock,
        this.rng,
      );
      this.register = sf.register;
      this.rng = sf.state;
    }
    // seed-active: register is frozen (input drives it); rng was advanced
    // for density only, no flip draw.

    this.position++;

    if (active) {
      this.flushNotesOn(events);
      const ch = this.params.outputChannel;
      events.push({
        type: "noteOn",
        pitch: note,
        velocity: this.params.outputVelocity,
        channel: ch,
        delaySteps: 0,
      });
      events.push({
        type: "noteOff",
        pitch: note,
        channel: ch,
        delaySteps: this.params.outputGate,
      });
      // notesOn intentionally NOT updated: the noteOff is already in the
      // emitted events for the bridge to schedule. notesOn tracks only
      // unmatched-noteOn cases (currently none in TM mono).
    }

    return events;
  }

  // MIDI input path. Channel-filtered by inputChannel (0=omni).
  noteIn(pitch: number, _velocity: number, channel: number): NoteEvent[] {
    if (!this.channelMatches(channel)) return [];
    const key = noteKey(pitch, channel);
    if (this.params.triggerMode === "gate") {
      this.heldInputs.add(key);
    } else if (this.params.triggerMode === "seed") {
      this.register = shiftAndForce(this.register, this.params.length, 1);
      this.seedActivated = true;
    }
    // auto mode: input ignored
    return [];
  }

  noteOff(pitch: number, channel: number): NoteEvent[] {
    if (!this.channelMatches(channel)) return [];
    const key = noteKey(pitch, channel);
    if (this.params.triggerMode === "gate") {
      this.heldInputs.delete(key);
    } else if (this.params.triggerMode === "seed") {
      this.register = shiftAndForce(this.register, this.params.length, 0);
      this.seedActivated = true;
    }
    return [];
  }

  transportStart(): NoteEvent[] {
    const events: NoteEvent[] = [];
    this.flushNotesOn(events);
    const init = this.freshRegister();
    this.register = init.register;
    this.rng = init.rng;
    this.position = 0;
    this.heldInputs.clear();
    this.seedActivated = false;
    return events;
  }

  // ADR 002 §Note-off discipline: emit noteOff for all notesOn, clear set,
  // reset position. Register is preserved (NOT re-initialized) so stop/start
  // resumes from the same loop rather than re-drawing on every transport
  // bounce.
  transportStop(): NoteEvent[] {
    const events: NoteEvent[] = [];
    this.flushNotesOn(events);
    this.heldInputs.clear();
    this.seedActivated = false;
    this.position = 0;
    return events;
  }

  panic(): NoteEvent[] {
    const events: NoteEvent[] = [];
    this.flushNotesOn(events);
    return events;
  }

  // Generic parameter update. State-affecting params (length, seed, range,
  // subdivision, triggerMode) flush notes and may re-init the register.
  setParam<K extends ParamKey>(key: K, value: HostParams[K]): NoteEvent[] {
    const events: NoteEvent[] = [];
    const flushKeys: ParamKey[] = [
      "length",
      "seed",
      "rangeLo",
      "rangeHi",
      "subdivision",
      "triggerMode",
    ];
    if (flushKeys.includes(key)) {
      this.flushNotesOn(events);
    }
    this.params[key] = value;
    // Re-init register on length/seed change. Position is preserved
    // (monotonic since transportStart per ADR 002).
    if (key === "length" || key === "seed") {
      const init = this.freshRegister();
      this.register = init.register;
      this.rng = init.rng;
    }
    // triggerMode change clears mode-specific input state to avoid stale
    // flags (e.g., seedActivated still true after switching to auto).
    if (key === "triggerMode") {
      this.heldInputs.clear();
      this.seedActivated = false;
    }
    // Range clamping on individual lo/hi sets — keep lo ≤ hi invariant.
    if (key === "rangeLo" && this.params.rangeLo > this.params.rangeHi) {
      this.params.rangeLo = this.params.rangeHi;
    }
    if (key === "rangeHi" && this.params.rangeHi < this.params.rangeLo) {
      this.params.rangeHi = this.params.rangeLo;
    }
    return events;
  }

  // Tuple range update. Always orders lo ≤ hi.
  setRange(lo: number, hi: number): NoteEvent[] {
    const events: NoteEvent[] = [];
    this.flushNotesOn(events);
    this.params.rangeLo = Math.min(lo, hi);
    this.params.rangeHi = Math.max(lo, hi);
    return events;
  }

  // Inspection (for UI side-channels and tests).
  getRegister(): number {
    return this.register;
  }
  getPosition(): number {
    return this.position;
  }
  getParams(): Readonly<HostParams> {
    return this.params;
  }
}
