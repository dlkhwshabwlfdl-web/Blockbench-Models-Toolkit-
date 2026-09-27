import { clamp, lerp, type Vec3 } from '../util/math.js';
import type { AnimationChannel, Interpolation, Keyframe } from '../model/types.js';
import { kf } from './keys.js';

export const TAU = Math.PI * 2;

/**
 * Sinusoid with a phase offset in turns (0..1) and a frequency multiplier.
 * `sin(0.25)` peaks a quarter of the way through the cycle.
 */
export const sin = (phase = 0, frequency = 1) => (t: number): number => Math.sin(TAU * (t - phase) * frequency);
export const cos = (phase = 0, frequency = 1) => (t: number): number => Math.cos(TAU * (t - phase) * frequency);

/** 0→1 ramp that resets each cycle. */
export const saw = (phase = 0) => (t: number): number => frac(t - phase);

/** Triangle wave, -1→1. */
export const triangle = (phase = 0, frequency = 1) => (t: number): number => {
  const f = frac((t - phase) * frequency);
  return 4 * Math.abs(f - 0.5) - 1;
};

/** Smooth 0→1→0 bump, useful for one-shot accents inside a loop. */
export const bump = (center = 0.5, width = 0.25) => (t: number): number =>
  Math.sin(Math.PI * clamp((t - (center - width)) / (2 * width), 0, 1));

/** Gaussian pulse — the shape used for whip/snap accents. */
export const pulse = (center = 0.5, width = 0.12) => (t: number): number =>
  Math.exp(-(((t - center) / width) ** 2));

/** Smoothstep ease between two values. */
export const ease = (from: number, to: number) => (t: number): number => {
  const x = clamp(t, 0, 1);
  return lerp(from, to, x * x * (3 - 2 * x));
};

/** Upward ramp with a configurable power curve. */
export const rampUp = (power = 1) => (t: number): number => clamp(t, 0, 1) ** power;

/** Negative decay — the tail "catching up" shape. */
export const decay = (rate = 8) => (t: number): number => Math.exp(-rate * Math.max(0, t));

export function frac(value: number): number {
  return value - Math.floor(value);
}

export function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

/** Multiply a scalar curve into a constant vector. */
export const vec = (f: (t: number) => number): ((t: number) => Vec3) => (t) => {
  const v = f(t);
  return [v, v, v];
};

const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === 'number');

/**
 * Sample a 0..1 cycle and emit keyframes for one bone/channel.
 *
 * `fn` may return a scalar (broadcast across X/Y/Z) or a `Vec3`, and may return `null` to
 * skip a sample. Sampling `samples + 1` times includes both endpoints, which matters for a
 * loop: t=0 and t=1 must carry the same pose or the animation pops.
 */
export function cycle(
  bone: string,
  channel: AnimationChannel,
  length: number,
  samples: number,
  fn: (t: number) => number | Vec3 | null,
  interpolation: Interpolation = 'catmullrom',
): Keyframe[] {
  const out: Keyframe[] = [];
  const count = Math.max(1, Math.round(samples));
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const value = fn(t);
    if (value === null) continue;
    const time = t * length;
    if (isVec3(value)) out.push(kf(bone, channel, time, value, interpolation));
    else out.push(kf(bone, channel, time, [value, value, value], interpolation));
  }
  return out;
}

/** Sample a cycle across several bones at once, sharing the phase function. */
export function cycleBones(
  bones: string[],
  channel: AnimationChannel,
  length: number,
  samples: number,
  fn: (bone: string, index: number, t: number) => number | Vec3 | null,
  interpolation: Interpolation = 'catmullrom',
): Keyframe[] {
  return bones.flatMap((bone, index) =>
    cycle(bone, channel, length, samples, (t) => fn(bone, index, t), interpolation),
  );
}

/**
 * Chain follower: each bone lags the one before it, so a tail or a whip propagates motion
 * instead of every segment moving in lockstep.
 */
export function chain(
  bones: string[],
  length: number,
  samples: number,
  fn: (index: number, t: number, lag: number, bone: string) => Vec3,
  options: { lag?: number; interpolation?: Interpolation } = {},
): Keyframe[] {
  const lag = options.lag ?? 0.075;
  return bones.flatMap((bone, index) =>
    cycle(bone, 'rotation', length, samples, (t) => fn(index, t, index * lag, bone), options.interpolation),
  );
}

/** Key data derived from a pose map at a single moment. */
export function pose(
  entries: Array<[number, Record<string, Vec3>, Record<string, Vec3>?, Interpolation?]>,
  options: { defaultInterpolation?: Interpolation } = {},
): Keyframe[] {
  const out: Keyframe[] = [];
  for (const entry of entries) {
    const [time, rotations, positions, interpolation = options.defaultInterpolation ?? 'catmullrom'] = entry;
    for (const [bone, value] of Object.entries(rotations ?? {})) {
      out.push(kf(bone, 'rotation', time, value, interpolation));
    }
    for (const [bone, value] of Object.entries(positions ?? {})) {
      out.push(kf(bone, 'position', time, value, interpolation));
    }
  }
  return out;
}
