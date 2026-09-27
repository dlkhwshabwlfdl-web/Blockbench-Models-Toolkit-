import type { Clip, Interpolation, Keyframe, LoopMode, Vec3 } from '../model/types.js';
import { mergeKeys, kf } from './keys.js';

export interface ClipOptions {
  name: string;
  keys: Keyframe[];
  length: number;
  loop?: LoopMode;
  framesPerSecond?: number;
  blendWeight?: string;
}

/** Assemble a clip from one or more keyframe lists, de-duplicated and sorted. */
export function clip(options: ClipOptions): Clip {
  return {
    name: options.name,
    loop: options.loop ?? 'loop',
    length: options.length,
    framesPerSecond: options.framesPerSecond ?? 20,
    blendWeight: options.blendWeight ?? '',
    keys: mergeKeys(options.keys),
  };
}

export interface PoseEntry {
  time: number;
  rotations?: Record<string, Vec3>;
  positions?: Record<string, Vec3>;
  interpolation?: Interpolation;
}

/**
 * Build keyframes from pose snapshots: a list of `{ time, rotations, positions }` frames.
 * This is how one-shot clips (attack, roar, jump) are written — the shape of the action is
 * readable in the spec instead of buried in curve maths.
 */
export function pose(entries: PoseEntry[], interpolation: Interpolation = 'catmullrom'): Keyframe[] {
  const keys: Keyframe[] = [];
  for (const entry of entries) {
    const interp = entry.interpolation ?? interpolation;
    for (const [bone, value] of Object.entries(entry.rotations ?? {})) {
      keys.push(kf(bone, 'rotation', entry.time, value, interp));
    }
    for (const [bone, value] of Object.entries(entry.positions ?? {})) {
      keys.push(kf(bone, 'position', entry.time, value, interp));
    }
  }
  return keys;
}

/** A clip whose keys are supplied and whose length is inferred from the keys. */
export function clipAuto(options: Omit<ClipOptions, 'length'> & { length?: number }): Clip {
  const length = options.length ?? options.keys.reduce((max, key) => Math.max(max, key.time), 0);
  return clip({ ...options, length });
}
