import type { Vec3 } from '../util/math.js';
import type { Bone } from './types.js';

export interface BoneOptions {
  pivot: Vec3;
  parent?: string | null;
  rotation?: Vec3;
  color?: number;
  visibility?: boolean;
}

/**
 * A bone (Blockbench group) hierarchy.
 *
 * Bones own a pivot and a parent; cubes attach to bones. This is the only structure that
 * makes a model animatable, so every rig is built by declaring parents explicitly and the
 * class refuses cycles and duplicate names instead of silently producing a broken outliner.
 */
export class Rig {
  private readonly bones = new Map<string, Bone>();

  add(name: string, options: BoneOptions): Bone {
    if (this.bones.has(name)) throw new Error(`rig: bone "${name}" already exists`);
    const parent = options.parent ?? null;
    // Checked before existence so a self-parent reports the clearer error.
    if (name === parent) throw new Error(`rig: bone "${name}" cannot parent itself`);
    if (parent !== null && !this.bones.has(parent)) {
      throw new Error(`rig: parent "${parent}" of bone "${name}" does not exist yet — declare parents first`);
    }
    const bone: Bone = {
      name,
      pivot: [...options.pivot] as Vec3,
      parent,
      rotation: options.rotation ? ([...options.rotation] as Vec3) : [0, 0, 0],
      color: options.color ?? 0,
      visibility: options.visibility ?? true,
      scope: 0,
    };
    this.bones.set(name, bone);
    return bone;
  }

  /** Add only if absent; returns the existing bone otherwise. Handy for idempotent specs. */
  ensure(name: string, options: BoneOptions): Bone {
    return this.bones.get(name) ?? this.add(name, options);
  }

  get(name: string): Bone {
    const bone = this.bones.get(name);
    if (!bone) throw new Error(`rig: unknown bone "${name}"`);
    return bone;
  }

  has(name: string): boolean {
    return this.bones.has(name);
  }

  get size(): number {
    return this.bones.size;
  }

  get names(): string[] {
    return [...this.bones.keys()];
  }

  all(): Bone[] {
    return [...this.bones.values()];
  }

  childrenOf(name: string): Bone[] {
    return this.all().filter((bone) => bone.parent === name);
  }

  root(): Bone | undefined {
    return this.all().find((bone) => bone.parent === null);
  }

  /** Bones ordered so every parent precedes its children (insertion order as tiebreak). */
  ordered(): Bone[] {
    const out: Bone[] = [];
    const seen = new Set<string>();
    const visit = (bone: Bone): void => {
      if (seen.has(bone.name)) return;
      seen.add(bone.name);
      out.push(bone);
      for (const child of this.childrenOf(bone.name)) visit(child);
    };
    for (const bone of this.all()) if (bone.parent === null) visit(bone);
    for (const bone of this.all()) visit(bone);
    return out;
  }

  /** Chain from the root down to `name`, inclusive. */
  ancestry(name: string): Bone[] {
    const chain: Bone[] = [];
    let cursor: string | null = name;
    const guard = new Set<string>();
    while (cursor) {
      if (guard.has(cursor)) throw new Error(`rig: cycle detected at "${cursor}"`);
      guard.add(cursor);
      const bone = this.get(cursor);
      chain.unshift(bone);
      cursor = bone.parent;
    }
    return chain;
  }

  /** `name` plus every descendant, in parent-before-child order. */
  subtree(name: string): Bone[] {
    const out: Bone[] = [];
    const walk = (boneName: string): void => {
      out.push(this.get(boneName));
      for (const child of this.childrenOf(boneName)) walk(child.name);
    };
    walk(name);
    return out;
  }

  /** Depth of a bone from the root (root = 0). */
  depth(name: string): number {
    return this.ancestry(name).length - 1;
  }
}
