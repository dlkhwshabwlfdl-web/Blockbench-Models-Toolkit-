import { round3, type Vec3 } from '../util/math.js';
import type { AnimationChannel, Interpolation, Keyframe } from '../model/types.js';

/** Build one keyframe. Times and values are rounded like Blockbench does. */
export function kf(
  bone: string,
  channel: AnimationChannel,
  time: number,
  value: Vec3,
  interpolation: Interpolation = 'catmullrom',
): Keyframe {
  return {
    bone,
    channel,
    time: round3(time),
    value: [round3(value[0]), round3(value[1]), round3(value[2])],
    interpolation,
  };
}

export const rot = (
  bone: string,
  time: number,
  value: Vec3,
  interpolation: Interpolation = 'catmullrom',
): Keyframe => kf(bone, 'rotation', time, value, interpolation);

export const rot3 = (
  bone: string,
  time: number,
  x: number,
  y: number,
  z: number,
  interpolation: Interpolation = 'catmullrom',
): Keyframe => kf(bone, 'rotation', time, [x, y, z], interpolation);

export const pos = (
  bone: string,
  time: number,
  value: Vec3,
  interpolation: Interpolation = 'catmullrom',
): Keyframe => kf(bone, 'position', time, value, interpolation);

export const pos3 = (
  bone: string,
  time: number,
  x: number,
  y: number,
  z: number,
  interpolation: Interpolation = 'catmullrom',
): Keyframe => kf(bone, 'position', time, [x, y, z], interpolation);

export const scale = (
  bone: string,
  time: number,
  value: Vec3,
  interpolation: Interpolation = 'catmullrom',
): Keyframe => kf(bone, 'scale', time, value, interpolation);

/** Uniform scale keyframe. */
export const scaleUniform = (
  bone: string,
  time: number,
  value: number,
  interpolation: Interpolation = 'catmullrom',
): Keyframe => kf(bone, 'scale', time, [value, value, value], interpolation);

/**
 * Sort keyframes by bone, then channel (rotation, position, scale), then time — the order
 * Blockbench writes and the order that makes a diff readable.
 */
export function sortKeys(keys: Keyframe[]): Keyframe[] {
  const channelRank: Record<AnimationChannel, number> = { rotation: 0, position: 1, scale: 2 };
  return [...keys].sort((a, b) => {
    if (a.bone !== b.bone) return a.bone < b.bone ? -1 : 1;
    if (a.channel !== b.channel) return channelRank[a.channel] - channelRank[b.channel];
    return a.time - b.time;
  });
}

/** Drop exact duplicates (same bone/channel/time) keeping the first occurrence. */
export function dedupeKeys(keys: Keyframe[]): Keyframe[] {
  const seen = new Set<string>();
  const out: Keyframe[] = [];
  for (const key of keys) {
    const id = `${key.bone}|${key.channel}|${key.time}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(key);
  }
  return out;
}

/** Flatten a list of key lists into one clip-ready array. */
export function mergeKeys(...groups: Keyframe[][]): Keyframe[] {
  return dedupeKeys(sortKeys(groups.flat()));
}

/** Count keys per bone, for QA and summaries. */
export function keyCountByBone(keys: Keyframe[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key.bone, (counts.get(key.bone) ?? 0) + 1);
  return counts;
}

/** The set of bones touched by a key list. */
export function animatedBones(keys: Keyframe[]): Set<string> {
  return new Set(keys.map((key) => key.bone));
}

/** Highest keyframe time in a list (0 when empty). */
export function maxTime(keys: Keyframe[]): number {
  return keys.reduce((max, key) => Math.max(max, key.time), 0);
}
