import type { Model } from '../model/model.js';
import { FACE_NAMES } from '../model/types.js';
import type { Clip, FaceName, Keyframe, Texture, UvRect, Vec3 } from '../model/types.js';
import { posedFaceCorners } from '../model/cubes.js';
import { elementMatrix } from '../model/rotation.js';
import { clamp, lerp } from '../util/math.js';
import {
  aroundOrigin,
  identity,
  multiply,
  rotationX,
  rotationY,
  rotationZ,
  rotationZYX,
  scaleMatrix,
  transformDirection,
  transformPoint,
  translation,
  type Mat4,
} from '../util/mat4.js';

// Re-exported so this module remains the single place the renderer's matrix helpers come from.
export {
  identity,
  multiply,
  translation,
  scaleMatrix,
  rotationX,
  rotationY,
  rotationZ,
  rotationZYX,
  transformPoint,
  transformDirection,
  aroundOrigin,
  type Mat4,
};

export interface BonePose {
  rotation: Vec3;
  position: Vec3;
  scale: Vec3;
}

export type Pose = Map<string, BonePose>;

/** Sample a clip at `time`, interpolating each channel between its keys. */
export function samplePose(clip: Clip, time: number): Pose {
  const pose: Pose = new Map();
  const read = (bone: string): BonePose => {
    let entry = pose.get(bone);
    if (!entry) {
      entry = { rotation: [0, 0, 0], position: [0, 0, 0], scale: [1, 1, 1] };
      pose.set(bone, entry);
    }
    return entry;
  };

  const byBoneChannel = new Map<string, Keyframe[]>();
  for (const key of clip.keys) {
    const id = `${key.bone}|${key.channel}`;
    const list = byBoneChannel.get(id);
    if (list) list.push(key);
    else byBoneChannel.set(id, [key]);
  }

  for (const [id, keys] of byBoneChannel) {
    const [bone, channel] = id.split('|') as [string, Keyframe['channel']];
    const sorted = [...keys].sort((a, b) => a.time - b.time);
    const value = sampleChannel(sorted, time);
    if (!value) continue;
    const entry = read(bone);
    if (channel === 'rotation') entry.rotation = value;
    else if (channel === 'position') entry.position = value;
    else entry.scale = value;
  }
  return pose;
}

function sampleChannel(keys: Keyframe[], time: number): Vec3 | null {
  if (keys.length === 0) return null;
  if (time <= keys[0].time) return keys[0].value;
  const last = keys[keys.length - 1];
  if (time >= last.time) return last.value;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i];
    const b = keys[i + 1];
    if (time < a.time || time > b.time) continue;
    if (b.time === a.time) return b.value;
    const raw = (time - a.time) / (b.time - a.time);
    // Smoothstep between keys keeps a preview from looking linear-jerky.
    const t = a.interpolation === 'linear' || a.interpolation === 'step' ? raw : raw * raw * (3 - 2 * raw);
    return [lerp(a.value[0], b.value[0], t), lerp(a.value[1], b.value[1], t), lerp(a.value[2], b.value[2], t)];
  }
  return last.value;
}

/**
 * Fold the rig hierarchy into one world matrix per bone.
 *
 * A bone's world transform is `parent · T(pivot) · R · S · T(-pivot)`: rotate and scale around
 * the bone's own pivot, then inherit the parent. This is exactly the transform Blockbench
 * uses, which is why a previewed pose matches the editor.
 */
export function boneWorldTransforms(model: Model, pose: Pose): Map<string, Mat4> {
  const world = new Map<string, Mat4>();
  for (const bone of model.rig.ordered()) {
    const local = pose.get(bone.name);
    const rotation = local?.rotation ?? bone.rotation;
    const position = local?.position ?? [0, 0, 0];
    const scale = local?.scale ?? [1, 1, 1];

    let m = translation(bone.pivot[0], bone.pivot[1], bone.pivot[2]);
    m = multiply(m, translation(position[0], position[1], position[2]));
    m = multiply(m, rotationZYX(rotation));
    if (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1) m = multiply(m, scaleMatrix(scale[0], scale[1], scale[2]));
    m = multiply(m, translation(-bone.pivot[0], -bone.pivot[1], -bone.pivot[2]));

    const parent = bone.parent ? world.get(bone.parent) : undefined;
    world.set(bone.name, parent ? multiply(parent, m) : m);
  }
  return world;
}

/* ------------------------------------------------------------------ scene ---- */

export interface SceneFace {
  /** Four corners, ordered to match the (u1,v1)→(u2,v2) corners of `uv`. */
  corners: [Vec3, Vec3, Vec3, Vec3];
  normal: Vec3;
  uv: UvRect | null;
  /** The cube this face came from, for diagnostics. */
  cube: string;
  face: FaceName;
}

export interface Scene {
  faces: SceneFace[];
  texture: Texture | null;
  bounds: { min: Vec3; max: Vec3 };
  /** True when the faces were produced by a posed rig. */
  posed: boolean;
}

const FACE_NORMAL_VECTORS: Record<FaceName, Vec3> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

/**
 * Flatten a model (optionally posed) into world-space faces.
 *
 * Two transforms are composed per face: the cube's **element** rotation around its own origin
 * (which is how a non-voxel model gets its angles), then its bone's world matrix. Baking both
 * into the corners keeps the rasteriser and the coincidence check completely ignorant of the
 * rig and of element rotation.
 */
export function buildScene(model: Model, pose?: Pose): Scene {
  const world = pose ? boneWorldTransforms(model, pose) : null;
  const faces: SceneFace[] = [];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (const cube of model.cubes) {
    const matrix = world?.get(cube.bone);
    const element = elementMatrix(cube);
    for (const face of FACE_NAMES) {
      if (cube.hidden.has(face)) continue;
      const local = posedFaceCorners(cube, face);
      const corners: [Vec3, Vec3, Vec3, Vec3] = matrix
        ? [
            transformPoint(matrix, local[0]),
            transformPoint(matrix, local[1]),
            transformPoint(matrix, local[2]),
            transformPoint(matrix, local[3]),
          ]
        : [local[0], local[1], local[2], local[3]];
      for (const corner of corners) {
        for (let axis = 0; axis < 3; axis += 1) {
          min[axis] = Math.min(min[axis], corner[axis]);
          max[axis] = Math.max(max[axis], corner[axis]);
        }
      }
      let normal = transformDirection(element, FACE_NORMAL_VECTORS[face]);
      if (matrix) normal = transformDirection(matrix, normal);
      faces.push({ corners, normal, uv: cube.faces[face] ?? null, cube: cube.name, face });
    }
  }

  if (faces.length === 0) {
    min[0] = min[1] = min[2] = 0;
    max[0] = max[1] = max[2] = 0;
  }

  return { faces, texture: model.textures[0] ?? null, bounds: { min, max }, posed: Boolean(pose) };
}

/** Rest-pose scene (no animation applied). */
export function restScene(model: Model): Scene {
  return buildScene(model);
}

/** Scene at a given time inside a clip. */
export function posedScene(model: Model, clip: Clip, time: number): Scene {
  return buildScene(model, samplePose(clip, clamp(time, 0, clip.length)));
}
