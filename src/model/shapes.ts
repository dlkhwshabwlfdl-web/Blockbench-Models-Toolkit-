import type { Vec3 } from '../util/math.js';
import type { CubeOptions } from './cubes.js';
import type { Model } from './model.js';

/** Build `count` cubes, flattening away entries a callback returns `null`/`[]` for. */
export function series(
  count: number,
  fn: (index: number) => CubeOptions | CubeOptions[] | null,
): CubeOptions[] {
  const out: CubeOptions[] = [];
  for (let i = 0; i < count; i += 1) {
    const value = fn(i);
    if (!value) continue;
    if (Array.isArray(value)) out.push(...value);
    else out.push(value);
  }
  return out;
}

export interface MirrorPairOptions {
  /** The cube on the model's left (+X). */
  from: Vec3;
  to: Vec3;
  bone: string;
  /** Base name without the side prefix. */
  name: string;
  /** Bone for the mirrored side, when it differs (e.g. left_arm → right_arm). */
  mirroredBone?: string;
  mirroredName?: string;
}

/** Produce the left/right halves of a symmetric part in one call. */
export function mirrorPair(options: MirrorPairOptions): [CubeOptions, CubeOptions] {
  const left: CubeOptions = { ...options, name: options.name, from: options.from, to: options.to, bone: options.bone };
  const flippedFrom: Vec3 = [-options.to[0], options.from[1], options.from[2]];
  const flippedTo: Vec3 = [-options.from[0], options.to[1], options.to[2]];
  const right: CubeOptions = {
    ...options,
    name: options.mirroredName ?? `right_${options.name.replace(/^left_/, '')}`,
    from: flippedFrom,
    to: flippedTo,
    bone: options.mirroredBone ?? `right_${options.bone.replace(/^left_/, '')}`,
  };
  return [left, right];
}

export interface SpikesOptions {
  count: number;
  /** First spike's near corner. */
  start: Vec3;
  /** Distance between spike starts. */
  step: Vec3;
  /** Spike size (width, height, depth). */
  size: Vec3;
  bone: string;
  /** Name prefix; the index is appended. */
  prefix: string;
  /** Shrink each successive spike by this factor (1 = uniform). */
  taper?: number;
  /** Include both +X and −X rows, mirroring across the centre. */
  bothSides?: boolean;
}

/**
 * A row of small hard parts — teeth, claws, spikes, scutes along the tail. Each one is a
 * separate cube so it keeps a crisp edge instead of melting into the parent.
 */
export function spikes(options: SpikesOptions): CubeOptions[] {
  const taper = options.taper ?? 1;
  const out: CubeOptions[] = [];
  for (let i = 0; i < options.count; i += 1) {
    const scale = taper ** i;
    const start: Vec3 = [
      options.start[0] + options.step[0] * i,
      options.start[1] + options.step[1] * i,
      options.start[2] + options.step[2] * i,
    ];
    const size: Vec3 = [options.size[0] * scale, options.size[1] * scale, options.size[2] * scale];
    if (options.bothSides) {
      out.push({
        name: `${options.prefix}_left_${i}`,
        from: start,
        to: [start[0] + size[0], start[1] + size[1], start[2] + size[2]],
        bone: options.bone,
      });
      out.push({
        name: `${options.prefix}_right_${i}`,
        from: [-start[0] - size[0], start[1], start[2]],
        to: [-start[0], start[1] + size[1], start[2] + size[2]],
        bone: options.bone,
      });
    } else {
      out.push({
        name: `${options.prefix}_${i}`,
        from: start,
        to: [start[0] + size[0], start[1] + size[1], start[2] + size[2]],
        bone: options.bone,
      });
    }
  }
  return out;
}

export interface BoneChainOptions {
  /** Bone names, root first. The first name's parent is `parent`. */
  names: string[];
  /** Pivot for each name; same length as `names`. */
  pivots: Vec3[];
  /** Parent of the first bone; defaults to the model root. */
  parent?: string | null;
  color?: number;
}

/** Declare a straight bone chain (neck, tail, tentacle) and return the names. */
export function boneChain(model: Model, options: BoneChainOptions): string[] {
  if (options.names.length !== options.pivots.length) {
    throw new Error('boneChain: names and pivots must be the same length');
  }
  let parent = options.parent ?? null;
  const created: string[] = [];
  options.names.forEach((name, index) => {
    model.bone(name, options.pivots[index], parent, options.color !== undefined ? { color: options.color } : {});
    parent = name;
    created.push(name);
  });
  return created;
}

export interface SegmentedBoxesOptions {
  bone: string;
  /** Start of the first segment (min corner). */
  start: Vec3;
  /** Number of segments. */
  count: number;
  /** Size of the first segment. */
  size: Vec3;
  /** Per-segment size multiplier (tapering). */
  taper?: number;
  /** Per-segment offset of the next segment's min corner. */
  step: Vec3;
  /** Name prefix. */
  prefix: string;
}

/** A tapering run of boxes sharing one bone or spread across a chain — tails, trunks, necks. */
export function segmentedBoxes(options: SegmentedBoxesOptions): CubeOptions[] {
  const taper = options.taper ?? 0.92;
  const out: CubeOptions[] = [];
  for (let i = 0; i < options.count; i += 1) {
    const scale = taper ** i;
    const from: Vec3 = [
      options.start[0] + options.step[0] * i,
      options.start[1] + options.step[1] * i,
      options.start[2] + options.step[2] * i,
    ];
    const size: Vec3 = [options.size[0] * scale, options.size[1] * scale, options.size[2] * scale];
    out.push({
      name: `${options.prefix}_${i + 1}`,
      from,
      to: [from[0] + size[0], from[1] + size[1], from[2] + size[2]],
      bone: options.bone,
    });
  }
  return out;
}

/** A thin plate — fins, ridges, fins, sails. */
export function plate(options: {
  name: string;
  from: Vec3;
  to: Vec3;
  bone: string;
  thicknessAxis?: 'x' | 'y' | 'z';
  thickness?: number;
}): CubeOptions {
  const axis = options.thicknessAxis ?? 'x';
  const thickness = options.thickness ?? 1;
  const from: Vec3 = [...options.from];
  const to: Vec3 = [...options.to];
  const center = (from[axis === 'x' ? 0 : axis === 'y' ? 1 : 2] + to[axis === 'x' ? 0 : axis === 'y' ? 1 : 2]) / 2;
  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  from[index] = center - thickness / 2;
  to[index] = center + thickness / 2;
  return { name: options.name, from, to, bone: options.bone };
}
