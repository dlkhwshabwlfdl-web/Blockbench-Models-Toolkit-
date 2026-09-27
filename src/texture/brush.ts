import { clamp, fbm2, hashString, lerp, mixRgb, noise2, shadeRgb } from '../util/math.js';
import type { Canvas, Rect, Rgba } from './canvas.js';
import type { Rgb } from './palette.js';
import { ramp, rgba } from './palette.js';

/** Iterate every pixel of a half-open rect, clipped to the canvas. */
export function eachPixel(canvas: Canvas, rect: Rect, fn: (x: number, y: number) => void): void {
  const left = Math.max(0, Math.min(rect[0], rect[2]));
  const right = Math.min(canvas.width, Math.max(rect[0], rect[2]));
  const top = Math.max(0, Math.min(rect[1], rect[3]));
  const bottom = Math.min(canvas.height, Math.max(rect[1], rect[3]));
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) fn(x, y);
  }
}

/** Flat fill. The workhorse. */
export function fill(canvas: Canvas, rect: Rect, color: Rgba): void {
  eachPixel(canvas, rect, (x, y) => canvas.set(x, y, color));
}

export interface GrainOptions {
  /** Peak ± channel offset. Default 6 — subtle; large values read as noise/dirt. */
  amount?: number;
  /** Noise frequency. Lower = broader mottling. */
  scale?: number;
  /** Seed salt so two fills with the same options differ. */
  seed?: number;
  /** Add occasional darker blotches (natural skin mottling). */
  blotch?: number;
}

/**
 * Fill with very low-amplitude value noise. This is the *only* noise helper, and its
 * default amplitude is deliberately small: heavy noise or a dither pattern is what makes
 * generated Minecraft art look dirty, so the toolkit keeps it faint and off the shading path.
 */
export function grain(canvas: Canvas, rect: Rect, color: Rgb, options: GrainOptions = {}): void {
  const amount = options.amount ?? 6;
  const scale = options.scale ?? 0.7;
  const seed = options.seed ?? 0;
  const blotch = options.blotch ?? 0;
  eachPixel(canvas, rect, (x, y) => {
    const offset = (noise2(x * scale + seed, y * scale, 0) - 0.5) * 2 * amount;
    const blotchValue = blotch
      ? (noise2(x * scale * 0.28 + seed * 3, y * scale * 0.28 + seed, 3) > 0.66 ? -blotch : 0)
      : 0;
    canvas.set(x, y, [
      clamp(Math.round(color[0] + offset + blotchValue), 0, 255),
      clamp(Math.round(color[1] + offset + blotchValue), 0, 255),
      clamp(Math.round(color[2] + offset + blotchValue), 0, 255),
      255,
    ]);
  });
}

export interface BandOptions {
  steps?: number;
  contrast?: number;
  bias?: number;
  /** Direction of the light→shadow progression. */
  axis?: 'vertical' | 'horizontal';
  /** Reverse so the light end is at the top/left. */
  inverted?: boolean;
  /** Blend each band toward another colour by this amount. */
  tintToward?: Rgb;
  tintAmount?: number;
}

/**
 * Fill a rect with discrete flat bands sampled from a ramp.
 *
 * This is the idiomatic Minecraft shade: three or so clearly separated values, no blending
 * between them. Band boundaries are snapped to whole pixels so the result stays crisp at
 * texture scale.
 */
export function bands(canvas: Canvas, rect: Rect, base: Rgb, options: BandOptions = {}): void {
  const steps = Math.max(2, Math.round(options.steps ?? 3));
  const shades = ramp(base, {
    steps,
    contrast: options.contrast ?? 0.42,
    bias: options.bias ?? 0.5,
  });
  const axis = options.axis ?? 'vertical';
  const width = Math.abs(rect[2] - rect[0]);
  const height = Math.abs(rect[3] - rect[1]);
  const span = axis === 'vertical' ? height : width;
  eachPixel(canvas, rect, (x, y) => {
    const local = axis === 'vertical' ? y - Math.min(rect[1], rect[3]) : x - Math.min(rect[0], rect[2]);
    const t = span <= 1 ? 0.5 : local / (span - 1);
    const shaped = options.inverted ? t : 1 - t;
    let index = Math.round(shaped * (steps - 1));
    if (options.inverted) index = Math.round((1 - shaped) * (steps - 1));
    let color = shades[clamp(index, 0, steps - 1)];
    if (options.tintToward) color = mixRgb(color, options.tintToward, options.tintAmount ?? 0.3);
    canvas.set(x, y, rgba(color));
  });
}

export interface BevelOptions {
  /** Brightness of the top/left edge. */
  light?: number;
  /** Brightness of the bottom/right edge. */
  dark?: number;
  /** Thickness of the bevel in pixels. */
  thickness?: number;
  inset?: number;
}

/** Light the top/left edge and darken the bottom/right — a hint of 3D without painting it. */
export function bevel(canvas: Canvas, rect: Rect, base: Rgb, options: BevelOptions = {}): void {
  const thickness = Math.max(1, Math.round(options.thickness ?? 1));
  const inset = Math.max(0, Math.round(options.inset ?? 0));
  const x1 = Math.min(rect[0], rect[2]) + inset;
  const y1 = Math.min(rect[1], rect[3]) + inset;
  const x2 = Math.max(rect[0], rect[2]) - inset;
  const y2 = Math.max(rect[1], rect[3]) - inset;
  const light = rgba(shadeRgb(base, options.light ?? 0.22));
  const dark = rgba(shadeRgb(base, -(options.dark ?? 0.24)));
  for (let i = 0; i < thickness; i += 1) {
    for (let x = x1 + i; x < x2 - i; x += 1) {
      canvas.set(x, y1 + i, light);
      canvas.set(x, y2 - 1 - i, dark);
    }
    for (let y = y1 + i; y < y2 - i; y += 1) {
      canvas.set(x1 + i, y, light);
      canvas.set(x2 - 1 - i, y, dark);
    }
  }
}

export interface SeamOptions {
  amount?: number;
  /** Which edges to darken. */
  edges?: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean };
  thickness?: number;
}

/**
 * Darken the edges of a face so a cube reads as a cube. Applied per face after the base
 * fill; this is what stops adjacent boxes of the same colour from melting together.
 */
export function seam(canvas: Canvas, rect: Rect, base: Rgb, options: SeamOptions = {}): void {
  const thickness = Math.max(1, Math.round(options.thickness ?? 1));
  const amount = options.amount ?? 0.18;
  const edges = options.edges ?? { top: true, bottom: true, left: true, right: true };
  const dark = shadeRgb(base, -amount);
  const x1 = Math.min(rect[0], rect[2]);
  const y1 = Math.min(rect[1], rect[3]);
  const x2 = Math.max(rect[0], rect[2]);
  const y2 = Math.max(rect[1], rect[3]);
  for (let i = 0; i < thickness; i += 1) {
    for (let x = x1; x < x2; x += 1) {
      if (edges.top) blendPixel(canvas, x, y1 + i, dark, 1);
      if (edges.bottom) blendPixel(canvas, x, y2 - 1 - i, dark, 1);
    }
    for (let y = y1; y < y2; y += 1) {
      if (edges.left) blendPixel(canvas, x1 + i, y, dark, 1);
      if (edges.right) blendPixel(canvas, x2 - 1 - i, y, dark, 1);
    }
  }
}

/** Blend a colour into a pixel by `amount` (1 = replace). */
export function blendPixel(canvas: Canvas, x: number, y: number, color: Rgb, amount = 1): void {
  const [r, g, b, a] = canvas.get(x, y);
  if (a === 0) {
    canvas.set(x, y, rgba(color));
    return;
  }
  canvas.set(x, y, [
    lerp(r, color[0], amount),
    lerp(g, color[1], amount),
    lerp(b, color[2], amount),
    a,
  ]);
}

export interface EyeOptions {
  sclera?: Rgb;
  iris?: Rgb;
  pupil?: Rgb;
  /** Brow shadow along the top edge. */
  brow?: Rgb;
  /** Shift the pupil one pixel toward the model's left/right. */
  gaze?: 'center' | 'left' | 'right';
}

/**
 * Draw a stylised eye into a small rect: flat sclera, a flat iris, a 2×2 pupil and a brow
 * shadow. Kept to flat colours on purpose — an eye is the one place a gradient would look
 * out of place next to the rest of the model.
 */
export function eye(canvas: Canvas, rect: Rect, options: EyeOptions = {}): void {
  const x1 = Math.min(rect[0], rect[2]);
  const y1 = Math.min(rect[1], rect[3]);
  const x2 = Math.max(rect[0], rect[2]);
  const y2 = Math.max(rect[1], rect[3]);
  const sclera = rgba(options.sclera ?? [0.92, 0.64, 0.24].map((v) => v * 255) as Rgb);
  fill(canvas, [x1, y1, x2, y2], sclera);
  const cx = Math.round((x1 + x2) / 2);
  const cy = Math.round((y1 + y2) / 2);
  const gaze = options.gaze ?? 'center';
  const pupilX = cx + (gaze === 'left' ? -1 : gaze === 'right' ? 1 : 0);
  const pupil = rgba(options.pupil ?? [13, 13, 13]);
  for (let y = cy - 1; y <= cy; y += 1) {
    for (let x = pupilX - 1; x <= pupilX; x += 1) canvas.set(x, y, pupil);
  }
  if (options.brow) {
    for (let x = x1; x < x2; x += 1) canvas.set(x, y1, rgba(options.brow));
  } else {
    const shade = rgba(shadeRgb(sclera.slice(0, 3) as Rgb, -0.34));
    for (let x = x1; x < x2; x += 1) canvas.set(x, y1, shade);
  }
}

export interface BlotchOptions {
  chance?: number;
  scale?: number;
  color: Rgb;
  seed?: number;
  /** Only paint where the mask returns true. */
  mask?: (x: number, y: number) => boolean;
}

/** Scatter flat blotches using low-frequency noise — natural mottling, not random pixels. */
export function blotch(canvas: Canvas, rect: Rect, options: BlotchOptions): void {
  const chance = options.chance ?? 0.34;
  const scale = options.scale ?? 0.24;
  const seed = options.seed ?? 0;
  eachPixel(canvas, rect, (x, y) => {
    if (options.mask && !options.mask(x, y)) return;
    if (fbm2(x * scale + seed, y * scale + seed * 2, 2) > 1 - chance) {
      canvas.set(x, y, rgba(options.color));
    }
  });
}

/** 1px outline around a rect, drawn inside. */
export function outline(canvas: Canvas, rect: Rect, color: Rgba, thickness = 1): void {
  const x1 = Math.min(rect[0], rect[2]);
  const y1 = Math.min(rect[1], rect[3]);
  const x2 = Math.max(rect[0], rect[2]);
  const y2 = Math.max(rect[1], rect[3]);
  for (let i = 0; i < thickness; i += 1) {
    for (let x = x1 + i; x < x2 - i; x += 1) {
      canvas.set(x, y1 + i, color);
      canvas.set(x, y2 - 1 - i, color);
    }
    for (let y = y1 + i; y < y2 - i; y += 1) {
      canvas.set(x1 + i, y, color);
      canvas.set(x2 - 1 - i, y, color);
    }
  }
}

export interface RadialOptions {
  inner: Rgb;
  outer: Rgb;
  steps?: number;
  power?: number;
}

/**
 * Radial shade, quantised into flat rings by default. A true smooth gradient is available
 * with `steps: 0`, but the ringed default keeps the art on-style.
 */
export function radial(canvas: Canvas, rect: Rect, options: RadialOptions): void {
  const x1 = Math.min(rect[0], rect[2]);
  const y1 = Math.min(rect[1], rect[3]);
  const x2 = Math.max(rect[0], rect[2]);
  const y2 = Math.max(rect[1], rect[3]);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rx = Math.max(1, (x2 - x1) / 2);
  const ry = Math.max(1, (y2 - y1) / 2);
  const steps = options.steps ?? 4;
  const power = options.power ?? 1;
  const shades = steps > 0 ? ramp(options.outer, { steps, contrast: 0.5 }) : [];
  eachPixel(canvas, rect, (x, y) => {
    const nx = (x + 0.5 - cx) / rx;
    const ny = (y + 0.5 - cy) / ry;
    const d = clamp(Math.sqrt(nx * nx + ny * ny), 0, 1) ** power;
    let color: Rgb;
    if (steps > 0) {
      const index = clamp(Math.round((1 - d) * (steps - 1)), 0, steps - 1);
      color = shades[index];
    } else {
      color = mixRgb(options.inner, options.outer, d);
    }
    canvas.set(x, y, rgba(color));
  });
}

/**
 * Ordered dither between two colours. Present for completeness, and deliberately not used
 * by any default: dithering a Minecraft texture is the fastest way to make it look noisy.
 */
export function dither(canvas: Canvas, rect: Rect, a: Rgb, b: Rgb, matrix: number[][] = BAYER_2): void {
  const size = matrix.length;
  eachPixel(canvas, rect, (x, y) => {
    const threshold = matrix[(y % size + size) % size][(x % size + size) % size] / (size * size);
    canvas.set(x, y, rgba(noise2(x, y, 0) > threshold ? b : a));
  });
}

export const BAYER_2: number[][] = [
  [0, 2],
  [3, 1],
];

/** Deterministic scatter helper shared by detail brushes. */
export function scatterHash(seed: number, x: number, y: number): number {
  return (hashString(`${seed}:${x}:${y}`) % 10000) / 10000;
}
