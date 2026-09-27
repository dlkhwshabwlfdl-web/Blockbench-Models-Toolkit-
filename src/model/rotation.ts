import type { Vec3 } from '../util/math.js';
import { aroundOrigin } from '../util/mat4.js';
import type { Cube } from './types.js';
// Type-only, so this does not create a runtime cycle with cubes.ts (which imports the value).
import type { CubeOptions } from './cubes.js';
import type { Mat4 } from '../util/mat4.js';

export type Axis = 'x' | 'y' | 'z';

const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };

/**
 * Element rotation exists on every cube in a `.bbmodel` and is completely legal — a voxel
 * model simply never uses it. These helpers make it usable, which is what turns a stack of
 * boxes into something with sloped snouts, tilted fins and chamfered edges.
 *
 * The rotation is applied around the cube's own `origin`, in the ZYX order Blockbench uses,
 * and is evaluated by `posedFaceCorners` so bounds, rendering and the geometry checks all
 * agree about where the rotated box actually is.
 */

/** The transform a cube's element rotation applies: `T(origin) · R · T(−origin)`. */
export function elementMatrix(cube: { rotation: Vec3; origin: Vec3 }): Mat4 {
  return aroundOrigin(cube.rotation, cube.origin);
}

/** Set a cube's rotation, leaving its origin alone (defaults to the cube centre). */
export function setRotation(cube: Cube, rotation: Vec3, origin?: Vec3): Cube {
  cube.rotation = [...rotation] as Vec3;
  if (origin) cube.origin = [...origin] as Vec3;
  return cube;
}

/** Compose a single-axis rotation onto a cube's existing rotation. */
export function rotateAround(cube: Cube, axis: Axis, degrees: number, origin?: Vec3): Cube {
  cube.rotation[AXIS_INDEX[axis]] += degrees;
  if (origin) cube.origin = [...origin] as Vec3;
  return cube;
}

/** Clear a cube's rotation (back to pure voxel). */
export function clearRotation(cube: Cube): Cube {
  cube.rotation = [0, 0, 0];
  return cube;
}

/** `CubeOptions` with a rotation, for use with `model.cube({...})`. */
export function rotated(options: CubeOptions, rotation: Vec3, origin?: Vec3): CubeOptions {
  return { ...options, rotation, ...(origin ? { origin } : {}) };
}

/* ------------------------------------------------------------------- bevel ---- */

export type EdgeName =
  | 'top-front'
  | 'top-back'
  | 'top-left'
  | 'top-right'
  | 'bottom-front'
  | 'bottom-back'
  | 'bottom-left'
  | 'bottom-right'
  | 'front-left'
  | 'front-right'
  | 'back-left'
  | 'back-right';

interface EdgePart {
  axis: 0 | 1 | 2;
  sign: 1 | -1;
}

const EDGE_PARTS: Record<string, EdgePart> = {
  // +X is the model's left, +Z is the direction it faces.
  left: { axis: 0, sign: 1 },
  right: { axis: 0, sign: -1 },
  top: { axis: 1, sign: 1 },
  bottom: { axis: 1, sign: -1 },
  front: { axis: 2, sign: 1 },
  back: { axis: 2, sign: -1 },
};

export interface BevelEdgesOptions {
  name: string;
  from: Vec3;
  to: Vec3;
  bone: string;
  /** Which edges to bevel. */
  edges: EdgeName[];
  /** How far the bevel reaches along each adjoining face. */
  chamfer?: number;
  /**
   * How deep the bevel strip sits inside the box, as a fraction of `chamfer`.
   * `0.5` (the default) leaves a slim diagonal ridge proud of the corner;
   * `1` buries it completely; `0.25` makes it stand out more.
   */
  inset?: number;
  color?: number;
}

/**
 * Build 45° bevel strips along the edges of a box.
 *
 * A cube model cannot subtract material, so a bevel is built the other way round: a square
 * strip rotated 45° about the edge, sunk into the parent by `inset`, so that only a thin
 * diagonal face pokes out. That is enough to break a hard corner, and it costs one cube per
 * edge instead of a rebuilt silhouette.
 *
 * Buried faces still produce z-fighting inside the parent, so run `geometricHygiene()` after
 * adding bevels — it will hide whichever faces are covered.
 */
export function bevelEdges(options: BevelEdgesOptions): CubeOptions[] {
  const chamfer = options.chamfer ?? 1.5;
  const inset = options.inset ?? 0.5;
  const out: CubeOptions[] = [];

  options.edges.forEach((edgeName, index) => {
    const parts = edgeName.split('-').map((part) => {
      const found = EDGE_PARTS[part];
      if (!found) throw new Error(`bevelEdges: unknown edge "${edgeName}"`);
      return found;
    });
    if (parts.length !== 2 || parts[0].axis === parts[1].axis) {
      throw new Error(`bevelEdges: "${edgeName}" must name two different axes`);
    }

    const [a, b] = parts;
    const freeAxis = ([0, 1, 2] as const).find((axis) => axis !== a.axis && axis !== b.axis);
    if (freeAxis === undefined) throw new Error(`bevelEdges: could not resolve the free axis for "${edgeName}"`);

    // Where the edge sits on each pinned axis.
    const edgeA = a.sign > 0 ? options.to[a.axis] : options.from[a.axis];
    const edgeB = b.sign > 0 ? options.to[b.axis] : options.from[b.axis];
    const centerA = edgeA - a.sign * chamfer * inset;
    const centerB = edgeB - b.sign * chamfer * inset;

    const half = chamfer / 2;
    const from: Vec3 = [...options.from];
    const to: Vec3 = [...options.to];
    from[a.axis] = centerA - half;
    to[a.axis] = centerA + half;
    from[b.axis] = centerB - half;
    to[b.axis] = centerB + half;

    // Rotate about the free axis by ±45° and keep the sign that pushes a corner outward
    // along the edge's diagonal, so the strip leans into the corner rather than away from it.
    const diagonalA = a.sign;
    const diagonalB = b.sign;
    const score = (degrees: number): number => {
      const theta = (degrees * Math.PI) / 180;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const corners: Array<[number, number]> = [
        [-half, -half],
        [half, -half],
        [half, half],
        [-half, half],
      ];
      // Rotation about the free axis mixes the two pinned axes (A ← A·cos − B·sin, B ← A·sin + B·cos).
      return Math.max(
        ...corners.map(([u, v]) => (u * cos - v * sin) * diagonalA + (u * sin + v * cos) * diagonalB),
      );
    };
    const degrees = score(45) >= score(-45) ? 45 : -45;

    const rotation: Vec3 = [0, 0, 0];
    rotation[freeAxis] = degrees;
    const origin: Vec3 = [0, 0, 0];
    origin[a.axis] = centerA;
    origin[b.axis] = centerB;
    origin[freeAxis] = (options.from[freeAxis] + options.to[freeAxis]) / 2;

    out.push({
      name: `${options.name}_bevel_${edgeName.replace('-', '_')}_${index}`,
      from,
      to,
      bone: options.bone,
      rotation,
      origin,
      ...(options.color !== undefined ? { color: options.color } : {}),
    });
  });

  return out;
}

/**
 * A rotated slab: the general tool for a slope, a fin, an angled plate.
 *
 * The useful trick is that the buried end is invisible, so a box rotated 15–25° can slope a
 * surface without any subtraction — put the rotation origin at the buried edge and the
 * visible part becomes a wedge.
 */
export function slab(options: {
  name: string;
  from: Vec3;
  to: Vec3;
  bone: string;
  /** Rotation in degrees on one axis. */
  axis: Axis;
  degrees?: number;
  /** Pivot for the rotation. Defaults to the slab's centre. */
  origin?: Vec3;
  color?: number;
}): CubeOptions {
  const rotation: Vec3 = [0, 0, 0];
  rotation[AXIS_INDEX[options.axis]] = options.degrees ?? 0;
  return {
    name: options.name,
    from: options.from,
    to: options.to,
    bone: options.bone,
    rotation,
    ...(options.origin ? { origin: options.origin } : {}),
    ...(options.color !== undefined ? { color: options.color } : {}),
  };
}
