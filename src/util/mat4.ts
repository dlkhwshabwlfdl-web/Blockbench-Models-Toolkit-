import type { Vec3 } from './math.js';

/**
 * Column-major 4×4 matrices, indexed `m[column * 4 + row]` (the three.js convention).
 *
 * Lives in `util` rather than in the renderer because the model layer needs it too: a cube's
 * element rotation has to be evaluated when computing its corners (for bounds, for rendering,
 * and for the coincidence check). One implementation means a rotated cube's geometry is
 * described identically everywhere.
 */
export type Mat4 = Float64Array;

export function identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function translation(x: number, y: number, z: number): Mat4 {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

export function scaleMatrix(x: number, y: number, z: number): Mat4 {
  const m = new Float64Array(16);
  m[0] = x;
  m[5] = y;
  m[10] = z;
  m[15] = 1;
  return m;
}

const DEG = Math.PI / 180;

export function rotationX(degrees: number): Mat4 {
  const c = Math.cos(degrees * DEG);
  const s = Math.sin(degrees * DEG);
  const m = identity();
  m[5] = c;
  m[6] = s;
  m[9] = -s;
  m[10] = c;
  return m;
}

export function rotationY(degrees: number): Mat4 {
  const c = Math.cos(degrees * DEG);
  const s = Math.sin(degrees * DEG);
  const m = identity();
  m[0] = c;
  m[2] = -s;
  m[8] = s;
  m[10] = c;
  return m;
}

export function rotationZ(degrees: number): Mat4 {
  const c = Math.cos(degrees * DEG);
  const s = Math.sin(degrees * DEG);
  const m = identity();
  m[0] = c;
  m[1] = s;
  m[4] = -s;
  m[5] = c;
  return m;
}

/**
 * Euler → matrix using the ZYX order Blockbench applies to group and element rotations, so a
 * rotation written in a script previews the way Blockbench would show it.
 */
export function rotationZYX(rotation: Vec3): Mat4 {
  return multiply(multiply(rotationZ(rotation[2]), rotationY(rotation[1])), rotationX(rotation[0]));
}

export function transformPoint(m: Mat4, point: Vec3): Vec3 {
  return [
    m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12],
    m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13],
    m[2] * point[0] + m[6] * point[1] + m[10] * point[2] + m[14],
  ];
}

/** Apply only the linear part — used for normals. */
export function transformDirection(m: Mat4, direction: Vec3): Vec3 {
  return [
    m[0] * direction[0] + m[4] * direction[1] + m[8] * direction[2],
    m[1] * direction[0] + m[5] * direction[1] + m[9] * direction[2],
    m[2] * direction[0] + m[6] * direction[1] + m[10] * direction[2],
  ];
}

/** `T(origin) · R · S · T(−origin)`: rotate and scale around a point. */
export function aroundOrigin(rotation: Vec3, origin: Vec3, scale: Vec3 = [1, 1, 1]): Mat4 {
  let m = translation(origin[0], origin[1], origin[2]);
  m = multiply(m, rotationZYX(rotation));
  if (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1) m = multiply(m, scaleMatrix(scale[0], scale[1], scale[2]));
  m = multiply(m, translation(-origin[0], -origin[1], -origin[2]));
  return m;
}

/** Swap the 3×3 linear block's rows and columns, leaving translation alone. */
export function transposeLinear(m: Mat4): Mat4 {
  const out = new Float64Array(16);
  out[0] = m[0];
  out[1] = m[4];
  out[2] = m[8];
  out[4] = m[1];
  out[5] = m[5];
  out[6] = m[9];
  out[8] = m[2];
  out[9] = m[6];
  out[10] = m[10];
  out[12] = m[12];
  out[13] = m[13];
  out[14] = m[14];
  out[15] = 1;
  return out;
}

/**
 * The inverse of `aroundOrigin(rotation, origin)`.
 *
 * Not `aroundOrigin` with the angles negated: `rotationZYX` composes as `Rz·Ry·Rx`, so its
 * inverse is `Rxᵀ·Ryᵀ·Rzᵀ` and negating the angles rebuilds them in the wrong order. Transposing
 * the linear block is correct for any composition order, which matters because the QA checks use
 * this to map a world point back into a rotated cube's own frame.
 */
export function invertAround(rotation: Vec3, origin: Vec3): Mat4 {
  const inv = transposeLinear(rotationZYX(rotation));
  return multiply(multiply(translation(origin[0], origin[1], origin[2]), inv), translation(-origin[0], -origin[1], -origin[2]));
}
