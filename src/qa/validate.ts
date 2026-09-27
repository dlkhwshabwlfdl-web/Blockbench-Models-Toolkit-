import type { Model } from '../model/model.js';
import { FACE_NAMES } from '../model/types.js';
import { animatedBones, keyCountByBone } from '../anim/keys.js';

export interface ValidationReport {
  errors: string[];
  warnings: string[];
  info: string[];
  ok: boolean;
}

export interface ValidateOptions {
  /** Treat warnings as failures. */
  strict?: boolean;
  /** Warn when a clip animates a bone with no cube under it. */
  warnOnEmptyBones?: boolean;
}

const VALID_INTERPOLATION = new Set(['linear', 'catmullrom', 'bezier', 'step']);

/**
 * Check a model before it is written.
 *
 * This is the cheap safety net that catches the mistakes a generator actually makes:
 * a UV window hanging off the texture, a face with no UV at all, an animation keyed to a
 * bone that was renamed, a clip that ended up empty, duplicate cube names (which would
 * collide on the same uuid). It is deliberately independent of the exporters so it can run
 * before anything touches the disk.
 */
export function validate(model: Model, options: ValidateOptions = {}): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];
  const [texWidth, texHeight] = model.resolution;

  // --- rig ---
  if (model.rig.size === 0) errors.push('model has no bones — cubes cannot be animated');
  const roots = model.rig.all().filter((bone) => bone.parent === null);
  if (roots.length > 1) warnings.push(`model has ${roots.length} root bones; Blockbench expects a single root`);

  // --- cubes ---
  const seenNames = new Set<string>();
  for (const cube of model.cubes) {
    if (seenNames.has(cube.name)) {
      errors.push(`duplicate cube name "${cube.name}" — element uuids would collide`);
    }
    seenNames.add(cube.name);

    if (!model.rig.has(cube.bone)) {
      errors.push(`cube "${cube.name}" targets unknown bone "${cube.bone}"`);
    }
    for (let axis = 0; axis < 3; axis += 1) {
      if (cube.to[axis] <= cube.from[axis]) {
        errors.push(`cube "${cube.name}" has a non-positive size on axis ${'xyz'[axis]}`);
      }
    }
  }

  if (model.cubes.length === 0) errors.push('model has no cubes');

  // --- textures ---
  if (model.textures.length === 0) {
    warnings.push('model has no texture — faces will render untextured');
  }
  for (const texture of model.textures) {
    if (texture.width !== texWidth || texture.height !== texHeight) {
      warnings.push(
        `texture "${texture.name}" is ${texture.width}×${texture.height} but the project resolution is ${texWidth}×${texHeight}`,
      );
    }
    if (texture.data.length === 0) errors.push(`texture "${texture.name}" has no image data`);
  }

  // --- uv ---
  let unassigned = 0;
  for (const cube of model.cubes) {
    for (const face of FACE_NAMES) {
      const rect = cube.faces[face];
      if (!rect) {
        unassigned += 1;
        continue;
      }
      const [x1, y1, x2, y2] = rect;
      if (x2 <= x1 || y2 <= y1) {
        errors.push(`cube "${cube.name}" face ${face} has a zero-area uv window ${rect.join(',')}`);
      }
      if (x1 < 0 || y1 < 0 || x2 > texWidth || y2 > texHeight) {
        errors.push(
          `cube "${cube.name}" face ${face} uv ${rect.join(',')} is outside the ${texWidth}×${texHeight} texture`,
        );
      }
    }
  }
  if (unassigned > 0) {
    errors.push(`${unassigned} face(s) have no uv window — call model.assignUv() before exporting`);
  }

  // --- animations ---
  const clipNames = new Set<string>();
  for (const clip of model.clips) {
    if (clipNames.has(clip.name)) errors.push(`duplicate animation name "${clip.name}"`);
    clipNames.add(clip.name);

    if (clip.keys.length === 0) errors.push(`animation "${clip.name}" has no keyframes`);
    if (!(clip.length > 0)) errors.push(`animation "${clip.name}" has a non-positive length`);
    if (!(clip.framesPerSecond > 0)) warnings.push(`animation "${clip.name}" has a non-positive fps`);

    let outOfRange = 0;
    for (const key of clip.keys) {
      if (!model.rig.has(key.bone)) {
        errors.push(`animation "${clip.name}" keys unknown bone "${key.bone}"`);
      }
      if (!VALID_INTERPOLATION.has(key.interpolation)) {
        errors.push(`animation "${clip.name}" keyframe on "${key.bone}" has interpolation "${key.interpolation}"`);
      }
      if (key.time < 0 || key.time > clip.length + 1e-6) outOfRange += 1;
    }
    if (outOfRange > 0) {
      warnings.push(`animation "${clip.name}" has ${outOfRange} keyframe(s) outside 0..${clip.length}`);
    }

    const animated = animatedBones(clip.keys);
    if (animated.size === 0) warnings.push(`animation "${clip.name}" animates nothing`);
    const counts = keyCountByBone(clip.keys);
    for (const [bone, count] of counts) {
      if (count === 1 && clip.loop !== 'once') {
        info.push(`animation "${clip.name}" has a single key on "${bone}" — it will hold, not move`);
      }
    }
    if (options.warnOnEmptyBones) {
      for (const bone of animated) {
        if (model.cubesOf(bone).length === 0 && model.rig.childrenOf(bone).length === 0) {
          warnings.push(`animation "${clip.name}" animates "${bone}" which has no cubes or children`);
        }
      }
    }
  }

  for (const warning of model.warnings) warnings.push(warning);
  info.push(model.summary());

  const ok = errors.length === 0 && (!options.strict || warnings.length === 0);
  return { errors, warnings, info, ok };
}

/** Throwing variant for build scripts that should stop on the first problem. */
export function assertValid(model: Model, options: ValidateOptions = {}): ValidationReport {
  const report = validate(model, options);
  if (!report.ok) {
    const lines = [...report.errors.map((line) => `  ✖ ${line}`), ...report.warnings.map((line) => `  ! ${line}`)];
    throw new Error(`model "${model.name}" failed validation:\n${lines.join('\n')}`);
  }
  return report;
}

/** Render a report as a compact multi-line string for the console. */
export function formatReport(report: ValidationReport): string {
  const lines: string[] = [];
  for (const error of report.errors) lines.push(`✖ ${error}`);
  for (const warning of report.warnings) lines.push(`! ${warning}`);
  for (const entry of report.info) lines.push(`· ${entry}`);
  return lines.join('\n');
}
