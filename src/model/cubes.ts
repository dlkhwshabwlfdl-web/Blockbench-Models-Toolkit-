import type { Vec3 } from '../util/math.js';
import { midVec } from '../util/math.js';
import { transformPoint } from '../util/mat4.js';
import { elementMatrix } from './rotation.js';
import { FACE_NAMES } from './types.js';
import type { Cube, FaceName, UvRect } from './types.js';

export interface CubeOptions {
  name?: string;
  from: Vec3;
  to: Vec3;
  bone: string;
  /** Explicit UV windows for specific faces; everything else is decided by the UV policy. */
  faces?: Partial<Record<FaceName, UvRect>>;
  /** Element rotation origin. Defaults to the cube centre. */
  origin?: Vec3;
  rotation?: Vec3;
  /** Grows every side by `inflate` units, exactly like Blockbench's inflate field. */
  inflate?: number;
  color?: number;
  mirrorUv?: boolean;
  texture?: number;
  /** Faces to hide from rendering (interior faces, coincident faces). */
  hidden?: Iterable<FaceName>;
}

function minComponent(a: number, b: number): number {
  return Math.min(a, b);
}

function normalize(from: Vec3, to: Vec3): { from: Vec3; to: Vec3 } {
  return {
    from: [minComponent(from[0], to[0]), minComponent(from[1], to[1]), minComponent(from[2], to[2])],
    to: [Math.max(from[0], to[0]), Math.max(from[1], to[1]), Math.max(from[2], to[2])],
  };
}

/**
 * Build a cube element. `from`/`to` are normalised to min/max corners so a spec can be
 * written either way round — handy for mirrored limbs where the sign of X flips.
 */
export function makeCube(options: CubeOptions): Cube {
  const { from, to } = normalize(options.from, options.to);
  if (from[0] === to[0] || from[1] === to[1] || from[2] === to[2]) {
    throw new Error(`cube "${options.name ?? '?'}": zero-size on an axis (${from.join(',')} → ${to.join(',')})`);
  }
  if (!options.bone) throw new Error(`cube "${options.name ?? '?'}": needs a bone`);
  return {
    name: options.name ?? options.bone,
    from,
    to,
    bone: options.bone,
    faces: { ...(options.faces ?? {}) },
    origin: options.origin ? ([...options.origin] as Vec3) : midVec(from, to),
    rotation: options.rotation ? ([...options.rotation] as Vec3) : [0, 0, 0],
    inflate: options.inflate ?? 0,
    color: options.color ?? 0,
    mirrorUv: options.mirrorUv ?? false,
    texture: options.texture ?? 0,
    hidden: new Set(options.hidden ?? []),
  };
}

/** Faces this cube actually renders. */
export function visibleFaces(cube: Cube): FaceName[] {
  return FACE_NAMES.filter((face) => !cube.hidden.has(face));
}

/** Hide one face (idempotent). */
export function hideFace(cube: Cube, face: FaceName): void {
  cube.hidden.add(face);
}

/** Show a previously hidden face. */
export function showFace(cube: Cube, face: FaceName): void {
  cube.hidden.delete(face);
}

/** Size of the cube along each axis. */
export function cubeSize(cube: Cube): Vec3 {
  return [cube.to[0] - cube.from[0], cube.to[1] - cube.from[1], cube.to[2] - cube.from[2]];
}

/** Centre of the cube. */
export function cubeCenter(cube: Cube): Vec3 {
  return midVec(cube.from, cube.to);
}

export interface FaceFrame {
  /** Corner that maps to the UV rect's (u1, v1) corner. */
  base: Vec3;
  /** Unit basis for the texture's U axis. */
  uAxis: Vec3;
  /** Unit basis for the texture's V axis (points "down" the texture). */
  vAxis: Vec3;
  width: number;
  height: number;
  center: Vec3;
}

/**
 * Texture-space frame for a face.
 *
 * The convention matters because it is shared by the UV policy and the renderer: a face
 * whose frame says V runs along -Y is shaded and sampled the same way everywhere. Frames
 * are chosen so the texture reads correctly when the face is looked at from outside the box.
 */
export function faceFrame(cube: Cube, face: FaceName): FaceFrame {
  const [sizeX, sizeY, sizeZ] = cubeSize(cube);
  const { from, to } = cube;
  switch (face) {
    case 'north':
      return {
        base: [to[0], to[1], from[2]],
        uAxis: [-1, 0, 0],
        vAxis: [0, -1, 0],
        width: sizeX,
        height: sizeY,
        center: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, from[2]],
      };
    case 'south':
      return {
        base: [from[0], to[1], to[2]],
        uAxis: [1, 0, 0],
        vAxis: [0, -1, 0],
        width: sizeX,
        height: sizeY,
        center: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, to[2]],
      };
    case 'west':
      return {
        base: [from[0], to[1], from[2]],
        uAxis: [0, 0, 1],
        vAxis: [0, -1, 0],
        width: sizeZ,
        height: sizeY,
        center: [from[0], (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
      };
    case 'east':
      return {
        base: [to[0], to[1], to[2]],
        uAxis: [0, 0, -1],
        vAxis: [0, -1, 0],
        width: sizeZ,
        height: sizeY,
        center: [to[0], (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
      };
    case 'up':
      return {
        base: [from[0], to[1], from[2]],
        uAxis: [1, 0, 0],
        vAxis: [0, 0, 1],
        width: sizeX,
        height: sizeZ,
        center: [(from[0] + to[0]) / 2, to[1], (from[2] + to[2]) / 2],
      };
    case 'down':
      return {
        base: [from[0], from[1], to[2]],
        uAxis: [1, 0, 0],
        vAxis: [0, 0, -1],
        width: sizeX,
        height: sizeZ,
        center: [(from[0] + to[0]) / 2, from[1], (from[2] + to[2]) / 2],
      };
  }
}

/** The four corners of a face, ordered to match a UV rect's (u1,v1)→(u2,v2) corners. */
export function faceCorners(cube: Cube, face: FaceName): [Vec3, Vec3, Vec3, Vec3] {
  const frame = faceFrame(cube, face);
  const point = (u: number, v: number): Vec3 => [
    frame.base[0] + frame.uAxis[0] * u + frame.vAxis[0] * v,
    frame.base[1] + frame.uAxis[1] * u + frame.vAxis[1] * v,
    frame.base[2] + frame.uAxis[2] * u + frame.vAxis[2] * v,
  ];
  return [point(0, 0), point(frame.width, 0), point(frame.width, frame.height), point(0, frame.height)];
}

/**
 * The four corners of a face with the cube's **element rotation** applied.
 *
 * This is the geometry that actually ends up in the model: a non-voxel part is a box with a
 * rotation on it, and its silhouette comes from rotating the corners around the element
 * origin. `faceCorners` gives the unrotated frame (the UV contract); this gives the shape.
 */
export function posedFaceCorners(cube: Cube, face: FaceName): [Vec3, Vec3, Vec3, Vec3] {
  const local = faceCorners(cube, face);
  if (cube.rotation[0] === 0 && cube.rotation[1] === 0 && cube.rotation[2] === 0) return local;
  const matrix = elementMatrix(cube);
  return [
    transformPoint(matrix, local[0]),
    transformPoint(matrix, local[1]),
    transformPoint(matrix, local[2]),
    transformPoint(matrix, local[3]),
  ];
}

/**
 * Mirror a cube across the X axis. Returns a cube on the opposite side carrying the
 * counterpart name, so `torso` style naming (`left_` / `right_`) stays consistent.
 */
export function mirrorCube(cube: Cube, name: string, bone: string, faces?: Partial<Record<FaceName, UvRect>>): Cube {
  const flip = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];
  const from = flip(cube.to);
  const to = flip(cube.from);
  return makeCube({
    name,
    from,
    to,
    bone,
    faces: faces ?? cube.faces,
    origin: flip(cube.origin),
    rotation: cube.rotation,
    inflate: cube.inflate,
    color: cube.color,
    mirrorUv: !cube.mirrorUv,
    texture: cube.texture,
  });
}
