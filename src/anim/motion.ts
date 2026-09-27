import { clamp } from '../util/math.js';
import type { Keyframe } from '../model/types.js';
import { chain, cycle } from './curves.js';

const TAU = Math.PI * 2;

/**
 * Which bones a motion generator drives. Every field is optional, so a generator only
 * touches bones the model actually has — a legless model can still get a tail sway.
 */
export interface MotionRig {
  body?: string;
  chest?: string;
  head?: string;
  /** Neck chain, root first. */
  neck?: string[];
  /** Tail chain, root first. */
  tail?: string[];
  legs?: Array<{ leg: string; shin?: string; foot?: string; toes?: string; phase: number }>;
  arms?: Array<{ arm: string; lower?: string; phase: number }>;
}

/** The arrangement the toolkit's examples use, and a sensible default for a biped. */
export function defaultMotionRig(tailLength = 7): MotionRig {
  return {
    body: 'body',
    chest: 'chest',
    head: 'head',
    neck: ['neck_01', 'neck_02'],
    tail: Array.from({ length: tailLength }, (_, i) => `tail_0${i + 1}`),
    legs: [
      { leg: 'left_leg', shin: 'left_shin', foot: 'left_foot', toes: 'left_toes', phase: 0 },
      { leg: 'right_leg', shin: 'right_shin', foot: 'right_foot', toes: 'right_toes', phase: 0.5 },
    ],
    arms: [
      { arm: 'left_arm', lower: 'left_lower_arm', phase: 0 },
      { arm: 'right_arm', lower: 'right_lower_arm', phase: 0.5 },
    ],
  };
}

/* ------------------------------------------------------------ inference -- */

/** A bone as declared in a spec — just enough to work out what drives what. */
export interface BoneHint {
  name: string;
  parent?: string | null;
}

const SIDE_TOKENS = new Map<string, number>([
  ['left', 0],
  ['l', 0],
  ['right', 1],
  ['r', 1],
]);

const ROLE_WORDS = new Set([
  'toe', 'toes', 'foot', 'feet', 'shin', 'knee', 'leg', 'legs', 'thigh',
  'lower', 'fore', 'arm', 'arms', 'claw', 'claws', 'hand', 'hands', 'palm',
  'elbow', 'wrist', 'shoulder',
]);

const TORSO_BONES = ['body', 'chest', 'spine', 'hips', 'torso', 'core'];

type LimbRole = 'leg' | 'shin' | 'foot' | 'toes' | 'arm' | 'lower';

function tokenize(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

function limbRole(tokens: string[]): LimbRole | null {
  const has = (...words: string[]): boolean => words.some((word) => tokens.includes(word));
  const lowered = has('lower', 'fore');
  if (has('toe', 'toes')) return 'toes';
  if (has('foot', 'feet')) return 'foot';
  if (has('shin', 'knee')) return 'shin';
  if (has('leg', 'thigh')) return lowered ? 'shin' : 'leg';
  if (has('claw', 'claws', 'hand', 'hands', 'palm', 'elbow', 'wrist')) return 'lower';
  if (has('arm', 'arms', 'shoulder')) return lowered ? 'lower' : 'arm';
  return null;
}

/** `front_leg_left` groups its parts under `front`; `left_leg` has no group. */
function limbGroup(tokens: string[]): string {
  return tokens.find((t) => !SIDE_TOKENS.has(t) && !ROLE_WORDS.has(t) && !/^\d+$/.test(t)) ?? '';
}

/** Collect `neck_01, neck_02, …` / `tail_01, tail_02, …`, ordered along the chain. */
function chainFrom(names: string[], prefix: string): string[] {
  const pattern = new RegExp(`^${prefix}(?:[-_]?(\\d+))?$`, 'i');
  const found: Array<{ name: string; order: number | null; index: number }> = [];
  names.forEach((name, index) => {
    const match = pattern.exec(name);
    if (match) found.push({ name, order: match[1] === undefined ? null : Number(match[1]), index });
  });
  if (!found.some((entry) => entry.order !== null)) return found.map((entry) => entry.name);
  return found
    .sort((a, b) => (a.order ?? a.index) - (b.order ?? b.index))
    .map((entry) => entry.name);
}

/**
 * Work out a motion rig from the bones a spec actually declares.
 *
 * `defaultMotionRig()` names one specific biped — `body`, `chest`, `head`, `neck_01`,
 * `left_leg`, `tail_01` — so any model that names its bones differently gets *zero*
 * keyframes from every generator, silently. This reads the declared names instead, and
 * accepts both the side-first (`left_shin`) and side-last (`front_shin_left`) orders the
 * examples use, so a spec only has to pick sensible names. Anything it cannot read is
 * left out, and the generators skip bones the model lacks.
 *
 * Limb phases alternate by group *and* side, so a four-legged rig comes out on a
 * diagonal gait rather than a bound one.
 */
export function inferMotionRig(bones: BoneHint[]): MotionRig {
  const names = bones.map((bone) => bone.name);
  const rig: MotionRig = {};

  // `body` and `chest` are separate drives: locomotion bobs the body, breathe scales the
  // chest. A rig may declare either, both, or neither.
  const body = names.includes('body') ? 'body' : TORSO_BONES.find((name) => names.includes(name));
  if (body) rig.body = body;
  const chest = names.includes('chest') ? 'chest' : TORSO_BONES.find((name) => names.includes(name));
  if (chest) rig.chest = chest;

  const neck = chainFrom(names, 'neck');
  if (neck.length) rig.neck = neck;
  const tail = chainFrom(names, 'tail');
  if (tail.length) rig.tail = tail;

  if (names.includes('head')) rig.head = 'head';
  else if (neck.length) rig.head = neck[neck.length - 1];

  // Limb parts, grouped the way they were declared.
  type Partial = { leg?: string; shin?: string; foot?: string; toes?: string; arm?: string; lower?: string };
  const limbs = new Map<string, Partial>();
  const groupOrder: string[] = [];
  const firstSeen = new Map<string, number>();

  names.forEach((name, index) => {
    const tokens = tokenize(name);
    const side = tokens.map((token) => SIDE_TOKENS.get(token)).find((value) => value !== undefined);
    const role = limbRole(tokens);
    if (side === undefined || role === null) return;
    const group = limbGroup(tokens);
    const key = `${group}|${side}`;
    const slot = limbs.get(key) ?? {};
    // A limb is declared proximal-to-distal, so the first bone claiming a role is the one
    // attached to the body: `left_lower_arm` wins over the `left_claws` below it.
    if (slot[role] === undefined) slot[role] = name;
    limbs.set(key, slot);
    if (!groupOrder.includes(group)) groupOrder.push(group);
    if (!firstSeen.has(key)) firstSeen.set(key, index);
  });

  const legs: NonNullable<MotionRig['legs']> = [];
  const arms: NonNullable<MotionRig['arms']> = [];
  for (const [key, slot] of [...limbs].sort((a, b) => firstSeen.get(a[0])! - firstSeen.get(b[0])!)) {
    const [group, sideText] = key.split('|');
    const side = Number(sideText);
    const groupIndex = Math.max(0, groupOrder.indexOf(group));
    const phase = ((groupIndex + side) % 2) * 0.5;
    if (slot.leg) {
      legs.push({
        leg: slot.leg,
        ...(slot.shin ? { shin: slot.shin } : {}),
        ...(slot.foot ? { foot: slot.foot } : {}),
        ...(slot.toes ? { toes: slot.toes } : {}),
        phase,
      });
    }
    if (slot.arm) {
      arms.push({ arm: slot.arm, ...(slot.lower ? { lower: slot.lower } : {}), phase });
    }
  }
  if (legs.length) rig.legs = legs;
  if (arms.length) rig.arms = arms;

  return rig;
}

export interface LocomotionOptions {
  rig: MotionRig;
  length: number;
  /** Thigh swing amplitude in degrees. */
  stride: number;
  /** Peak knee flex. */
  knee: number;
  /** Vertical body bob in model units. */
  bob: number;
  /** Constant forward pitch of the body. */
  lean: number;
  /** Base tail lift. */
  tailLift: number;
  /** Arm swing amplitude. */
  armSwing: number;
  /** Head drop (negative lifts the head). */
  headDrop: number;
  samples?: number;
  kneeBase?: number;
}

/**
 * Locomotion cycle.
 *
 * A cube leg reads as a wind-up toy unless three things happen together: the knee flexes
 * while the leg swings, the foot counter-rotates to stay near the ground, and the toes grip
 * on the push-off. All three are derived here from one phase so a caller only tunes stride,
 * knee and bob.
 */
export function locomotion(options: LocomotionOptions): Keyframe[] {
  const { rig, length, stride, knee, bob, lean, tailLift, armSwing, headDrop } = options;
  const samples = options.samples ?? 8;
  const kneeBase = options.kneeBase ?? 4;
  const keys: Keyframe[] = [];

  for (const leg of rig.legs ?? []) {
    const phase = leg.phase;
    const thighAt = (t: number): number => -stride * Math.cos(TAU * (t - phase));
    const kneeAt = (t: number): number => knee * clamp(Math.sin(TAU * (t - phase - 0.12)) * 1.4, 0, 1) + kneeBase;
    keys.push(...cycle(leg.leg, 'rotation', length, samples, (t) => [thighAt(t), 0, 0]));
    if (leg.shin) {
      keys.push(...cycle(leg.shin, 'rotation', length, samples, (t) => [kneeAt(t), 0, 0]));
    }
    if (leg.foot) {
      keys.push(
        ...cycle(leg.foot, 'rotation', length, samples, (t) => [
          -(thighAt(t) + kneeAt(t)) * 0.5 + 6 * Math.sin(TAU * (t - phase + 0.15)),
          0,
          0,
        ]),
      );
    }
    if (leg.toes) {
      keys.push(
        ...cycle(leg.toes, 'rotation', length, samples, (t) => [
          -14 * Math.max(0, Math.sin(TAU * (t - phase + 0.3))),
          0,
          0,
        ]),
      );
    }
  }

  if (rig.body) {
    keys.push(...cycle(rig.body, 'position', length, samples, (t) => [0, bob * Math.cos(2 * TAU * t) - bob * 0.5, 0]));
    keys.push(...cycle(rig.body, 'rotation', length, samples, (t) => [lean, 0, 3 * Math.sin(TAU * t)]));
  }
  if (rig.chest) {
    keys.push(...cycle(rig.chest, 'rotation', length, samples, (t) => [0, -4 * Math.sin(TAU * t), 0]));
  }
  if (rig.neck?.[0]) {
    keys.push(...cycle(rig.neck[0], 'rotation', length, samples, (t) => [-2 * Math.sin(2 * TAU * t + 0.4), 2 * Math.sin(TAU * t + 0.4), 0]));
  }
  if (rig.head) {
    keys.push(
      ...cycle(rig.head, 'rotation', length, samples, (t) => [
        headDrop + 1.6 * Math.sin(2 * TAU * t),
        4 * Math.sin(TAU * t + 0.7),
        0,
      ]),
    );
  }

  for (const arm of rig.arms ?? []) {
    keys.push(...cycle(arm.arm, 'rotation', length, samples, (t) => [armSwing * Math.sin(TAU * (t - arm.phase)), 0, 0]));
    if (arm.lower) {
      keys.push(
        ...cycle(arm.lower, 'rotation', length, samples, (t) => [-16 + 6 * Math.sin(TAU * (t - arm.phase) - 0.5), 0, 0]),
      );
    }
  }

  if (rig.tail?.length) {
    keys.push(
      ...chain(rig.tail, length, samples, (index, t, lag) => {
        const lift = tailLift + index * 0.8;
        const sway = 4 + index * 1.9;
        return [lift * Math.cos(2 * TAU * (t - lag)) * 0.35 + lift * 0.65, sway * Math.sin(TAU * (t - lag)), 0];
      }),
    );
  }

  return keys;
}

export interface TailWaveOptions {
  rig: MotionRig;
  length: number;
  samples?: number;
  /** Side-to-side amplitude at the base. */
  sway?: number;
  /** Extra sway per segment down the chain. */
  growth?: number;
  /** Vertical wobble amplitude. */
  lift?: number;
  /** Per-segment phase lag. */
  lag?: number;
  /** Frequency multiplier (2 = twice as fast). */
  frequency?: number;
}

/** A travelling wave down a chain — idle tail sway, or a menacing slow wave. */
export function tailWave(options: TailWaveOptions): Keyframe[] {
  const { rig, length } = options;
  if (!rig.tail?.length) return [];
  const samples = options.samples ?? 9;
  const sway = options.sway ?? 6;
  const growth = options.growth ?? 2.6;
  const lift = options.lift ?? 1;
  const lagPer = options.lag ?? 0.11;
  const frequency = options.frequency ?? 1;
  return chain(
    rig.tail,
    length,
    samples,
    (index, t, lag) => [
      (lift + index * 0.5) * Math.sin(2 * TAU * (t - lag) * frequency),
      (sway + index * growth) * Math.sin(TAU * (t - lag) * frequency),
      0,
    ],
    { lag: lagPer },
  );
}

export interface BreatheOptions {
  rig: MotionRig;
  length: number;
  samples?: number;
  /** Chest scale amplitude. */
  amount?: number;
  /** Body sink per breath. */
  sink?: number;
}

/** Breathing: chest expansion plus the small body sink that sells it. */
export function breathe(options: BreatheOptions): Keyframe[] {
  const { rig, length } = options;
  const samples = options.samples ?? 6;
  const amount = options.amount ?? 0.04;
  const sink = options.sink ?? 0.3;
  const keys: Keyframe[] = [];
  if (rig.chest) {
    keys.push(...cycle(rig.chest, 'scale', length, samples, (t) => 1 + amount * Math.sin(Math.PI * 2 * t)));
    keys.push(...cycle(rig.chest, 'rotation', length, samples, (t) => [-2.2 * Math.sin(Math.PI * 2 * t), 0, 0]));
  }
  if (rig.neck?.[0]) {
    keys.push(...cycle(rig.neck[0], 'rotation', length, samples, (t) => [-2.4 * Math.sin(Math.PI * 2 * t), 0, 0]));
  }
  if (rig.head) {
    keys.push(...cycle(rig.head, 'rotation', length, samples, (t) => [1.4 * Math.sin(Math.PI * 2 * t), 0, 0]));
  }
  if (rig.body) {
    keys.push(...cycle(rig.body, 'position', length, samples, (t) => [0, -sink - sink * Math.sin(Math.PI * 2 * t), 0]));
  }
  if (rig.tail?.length) {
    keys.push(
      ...chain(rig.tail, length, samples, (index, t, lag) => [
        0.7 + index * 0.3,
        (1.5 + index) * Math.sin(TAU * (t - lag)),
        0,
      ]),
    );
  }
  return keys;
}

export interface HeadTurnOptions {
  rig: MotionRig;
  /** +1 = model's left, -1 = model's right. */
  direction: number;
  length?: number;
  samples?: number;
  /** Peak yaw at the neck root. */
  amount?: number;
}

/** Look left / look right: neck and head rotate together, tail counter-sways. */
export function headTurn(options: HeadTurnOptions): Keyframe[] {
  const { rig, direction } = options;
  const length = options.length ?? 0.9;
  const samples = options.samples ?? 6;
  const amount = options.amount ?? 20;
  const keys: Keyframe[] = [];
  const neck = rig.neck ?? [];
  neck.forEach((bone, index) => {
    const share = 1 - index * 0.15;
    keys.push(
      ...cycle(bone, 'rotation', length, samples, (t) => [0, amount * 0.7 * share * direction * Math.sin(Math.PI * t), 0]),
    );
  });
  if (rig.head) {
    keys.push(...cycle(rig.head, 'rotation', length, samples, (t) => [-3 * Math.sin(Math.PI * t), amount * direction * Math.sin(Math.PI * t), 4 * direction * Math.sin(Math.PI * t)]));
  }
  if (rig.body) {
    keys.push(...cycle(rig.body, 'rotation', length, samples, (t) => [0, 5 * direction * Math.sin(Math.PI * t), 0]));
  }
  if (rig.tail?.length) {
    keys.push(
      ...chain(rig.tail, length, samples, (index, t, lag) => [
        0.5,
        -3 * direction * (1 - t) * (1 + index * 0.4) - 2 * index * lag,
        0,
      ]),
    );
  }
  return keys;
}

export interface IdleSwayOptions {
  rig: MotionRig;
  length: number;
  samples?: number;
  /** Body yaw amplitude. */
  sway?: number;
  /** Vertical sink. */
  sink?: number;
  headScan?: number;
}

/** A calm idle: weight shifts, tail drifts, head scans. Loops seamlessly. */
export function idleSway(options: IdleSwayOptions): Keyframe[] {
  const { rig, length } = options;
  const samples = options.samples ?? 8;
  const sway = options.sway ?? 1.6;
  const sink = options.sink ?? 0.35;
  const headScan = options.headScan ?? 4;
  const keys: Keyframe[] = [];
  if (rig.body) {
    keys.push(...cycle(rig.body, 'rotation', length, samples, (t) => [0, sway * Math.sin(TAU * t), sway * 0.9 * Math.sin(TAU * t + 0.4)]));
    keys.push(...cycle(rig.body, 'position', length, samples, (t) => [0, -sink - sink * 0.5 * Math.sin(2 * TAU * t), 0]));
  }
  if (rig.chest) {
    keys.push(...cycle(rig.chest, 'rotation', length, samples, (t) => [-1.2 * Math.sin(TAU * t), 0, 0]));
  }
  if (rig.head) {
    keys.push(...cycle(rig.head, 'rotation', length, samples, (t) => [1 * Math.sin(2 * TAU * t), headScan * Math.sin(TAU * t), 0]));
  }
  if (rig.tail?.length) {
    keys.push(
      ...chain(rig.tail, length, samples, (index, t, lag) => [
        (0.8 + index * 0.4) * Math.sin(2 * TAU * (t - lag)),
        (3 + index * 1.7) * Math.sin(TAU * (t - lag)),
        0,
      ]),
    );
  }
  for (const leg of rig.legs ?? []) {
    const sign = leg.phase === 0 ? -1 : 1;
    keys.push(...cycle(leg.leg, 'rotation', length, samples, (t) => [sign * Math.sin(TAU * t), 0, 0]));
  }
  for (const arm of rig.arms ?? []) {
    const sign = arm.phase === 0 ? 1 : -1;
    keys.push(...cycle(arm.arm, 'rotation', length, samples, (t) => [1.5 * sign * Math.sin(TAU * t), 0, 0]));
  }
  return keys;
}
