import type { Vec3 } from '../util/math.js';
import { Rig, type BoneOptions } from './rig.js';
import { makeCube, type CubeOptions } from './cubes.js';
import { assignUv, type AssignedFace, type UvPolicy } from './uv.js';
import type { Bone, Clip, Cube, Texture } from './types.js';

export interface ModelOptions {
  name: string;
  /** Texture resolution in pixels. Defaults to 64×64 like a vanilla entity skin. */
  resolution?: [number, number];
  /** Identifier Blockbench stores for the model (bedrock/geckolib). */
  identifier?: string;
  uvPolicy?: UvPolicy;
}

/**
 * A model under construction: a rig, its cubes, its textures and its animations.
 *
 * Everything else in the toolkit reads or writes a `Model`. It deliberately has no notion
 * of Blockbench: it is a plain in-memory description that the exporters serialise into
 * whatever format is asked for.
 */
export class Model {
  readonly name: string;
  readonly rig = new Rig();
  readonly cubes: Cube[] = [];
  readonly textures: Texture[] = [];
  readonly clips: Clip[] = [];
  /**
   * Non-fatal problems collected while building (e.g. a motion generator driving a bone
   * this model does not have). Read by build scripts and surfaced by `validate()`.
   */
  readonly warnings: string[] = [];
  resolution: [number, number];
  identifier: string;
  uvPolicy: UvPolicy;

  constructor(options: ModelOptions) {
    this.name = options.name;
    this.resolution = options.resolution ?? [64, 64];
    this.identifier = options.identifier ?? 'geometry.unknown';
    this.uvPolicy = options.uvPolicy ?? {};
  }

  /** Declare a bone. Parents must already exist — build the rig top-down. */
  bone(name: string, pivot: Vec3, parent: string | null = null, extra: Partial<BoneOptions> = {}): Bone {
    return this.rig.add(name, { pivot, parent, ...extra });
  }

  /** Add a cube attached to an existing bone. */
  cube(options: CubeOptions): Cube {
    if (!this.rig.has(options.bone)) {
      throw new Error(`model: cube "${options.name ?? '?'}" targets unknown bone "${options.bone}"`);
    }
    const cube = makeCube(options);
    this.cubes.push(cube);
    return cube;
  }

  addTexture(texture: Texture): Texture {
    this.textures.push(texture);
    return texture;
  }

  /**
   * Attach a clip. Keys that target bones this model does not have are dropped rather than
   * written — a motion generator names a conventional rig, and a model is free not to have
   * every bone. The dropped names are recorded on `warnings` so it is never silent.
   */
  addClip(clip: Clip): Clip {
    const kept = clip.keys.filter((key) => this.rig.has(key.bone));
    if (kept.length !== clip.keys.length) {
      const missing = [...new Set(clip.keys.filter((key) => !this.rig.has(key.bone)).map((key) => key.bone))];
      this.warnings.push(`animation "${clip.name}": dropped keys for bones this model lacks: ${missing.join(', ')}`);
    }
    if (kept.length === 0) {
      this.warnings.push(`animation "${clip.name}": no keys target an existing bone — clip skipped`);
      return clip;
    }
    this.clips.push({ ...clip, keys: kept });
    return clip;
  }

  boneOf(cube: Cube): Bone {
    return this.rig.get(cube.bone);
  }

  cubesOf(bone: string): Cube[] {
    return this.cubes.filter((cube) => cube.bone === bone);
  }

  findCube(name: string): Cube | undefined {
    return this.cubes.find((cube) => cube.name === name);
  }

  /** Resolve every face's UV window using the model's policy. Idempotent. */
  assignUv(policy?: UvPolicy): AssignedFace[] {
    this.uvTrace = assignUv(this.cubes, policy ?? this.uvPolicy, this.resolution);
    return this.uvTrace;
  }

  /** Which rule last claimed each face, after the most recent `assignUv()`. */
  uvTrace: AssignedFace[] = [];

  /** Axis-aligned bounds over every cube, including inflate. */
  bounds(): { min: Vec3; max: Vec3 } {
    if (this.cubes.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const cube of this.cubes) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], cube.from[axis] - cube.inflate);
        max[axis] = Math.max(max[axis], cube.to[axis] + cube.inflate);
      }
    }
    return { min, max };
  }

  /** Overall size per axis. */
  size(): Vec3 {
    const { min, max } = this.bounds();
    return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  }

  /** Set every cube's `bone` to a different bone. Useful when re-parenting a sub-tree. */
  reassign(fromBone: string, toBone: string): number {
    if (!this.rig.has(toBone)) throw new Error(`model: cannot reassign to unknown bone "${toBone}"`);
    let count = 0;
    for (const cube of this.cubes) {
      if (cube.bone === fromBone) {
        cube.bone = toBone;
        count += 1;
      }
    }
    return count;
  }

  /** Move every cube in a bone's subtree by `delta`. Returns cubes touched. */
  translateBone(bone: string, delta: Vec3): number {
    const names = new Set(this.rig.subtree(bone).map((b) => b.name));
    let count = 0;
    for (const cube of this.cubes) {
      if (!names.has(cube.bone)) continue;
      for (let axis = 0; axis < 3; axis += 1) {
        cube.from[axis] += delta[axis];
        cube.to[axis] += delta[axis];
        cube.origin[axis] += delta[axis];
      }
      count += 1;
    }
    for (const b of this.rig.subtree(bone)) {
      for (let axis = 0; axis < 3; axis += 1) b.pivot[axis] += delta[axis];
    }
    return count;
  }

  summary(): string {
    const bones = this.rig.size;
    const animated = new Set(this.clips.flatMap((clip) => clip.keys.map((key) => key.bone)));
    const keys = this.clips.reduce((sum, clip) => sum + clip.keys.length, 0);
    const size = this.size().map((n) => Math.round(n * 10) / 10);
    return (
      `${this.name}: ${this.cubes.length} cubes · ${bones} bones · ` +
      `${this.clips.length} animations (${keys} keys, ${animated.size} bones animated) · ` +
      `${this.textures.length} texture(s) · bounds ${size.join('×')}`
    );
  }
}
