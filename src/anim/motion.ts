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
