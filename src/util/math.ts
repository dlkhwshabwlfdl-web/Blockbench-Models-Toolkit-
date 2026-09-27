/**
 * Small numeric helpers shared by every layer. Kept dependency-free and pure so the
 * animation samplers stay reproducible across runs (same input → same keyframes).
 */

export type Vec3 = [number, number, number];

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Blockbench serialises floats with limited precision; match that to stay stable. */
export const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export const addVec = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const subVec = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scaleVec = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dotVec = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const crossVec = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const lengthVec = (a: Vec3): number => Math.sqrt(dotVec(a, a));
export const normalizeVec = (a: Vec3): Vec3 => {
  const length = lengthVec(a);
  return length === 0 ? [0, 0, 0] : scaleVec(a, 1 / length);
};
export const midVec = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** Deterministic 32-bit FNV-1a hash. Used for stable, seedable noise and UV placement. */
export function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Value noise with optional horizontal tiling (`periodX`), smoothed with a cubic fade. */
export function noise2(x: number, y: number, periodX = 0): number {
  const wrap = (value: number): number => {
    if (!periodX) return value;
    return ((value % periodX) + periodX) % periodX;
  };
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const sample = (ix: number, iy: number): number => {
    const h = hashString(`${wrap(ix)}:${iy}`);
    return (h % 100000) / 100000;
  };
  const top = lerp(sample(x0, y0), sample(x0 + 1, y0), smooth(fx));
  const bottom = lerp(sample(x0, y0 + 1), sample(x0 + 1, y0 + 1), smooth(fx));
  return lerp(top, bottom, smooth(fy));
}

/** Fractal (fBm) noise: a few octaves of `noise2` for organic mottling. */
export function fbm2(x: number, y: number, octaves = 3, periodX = 0): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += noise2(x * frequency, y * frequency, periodX ? periodX * frequency : 0) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total === 0 ? 0 : sum / total;
}

/** '#rrggbb' → [r, g, b]. */
export function hexToRgb(value: string): [number, number, number] {
  const hex = value.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** [r, g, b] → '#rrggbb'. */
export function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Blend two colours by `t` (0 → a, 1 → b). */
export function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Shift a colour's brightness by a signed amount in [-1, 1]. */
export function shadeRgb(rgb: [number, number, number], amount: number): [number, number, number] {
  if (amount >= 0) return mixRgb(rgb, [255, 255, 255], amount);
  return mixRgb(rgb, [0, 0, 0], -amount);
}
