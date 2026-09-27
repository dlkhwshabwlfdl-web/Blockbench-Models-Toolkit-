import { Model } from './model/model.js';
import type { FaceName, LoopMode, UvRect } from './model/types.js';
import { Atlas } from './texture/atlas.js';
import { bands, grain as grainBrush, bevel } from './texture/brush.js';
import { hexToRgb, type Vec3 } from './util/math.js';
import { clip, pose as poseKeys, type PoseEntry } from './anim/clip.js';
import {
  breathe,
  defaultMotionRig,
  headTurn,
  idleSway,
  locomotion,
  tailWave,
  type MotionRig,
} from './anim/motion.js';
import type { Keyframe } from './model/types.js';

export interface MaterialSpec {
  /** Palette entry this material shades with. */
  palette?: string;
  /** Discrete bands across the island. 1 = flat. */
  steps?: number;
  contrast?: number;
  axis?: 'vertical' | 'horizontal';
  inverted?: boolean;
  /** Faint mottling amplitude; keep small. */
  grain?: number;
  /** Island size in pixels. Defaults to 16. */
  size?: number;
  /** Draw a light/dark bevel around the island. */
  bevel?: boolean;
}

export interface BoneSpec {
  name: string;
  pivot: Vec3;
  parent?: string | null;
  color?: number;
}

export interface CubeSpec {
  name?: string;
  from: Vec3;
  to: Vec3;
  bone: string;
  material?: string;
  faces?: Partial<Record<FaceName, UvRect>>;
  inflate?: number;
}

export type AnimationSpec =
  | ({ kind: 'locomotion'; name: string } & Omit<Parameters<typeof locomotion>[0], 'rig'>)
  | ({ kind: 'tailWave'; name: string } & Omit<Parameters<typeof tailWave>[0], 'rig'>)
  | ({ kind: 'breathe'; name: string } & Omit<Parameters<typeof breathe>[0], 'rig'>)
  | ({ kind: 'headTurn'; name: string } & Omit<Parameters<typeof headTurn>[0], 'rig'>)
  | ({ kind: 'idleSway'; name: string } & Omit<Parameters<typeof idleSway>[0], 'rig'>)
  | {
      kind: 'poses';
      name: string;
      length: number;
      loop?: LoopMode;
      poses: PoseEntry[];
      keyframes?: Keyframe[];
    };

export interface JsonSpec {
  name: string;
  resolution?: [number, number];
  identifier?: string;
  /** Named colours, `#rrggbb`. */
  palette: Record<string, string>;
  /** Material definitions. Defaults to one material per palette entry. */
  materials?: Record<string, MaterialSpec>;
  bones: BoneSpec[];
  cubes: CubeSpec[];
  animations?: AnimationSpec[];
  /** Override the motion-rig bone names used by the animation generators. */
  motionRig?: Partial<MotionRig>;
  createdAtlas?: boolean;
}

export interface ResolvedSpec {
  model: Model;
  atlas: Atlas;
  materials: Record<string, MaterialSpec>;
  warnings: string[];
}

/**
 * Turn a declarative JSON spec into a live `Model`.
 *
 * This exists so a model can be described entirely as data — the agent writes one JSON
 * object instead of a TypeScript program. Materials are the texture story: each material
 * claims a small atlas island painted with a discrete band ramp from the palette, and every
 * cube face assigned to it samples that island. Animations reference the built-in motion
 * generators by name, so a spec can describe a full locomotion cycle without curves.
 */
export function resolveSpec(spec: JsonSpec): ResolvedSpec {
  const warnings: string[] = [];
  const resolution = spec.resolution ?? [64, 64];
  const model = new Model({ name: spec.name, resolution, identifier: spec.identifier ?? `geometry.${spec.name}` });
  const atlas = new Atlas(resolution[0], resolution[1]);

  const materials: Record<string, MaterialSpec> = spec.materials
    ? { ...spec.materials }
    : Object.fromEntries(Object.keys(spec.palette).map((key) => [key, { palette: key } satisfies MaterialSpec]));
  if (Object.keys(materials).length === 0) {
    materials.default = { palette: Object.keys(spec.palette)[0] ?? 'default', steps: 3 };
  }

  // --- bones ---
  const boneNames = new Set<string>();
  for (const bone of spec.bones) {
    if (boneNames.has(bone.name)) {
      warnings.push(`spec: duplicate bone "${bone.name}" skipped`);
      continue;
    }
    const parent = bone.parent ?? null;
    if (parent !== null && !boneNames.has(parent)) {
      throw new Error(`spec: bone "${bone.name}" has parent "${parent}" declared later — order bones top-down`);
    }
    model.bone(bone.name, bone.pivot, parent, bone.color !== undefined ? { color: bone.color } : {});
    boneNames.add(bone.name);
  }
  if (spec.bones.filter((b) => (b.parent ?? null) === null).length > 1) {
    warnings.push('spec: more than one root bone');
  }

  // --- atlas islands per material ---
  const islandSize: Record<string, number> = {};
  for (const [name, material] of Object.entries(materials)) {
    const size = Math.max(4, Math.min(Math.round(material.size ?? 16), Math.min(resolution[0], resolution[1])));
    islandSize[name] = size;
    atlas.alloc(name, size, size);
  }

  // --- cubes ---
  for (const cube of spec.cubes) {
    const material = cube.material ?? Object.keys(materials)[0];
    if (material && !(material in materials)) {
      throw new Error(`spec: cube "${cube.name ?? cube.bone}" references unknown material "${material}"`);
    }
    model.cube({
      ...(cube.name !== undefined ? { name: cube.name } : {}),
      from: cube.from,
      to: cube.to,
      bone: cube.bone,
      ...(cube.inflate !== undefined ? { inflate: cube.inflate } : {}),
      ...(cube.faces !== undefined ? { faces: cube.faces } : {}),
    });
  }

  // --- paint islands + assign UV ---
  for (const [name, material] of Object.entries(materials)) {
    const rect = atlas.get(name);
    const paletteKey = material.palette ?? name;
    const color = spec.palette[paletteKey];
    if (!color) {
      warnings.push(`spec: material "${name}" references unknown palette colour "${paletteKey}"`);
      continue;
    }
    const steps = Math.max(1, Math.round(material.steps ?? 3));
    if (steps === 1) {
      atlas.canvas.rect(rect[0], rect[1], rect[2], rect[3], [...hexToRgb(color), 255]);
    } else {
      bands(atlas.canvas, rect, hexToRgb(color), {
        steps,
        contrast: material.contrast ?? 0.34,
        axis: material.axis ?? 'vertical',
        ...(material.inverted !== undefined ? { inverted: material.inverted } : {}),
      });
    }
    if (material.grain) {
      grainBrush(atlas.canvas, rect, hexToRgb(color), { amount: material.grain, scale: 0.9 });
    }
    if (material.bevel) bevel(atlas.canvas, rect, hexToRgb(color), {});
  }

  // Point each cube face at its material island. Explicit per-face UVs win.
  model.cubes.forEach((cube, index) => {
    const spec_ = spec.cubes[index];
    const material = spec_?.material ?? Object.keys(materials)[0];
    const rect = material && atlas.has(material) ? atlas.get(material) : null;
    if (!rect) return;
    for (const face of ['north', 'south', 'east', 'west', 'up', 'down'] as FaceName[]) {
      if (!cube.faces[face]) cube.faces[face] = [...rect] as UvRect;
    }
  });

  model.addTexture(atlas.toTexture(`${spec.name}_skin`, { useAsDefault: true }));

  // --- animations ---
  const rig: MotionRig = { ...defaultMotionRig(), ...(spec.motionRig ?? {}) };
  for (const animation of spec.animations ?? []) {
    switch (animation.kind) {
      case 'locomotion':
        model.addClip(clip({ name: animation.name, keys: locomotion({ rig, ...strip(animation) }), length: animation.length }));
        break;
      case 'tailWave':
        model.addClip(clip({ name: animation.name, keys: tailWave({ rig, ...strip(animation) }), length: animation.length }));
        break;
      case 'breathe':
        model.addClip(clip({ name: animation.name, keys: breathe({ rig, ...strip(animation) }), length: animation.length }));
        break;
      case 'headTurn':
        model.addClip(clip({ name: animation.name, keys: headTurn({ rig, ...strip(animation) }), length: animation.length ?? 0.9 }));
        break;
      case 'idleSway':
        model.addClip(clip({ name: animation.name, keys: idleSway({ rig, ...strip(animation) }), length: animation.length }));
        break;
      case 'poses':
        model.addClip(
          clip({
            name: animation.name,
            keys: [...poseKeys(animation.poses ?? []), ...(animation.keyframes ?? [])],
            length: animation.length,
            loop: animation.loop ?? 'once',
          }),
        );
        break;
      default:
        warnings.push(`spec: unknown animation kind "${(animation as { kind: string }).kind}"`);
    }
  }

  return { model, atlas, materials, warnings };
}

/**
 * Drop the discriminator fields the motion generators do not accept. Typed loosely on
 * purpose: the spec is data, and the generator options are validated by the generators.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function strip(animation: any): any {
  const { kind: _kind, name: _name, ...rest } = animation;
  return rest;
}
