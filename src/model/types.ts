import type { Vec3 } from '../util/math.js';

export type { Vec3 };

/** The six cube faces, in Blockbench's naming. Model space: +X left, +Y up, model faces +Z. */
export type FaceName = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';

export const FACE_NAMES: readonly FaceName[] = ['north', 'south', 'east', 'west', 'up', 'down'];

/** An outward-facing normal per face, in model space. */
export const FACE_NORMALS: Record<FaceName, Vec3> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

/** A UV rectangle in texture pixels: `[x1, y1, x2, y2]` with x1<x2 and y1<y2. */
export type UvRect = [number, number, number, number];

/** Interpolation modes Blockbench understands. */
export type Interpolation = 'linear' | 'catmullrom' | 'bezier' | 'step';

/** Animation loop behaviour. */
export type LoopMode = 'loop' | 'once' | 'hold';

export type AnimationChannel = 'rotation' | 'position' | 'scale';

/** A single bone in the rig. */
export interface Bone {
  name: string;
  /** Pivot (rotation origin) in model space. */
  pivot: Vec3;
  parent: string | null;
  rotation: Vec3;
  /** Marker colour index Blockbench shows in the outliner. */
  color: number;
  visibility: boolean;
  /** Element-scope: 0 = both, -1 = front, 1 = back (Blockbench view scopes). */
  scope: number;
}

/** One cube (a box element) belonging to a bone. */
export interface Cube {
  name: string;
  from: Vec3;
  to: Vec3;
  bone: string;
  /** Explicit per-face UV windows. Faces absent here fall through to the UV policy. */
  faces: Partial<Record<FaceName, UvRect>>;
  /** Element-local rotation origin. Defaults to the cube centre. */
  origin: Vec3;
  rotation: Vec3;
  /** Uniform inflation applied to every face. */
  inflate: number;
  color: number;
  /** When true the element mirrors across the X axis in Blockbench. */
  mirrorUv: boolean;
  /** Texture index this cube samples from. */
  texture: number;
  /**
   * Faces removed from rendering. An interior face — one fully covered by a neighbouring
   * cube — produces nothing but z-fighting, so the hygiene pass hides it. Hidden faces are
   * written to `.bbmodel` with `texture: null`, the way Blockbench represents "no texture",
   * and are skipped by validation, metrics, the renderer and the Java exporter.
   */
  hidden: Set<FaceName>;
}

/** A keyframe on one bone channel. */
export interface Keyframe {
  bone: string;
  channel: AnimationChannel;
  time: number;
  value: Vec3;
  interpolation: Interpolation;
}

/** One animation clip. */
export interface Clip {
  name: string;
  loop: LoopMode;
  length: number;
  framesPerSecond: number;
  /** Blend weight expression, Blockbench-side; usually ''. */
  blendWeight: string;
  keys: Keyframe[];
}

/** A texture image plus the metadata Blockbench stores. */
export interface Texture {
  name: string;
  width: number;
  height: number;
  /** PNG bytes. */
  data: Uint8Array;
  particle: boolean;
  useAsDefault: boolean;
  /** Fill mode for UVs Blockbench assigns automatically. */
  renderMode: string;
  renderSides: string;
  wrapMode: string;
  frameOrder: number[];
  frameTime: number;
  frameInterpolate: boolean;
}

/* --------------------------------------------------------------------- .bbmodel */

export interface BbmodelMeta {
  format_version: string;
  model_format: string;
  box_uv: boolean;
}

export interface BbmodelElement {
  name: string;
  box_uv: boolean;
  render_order: string;
  locked: boolean;
  export: boolean;
  scope: number;
  allow_mirror_modeling: boolean;
  from: number[];
  to: number[];
  autouv: number;
  color: number;
  origin: number[];
  rotation?: number[];
  inflate?: number;
  faces: Record<string, { uv: number[]; texture: number }>;
  type: 'cube';
  uuid: string;
}

export interface BbmodelGroup {
  name: string;
  uuid: string;
  export: boolean;
  locked: boolean;
  scope: number;
  selected: boolean;
  visibility: boolean;
  _static: { properties: Record<string, unknown>; temp_data: Record<string, unknown> };
  origin: number[];
  rotation: number[];
  color: number;
  children: string[];
  reset: boolean;
  shade: boolean;
  mirror_uv: boolean;
  autouv: number;
  isOpen: boolean;
  primary_selected: boolean;
}

export interface BbmodelOutlinerNode {
  uuid: string;
  isOpen: boolean;
  /** Groups are objects; elements are referenced by their uuid string. */
  children: Array<string | BbmodelOutlinerNode>;
}

export interface BbmodelTexture {
  name: string;
  path: string;
  folder: string;
  namespace: string;
  id: string;
  group: string;
  scope: number;
  width: number;
  height: number;
  uv_width: number;
  uv_height: number;
  particle: boolean;
  use_as_default: boolean;
  layers_enabled: boolean;
  sync_to_project: string;
  file_format: string;
  render_mode: string;
  render_sides: string;
  wrap_mode: string;
  pbr_channel: string;
  fps: number;
  frame_time: number;
  frame_order_type: string;
  frame_order: string;
  frame_interpolate: boolean;
  visible: boolean;
  internal: boolean;
  saved: boolean;
  uuid: string;
  source: string;
}

export interface BbmodelKeyframe {
  channel: AnimationChannel;
  data_points: Array<{ x: string | number; y: string | number; z: string | number }>;
  uuid: string;
  time: number;
  color: number;
  interpolation: Interpolation;
}

export interface BbmodelAnimator {
  name: string;
  type: 'bone';
  rotation_global: boolean;
  quaternion_interpolation: boolean;
  keyframes: BbmodelKeyframe[];
}

export interface BbmodelAnimation {
  uuid: string;
  name: string;
  loop: LoopMode;
  override: boolean;
  length: number;
  snapping: number;
  selected: boolean;
  group_name: string;
  scope: number;
  anim_time_update: string;
  blend_weight: string;
  start_delay: string;
  loop_delay: string;
  animators: Record<string, BbmodelAnimator>;
}

export interface BbmodelDocument {
  meta: BbmodelMeta;
  name: string;
  model_identifier: string;
  visible_box: number[];
  variable_placeholders: string;
  multi_file_ruleset: string;
  variable_placeholder_buttons: unknown[];
  timeline_setups: unknown[];
  unhandled_root_fields: Record<string, unknown>;
  resolution: { width: number; height: number };
  elements: BbmodelElement[];
  groups: BbmodelGroup[];
  outliner: BbmodelOutlinerNode[];
  textures: BbmodelTexture[];
  animations: BbmodelAnimation[];
}
