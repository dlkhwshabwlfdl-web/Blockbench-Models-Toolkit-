/**
 * @trex/aimodel — build Minecraft models, textures, UV atlases and animations by script.
 *
 * Typical flow:
 *
 * ```ts
 * import { Model, Atlas, bandFill, defaultMotionRig, locomotion, clip, validate,
 *          writeBbmodel, writeJavaModel, contactSheet, metrics } from '@trex/aimodel';
 *
 * const model = new Model({ name: 'crate', resolution: [32, 32] });
 * model.bone('root', [0, 0, 0]);
 * model.bone('lid', [0, 12, 0], 'root');
 * model.cube({ name: 'body', from: [-8, 0, -8], to: [8, 12, 8], bone: 'root' });
 * ...
 * ```
 *
 * Everything is in-memory until an exporter writes it to disk, so a script can build,
 * validate, render and export in any order.
 */

export {
  auditSeal,
  findBuriedFaces,
  formatOcclusion,
  formatSeal,
  penetrationDepth,
  type BuriedFace,
  type OcclusionReport,
  type SealOptions,
  type SealPair,
  type SealReport,
} from './qa/assembly.js';
export { Model, type ModelOptions } from './model/model.js';
export { Rig, type BoneOptions } from './model/rig.js';
export {
  makeCube,
  faceFrame,
  faceCorners,
  cubeSize,
  cubeCenter,
  mirrorCube,
  visibleFaces,
  posedFaceCorners,
  type CubeOptions,
  type FaceFrame,
} from './model/cubes.js';
export {
  assignUv,
  skinFieldPolicy,
  boxUv,
  type UvPolicy,
  type UvRule,
  type AssignedFace,
  type SkinFieldOptions,
} from './model/uv.js';
export {
  series,
  mirrorPair,
  spikes,
  boneChain,
  segmentedBoxes,
  plate,
  type MirrorPairOptions,
  type SpikesOptions,
  type BoneChainOptions,
  type SegmentedBoxesOptions,
} from './model/shapes.js';
export {
  setRotation,
  rotateAround,
  clearRotation,
  elementMatrix,
  bevelEdges,
  slab,
  type Axis,
  type EdgeName,
  type BevelEdgesOptions,
} from './model/rotation.js';
export {
  findCoincidentFaces,
  findDuplicateCubes,
  geometricHygiene,
  formatCoincidence,
  type CoincidenceKind,
  type CoincidentPair,
  type CoincidenceReport,
  type FindOptions,
  type HygieneOptions,
  type HygieneResult,
} from './qa/coincident.js';
export {
  FACE_NAMES,
  FACE_NORMALS,
  type Bone,
  type Clip,
  type Cube,
  type FaceName,
  type Interpolation,
  type Keyframe,
  type LoopMode,
  type Texture,
  type UvRect,
  type AnimationChannel,
} from './model/types.js';

export { Canvas, TRANSPARENT, WHITE, BLACK, type Rect, type Rgba } from './texture/canvas.js';
export {
  harmonize,
  deriveShade,
  bridgeColors,
  softenSeams,
  resolveStyle,
  rgbToHsl,
  hslToRgb,
  rgbaOf,
  colourUtils,
  SURFACE_STYLES,
  type SurfaceStyle,
  type SurfaceStyleName,
  type HarmonizeOptions,
  type DeriveShadeOptions,
  type SoftenSeamsOptions,
  type SoftenSeamsResult,
} from './texture/harmony.js';
export { Atlas, islandRules } from './texture/atlas.js';
export { Palette, ramp, rgba, tint, type RampOptions, type PaletteEntry, type Rgb } from './texture/palette.js';
export {
  fill,
  grain,
  bands,
  bevel,
  seam,
  outline,
  radial,
  eye,
  blotch,
  dither,
  blendPixel,
  eachPixel,
  BAYER_2,
  type BandOptions,
  type GrainOptions,
  type BevelOptions,
  type SeamOptions,
  type EyeOptions,
  type BlotchOptions,
  type RadialOptions,
} from './texture/brush.js';

export {
  kf,
  rot,
  rot3,
  pos,
  pos3,
  scale,
  scaleUniform,
  sortKeys,
  dedupeKeys,
  mergeKeys,
  keyCountByBone,
  animatedBones,
  maxTime,
} from './anim/keys.js';
export {
  cycle,
  cycleBones,
  chain,
  sin,
  cos,
  saw,
  triangle,
  bump,
  pulse,
  ease,
  rampUp,
  decay,
  frac,
  wrap01,
  TAU,
} from './anim/curves.js';
export {
  locomotion,
  tailWave,
  breathe,
  headTurn,
  idleSway,
  defaultMotionRig,
  inferMotionRig,
  type BoneHint,
  type MotionRig,
  type LocomotionOptions,
  type TailWaveOptions,
  type BreatheOptions,
  type HeadTurnOptions,
  type IdleSwayOptions,
} from './anim/motion.js';
export { clip, clipAuto, pose, type ClipOptions, type PoseEntry } from './anim/clip.js';

export * from './export/index.js';
export * from './render/index.js';
export {
  resolveSpec,
  type JsonSpec,
  type ResolvedSpec,
  type MaterialSpec,
  type BoneSpec,
  type CubeSpec,
  type AnimationSpec,
} from './spec.js';
export {
  validate,
  assertValid,
  formatReport,
  type ValidationReport,
  type ValidateOptions,
} from './qa/validate.js';

export { clamp, lerp, round3, hashString, noise2, fbm2, hexToRgb, rgbToHex, mixRgb, shadeRgb, type Vec3 } from './util/math.js';
export { uuidFor, UuidSpace } from './util/uuid.js';
