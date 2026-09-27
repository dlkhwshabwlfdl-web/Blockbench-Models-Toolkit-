import type { Model } from '../model/model.js';
import { FACE_NAMES } from '../model/types.js';
import type { FaceName, UvRect, Vec3 } from '../model/types.js';
import { faceFrame } from '../model/cubes.js';
import { elementMatrix } from '../model/rotation.js';
import { boneWorldTransforms } from '../render/scene.js';
import {
  addVec,
  clamp,
  crossVec,
  dotVec,
  hexToRgb,
  lengthVec,
  mixRgb,
  normalizeVec,
  rgbToHex,
  scaleVec,
  subVec,
} from '../util/math.js';
import { multiply, transformDirection, transformPoint, type Mat4 } from '../util/mat4.js';
import type { Pose } from '../render/scene.js';
import { Canvas, type Rgba } from './canvas.js';

type Rgb = [number, number, number];

/**
 * Colour harmony and seam softening.
 *
 * The complaint these solve is specific: a model whose materials were chosen independently
 * looks fine on each part and wrong where the parts meet. A light olive back against a
 * separate dark swamp-green belly is not a shading problem — it is two hues that were never
 * related. `harmonize` pulls a set of colours toward a shared hue while preserving how light
 * or dark each one is, and `deriveShade` builds a secondary material *from* the primary so it
 * starts in the right family.
 *
 * `softenSeams` then deals with the pixel-level version of the same problem: two faces that
 * meet at a 3D edge, each painted from a different part of the atlas, with an abrupt colour
 * change right at the join. It finds those joins, maps the shared edge into the texture on
 * both sides, and blends a band of pixels across it.
 *
 * How aggressive any of this is belongs to the prompt, so every entry point takes a strength
 * and `SURFACE_STYLES` bundles the numbers into the three answers people actually ask for:
 * a crisp voxel look, a balanced one, and a soft one.
 */

/* ------------------------------------------------------------------- colour ---- */

export function rgbToHsl(rgb: Rgb): [number, number, number] {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

export function hslToRgb(hsl: [number, number, number]): Rgb {
  const [h, s, l] = hsl;
  const hue = ((h % 360) + 360) % 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return [
    Math.round(channel(hue / 360 + 1 / 3) * 255),
    Math.round(channel(hue / 360) * 255),
    Math.round(channel(hue / 360 - 1 / 3) * 255),
  ];
}

/** Shortest signed distance between two hues, in degrees (−180..180]. */
function hueDelta(from: number, to: number): number {
  let delta = ((to - from) % 360 + 540) % 360 - 180;
  if (delta === -180) delta = 180;
  return delta;
}

/** Circular mean of a set of hues, weighted. */
function meanHue(entries: Array<{ h: number; weight: number }>): number {
  let x = 0;
  let y = 0;
  for (const { h, weight } of entries) {
    const radians = (h * Math.PI) / 180;
    x += Math.cos(radians) * weight;
    y += Math.sin(radians) * weight;
  }
  if (x === 0 && y === 0) return entries[0]?.h ?? 0;
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export interface HarmonizeOptions {
  /** 0 leaves the colours untouched, 1 collapses them onto one hue. Default 0.55. */
  strength?: number;
  /** Target hue to move toward. Defaults to the saturation-weighted mean of the input. */
  targetHue?: number;
  /** Indices that must not move (e.g. an accent colour that should stay loud). */
  pinned?: number[];
}

/**
 * Pull a set of colours toward a shared hue.
 *
 * Lightness and saturation are preserved, so a set that already reads as "the same material at
 * different depths" keeps its depth — it just stops jumping between, say, olive and swamp.
 * That is the whole difference between the belly of a model looking shaded and looking like a
 * different creature.
 */
export function harmonize(colors: Rgb[], options: HarmonizeOptions = {}): Rgb[] {
  if (colors.length < 2) return colors.map((color) => [...color] as Rgb);
  const strength = clamp(options.strength ?? 0.55, 0, 1);
  const pinned = new Set(options.pinned ?? []);
  const hsl = colors.map(rgbToHsl);
  const target =
    options.targetHue ??
    meanHue(
      hsl
        .map((entry, index) => ({ h: entry[0], weight: pinned.has(index) ? 0 : entry[1] * 0.5 + 0.2 }))
        .filter((entry) => entry.weight > 0),
    );

  return hsl.map(([h, s, l], index) => {
    if (pinned.has(index)) return [...colors[index]] as Rgb;
    // Lightness and saturation are deliberately left alone: only the hue moves.
    return hslToRgb([h + hueDelta(h, target) * strength, s, l]);
  });
}

export interface DeriveShadeOptions {
  /** Signed lightness offset, −1..1. */
  lightness?: number;
  /** Multiplier on saturation. 1 keeps it. */
  saturation?: number;
  /** Hue offset in degrees. */
  hueShift?: number;
}

/**
 * Derive a secondary material from a primary one, in the same family.
 *
 * `deriveShade(skin, { lightness: -0.22 })` is how a belly, a scute plate or a shadowed
 * underside should be chosen — same hue, darker — instead of picking a plausible-looking but
 * unrelated colour and discovering the join only when the model is viewed from below.
 */
export function deriveShade(base: Rgb | string, options: DeriveShadeOptions = {}): Rgb {
  const rgb = typeof base === 'string' ? hexToRgb(base) : base;
  const [h, s, l] = rgbToHsl(rgb);
  return hslToRgb([
    h + (options.hueShift ?? 0),
    clamp(s * (options.saturation ?? 1), 0, 1),
    clamp(l + (options.lightness ?? 0), 0, 1),
  ]);
}

/** Intermediate colours between two materials, for a bridge band. */
export function bridgeColors(a: Rgb | string, b: Rgb | string, steps = 2): Rgb[] {
  const from = typeof a === 'string' ? hexToRgb(a) : a;
  const to = typeof b === 'string' ? hexToRgb(b) : b;
  const out: Rgb[] = [];
  for (let i = 1; i <= steps; i += 1) out.push(hslToRgb(rgbToHsl(mixRgb(from, to, i / (steps + 1)))));
  return out;
}

/* -------------------------------------------------------------------- styles ---- */

export type SurfaceStyleName = 'sharp' | 'balanced' | 'soft';

export interface SurfaceStyle {
  /** Pixels of gradient written across a cube join. 0 = a hard line. */
  edgeSoftness: number;
  /** How strongly the seam bands are blended, 0..1. */
  seamStrength: number;
  /** How far a palette is pulled toward a shared hue, 0..1. */
  paletteHarmony: number;
  /** Discrete bands in a material ramp. */
  bands: number;
  /** Ramp contrast. */
  contrast: number;
}

/**
 * The three answers people actually give when asked how the surface should look.
 * `sharp` is the classic crisp voxel model, `soft` leans into smooth transitions, and
 * `balanced` is the default this toolkit ships examples with.
 */
export const SURFACE_STYLES: Record<SurfaceStyleName, SurfaceStyle> = {
  sharp: { edgeSoftness: 0, seamStrength: 0, paletteHarmony: 0.35, bands: 4, contrast: 0.45 },
  balanced: { edgeSoftness: 1, seamStrength: 0.6, paletteHarmony: 0.55, bands: 5, contrast: 0.45 },
  soft: { edgeSoftness: 3, seamStrength: 0.55, paletteHarmony: 0.7, bands: 7, contrast: 0.38 },
};

/** Accept a style name or a partial override and produce a complete style. */
export function resolveStyle(style: SurfaceStyleName | Partial<SurfaceStyle> = 'balanced'): SurfaceStyle {
  if (typeof style === 'string') return { ...SURFACE_STYLES[style] };
  return { ...SURFACE_STYLES.balanced, ...style };
}

/* -------------------------------------------------------------------- seams ---- */

interface FaceUvMap {
  cube: string;
  face: FaceName;
  rect: UvRect;
  /** World-space frame: corners of the attribute are the (u1,v1) corner. */
  base: Vec3;
  uAxis: Vec3;
  vAxis: Vec3;
  width: number;
  height: number;
  corners: [Vec3, Vec3, Vec3, Vec3];
}

const TOLERANCE = 0.02;

const distance = (a: Vec3, b: Vec3): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function asUnitAxis(matrix: Mat4, axis: Vec3): Vec3 | null {
  const transformed = transformDirection(matrix, axis);
  const length = Math.hypot(transformed[0], transformed[1], transformed[2]);
  // A non-uniform scale would make the UV mapping non-linear; skip those faces rather than
  // sample the wrong pixels.
  if (Math.abs(length - 1) > 0.01) return null;
  return [transformed[0], transformed[1], transformed[2]];
}

function buildFaceMaps(model: Model, pose: Pose = new Map()): FaceUvMap[] {
  const boneMatrices = boneWorldTransforms(model, pose);
  const maps: FaceUvMap[] = [];
  for (const cube of model.cubes) {
    const bone = boneMatrices.get(cube.bone);
    const element = elementMatrix(cube);
    const combined = bone ? multiply(bone, element) : element;
    for (const face of FACE_NAMES) {
      if (cube.hidden.has(face)) continue;
      const rect = cube.faces[face];
      if (!rect) continue;
      const frame = faceFrame(cube, face);
      const uAxis = asUnitAxis(combined, frame.uAxis);
      const vAxis = asUnitAxis(combined, frame.vAxis);
      if (!uAxis || !vAxis) continue;
      const base = transformPoint(combined, frame.base);
      const corners: [Vec3, Vec3, Vec3, Vec3] = [
        base,
        transformPoint(combined, addScaled(frame.base, frame.uAxis, frame.width)),
        transformPoint(combined, addScaled(addScaled(frame.base, frame.uAxis, frame.width), frame.vAxis, frame.height)),
        transformPoint(combined, addScaled(frame.base, frame.vAxis, frame.height)),
      ];
      maps.push({ cube: cube.name, face, rect, base, uAxis, vAxis, width: frame.width, height: frame.height, corners });
    }
  }
  return maps;
}

function addScaled(base: Vec3, axis: Vec3, amount: number): Vec3 {
  return [base[0] + axis[0] * amount, base[1] + axis[1] * amount, base[2] + axis[2] * amount];
}

const subtract = subVec;
const dot = dotVec;

/** A point on the face, in texture pixels. */
function toPixel(map: FaceUvMap, point: Vec3): [number, number] {
  const relative = subtract(point, map.base);
  const u = dot(relative, map.uAxis) / map.width;
  const v = dot(relative, map.vAxis) / map.height;
  return [map.rect[0] + u * (map.rect[2] - map.rect[0]), map.rect[1] + v * (map.rect[3] - map.rect[1])];
}

interface SharedEdge {
  a: FaceUvMap;
  b: FaceUvMap;
  /** The overlapping part of the shared edge, in world space. */
  from: Vec3;
  to: Vec3;
}

interface Segment {
  a: Vec3;
  b: Vec3;
}

function boundarySegments(map: FaceUvMap): Segment[] {
  const corners = map.corners;
  return [0, 1, 2, 3].map((i) => ({ a: corners[i], b: corners[(i + 1) % 4] }));
}

/** Distance from a point to an infinite line through `origin` with unit direction `direction`. */
function lineDistance(point: Vec3, origin: Vec3, direction: Vec3): number {
  const offset = subVec(point, origin);
  return lengthVec(subVec(offset, scaleVec(direction, dotVec(offset, direction))));
}

/**
 * The overlapping part of two collinear segments, or null.
 *
 * Matching only exactly-equal corner pairs misses most real joins: a torso and a chest block
 * share a plane, a bevel shares only part of an edge, and a sub-segment of one face's border
 * can meet the middle of another's. Working in terms of overlapping intervals along a shared
 * line catches all of those, and it is also how the adjacent faces of a *single* cube are
 * found — which is the case that matters most, because that is where a UV policy sends two
 * different atlas islands onto neighbouring faces.
 */
function sharedSegment(first: Segment, second: Segment, tolerance: number): Segment | null {
  const d1 = subVec(first.b, first.a);
  const len1 = lengthVec(d1);
  if (len1 <= TOLERANCE) return null;
  const direction = scaleVec(d1, 1 / len1);

  const d2 = subVec(second.b, second.a);
  if (lengthVec(d2) <= TOLERANCE) return null;
  // Perpendicular edges meet at a point and share no surface boundary to blend.
  if (Math.abs(lengthVec(crossVec(direction, normalizeVec(d2)))) > 0.08) return null;

  if (lineDistance(second.a, first.a, direction) > tolerance) return null;
  if (lineDistance(second.b, first.a, direction) > tolerance) return null;

  const project = (point: Vec3): number => dot(subVec(point, first.a), direction);
  const low2 = Math.min(project(second.a), project(second.b));
  const high2 = Math.max(project(second.a), project(second.b));
  const low = Math.max(0, low2);
  const high = Math.min(len1, high2);
  if (high - low <= tolerance) return null;
  return { a: addVec(first.a, scaleVec(direction, low)), b: addVec(first.a, scaleVec(direction, high)) };
}

/**
 * Every pair of visible faces that meet along an overlapping edge.
 *
 * Same-cube pairs are included deliberately — a cube's own faces are the most common place for
 * an abrupt material change, since the two windows usually sample different atlas islands.
 */
function findSharedEdges(maps: FaceUvMap[], tolerance = TOLERANCE): SharedEdge[] {
  const segments = maps.map(boundarySegments);
  const edges: SharedEdge[] = [];
  for (let i = 0; i < maps.length; i += 1) {
    for (let j = i + 1; j < maps.length; j += 1) {
      const a = maps[i];
      const b = maps[j];
      let best: Segment | null = null;
      let bestLength = 0;
      for (const first of segments[i]) {
        for (const second of segments[j]) {
          const overlap = sharedSegment(first, second, tolerance);
          if (!overlap) continue;
          const length = distance(overlap.a, overlap.b);
          if (length <= bestLength) continue;
          best = overlap;
          bestLength = length;
        }
      }
      if (best) edges.push({ a, b, from: best.a, to: best.b });
    }
  }
  return edges;
}

/**
 * The texture pixel on one axis, `band` steps inward from a boundary crossing.
 *
 * A window is half-open — `[a, b)` — so the boundary at `u = b` is the *outside* edge of pixel
 * `b - 1`, not pixel `b`. Rounding the coordinate and stepping from there puts the first band
 * one pixel outside the window for every join on the far side of the face, which silently skips
 * about half of them. Resolving the boundary to the pixel that actually touches it, for the
 * direction of travel, is what makes the pass cover a whole seam instead of half of one.
 */
function bandPixel(value: number, direction: number, band: number, low: number, high: number): number {
  const last = high - 1;
  if (direction === 0) return clamp(Math.round(value), low, last);
  const first = direction > 0 ? Math.min(Math.floor(value), last) : Math.max(Math.ceil(value) - 1, low);
  return clamp(first + direction * band, low, last);
}

/** Which way is "inward" across a face, given the shared edge's pixel line. */
function inwardOffset(map: FaceUvMap, p1: [number, number], p2: [number, number]): [number, number] {
  const [x1, y1] = map.rect;
  const [x2, y2] = map.rect;
  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;
  const alongX = Math.abs(p2[0] - p1[0]) >= Math.abs(p2[1] - p1[1]);
  if (alongX) {
    // The edge runs horizontally, so the inward direction is vertical.
    return [0, centerY >= (p1[1] + p2[1]) / 2 ? 1 : -1];
  }
  return [centerX >= (p1[0] + p2[0]) / 2 ? 1 : -1, 0];
}

export interface SoftenSeamsOptions {
  /** How many pixels wide the transition is, counting the solid join. Default from the style. */
  softness?: number;
  /** Density of the dithered bands beyond the solid join, 0..1. Default from the style. */
  strength?: number;
  /** Preset, or a partial style override. */
  style?: SurfaceStyleName | Partial<SurfaceStyle>;
  /**
   * Only blend when the two faces' colours differ by at least this much in Manhattan distance
   * (0..765). The default skips the steps *within* one material, so a banded skin field is not
   * smoothed into a gradient — only genuine material changes are bridged.
   */
  minDifference?: number;
  /** Skeleton pose to measure the geometry in. Defaults to the rest pose. */
  pose?: Pose;
  /** How far apart two edges may be and still count as joined, model units. Default 0.02. */
  tolerance?: number;
  /**
   * Only bridge where the two faces sample different materials. Default true.
   *
   * Without this the pass also bridges the steps *within* one material — the neighbouring bands
   * of a skin ramp differ by enough to trip the colour test — and a clean banded texture is
   * quietly smoothed into a gradient. Set false to bridge every join regardless.
   */
  acrossMaterialsOnly?: boolean;
  /**
   * Allow writes to texels sampled by several faces, so a join on a shared atlas island gets a
   * rim on the whole island. Default false, because a small island cannot take one.
   */
  shareIslands?: boolean;
}

export interface SoftenSeamsResult {
  /** Adjacent face pairs considered. */
  pairs: number;
  /** Pairs that were actually bridged. */
  blended: number;
  /** Texture pixels written. */
  pixels: number;
  softness: number;
  strength: number;
  /**
   * How many materials were skipped because their joins fall on texels that more than one face
   * samples. A nonzero count is not a failure: it means those joins belong to a shared atlas
   * island, where the fix is to give the island its own region or derive its colour from the
   * base material rather than to paint a rim. Raise it with `shareIslands: true` to give the
   * whole island the rim instead.
   */
  sharedJoins: number;
}

function rgbDistance(a: Rgb, b: Rgb): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/** Deterministic value in [0, 1) from a texel coordinate. */
function hash01(x: number, y: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263, 1) ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Soften the colour join across cube boundaries.
 *
 * For every pair of faces that meet along a 3D edge — including two faces of the *same* cube,
 * which is where a UV policy most often puts two different atlas islands side by side — the
 * shared edge is mapped into the texture on both sides and the boundary pixels are given the
 * neighbouring material's colour.
 *
 * Three rules keep this from turning a model into mush, and all three were learned by getting
 * them wrong first:
 *
 *  - **Only the neighbour's own colour is ever written.** Blending two colours and snapping the
 *    result to the palette looks reasonable and is not: halfway between olive skin and pink
 *    tongue is a colour that belongs to neither, and it lands as a pink speck on the model.
 *    Writing the neighbour's colour makes the join a discrete interleave instead, so the
 *    palette cannot grow and no unrelated colour can appear.
 *  - **Only texels no other face samples are written.** Islands are shared: the belly island is
 *    about four pixels square and forty faces read it, so bridging a seam for one of them
 *    would recolour the other thirty-nine and put the colour anywhere on the model.
 *  - **Only joins between different materials are bridged.** Two bands of one skin ramp meeting
 *    at a cube edge is the texture working as intended.
 *
 * The first band is written solid, so the boundary reads as a deliberate line. Further bands
 * (`softness`) fade inward as a dither, which is how a pixel artist widens a transition without
 * inventing colours. `softness: 0` — the `sharp` style — leaves every join crisp.
 */
export function softenSeams(model: Model, options: SoftenSeamsOptions = {}): SoftenSeamsResult {
  const style = resolveStyle(options.style ?? 'balanced');
  const softness = Math.max(0, Math.round(options.softness ?? style.edgeSoftness));
  const strength = clamp(options.strength ?? style.seamStrength, 0, 1);
  const texture = model.textures[0];
  if (!texture || softness === 0) {
    return { pairs: 0, blended: 0, pixels: 0, softness, strength, sharedJoins: 0 };
  }

  const source = Canvas.fromPng(texture.data);
  const canvas = source.clone();
  const maps = buildFaceMaps(model, options.pose);
  const allEdges = findSharedEdges(maps, options.tolerance ?? TOLERANCE);
  const minDifference = options.minDifference ?? 60;

  // A seam only reads as a mistake where two *materials* meet. Two bands of the same skin ramp
  // meeting along a cube edge is the texture working as intended, and blurring it is what turns
  // a crisp model into noise, so those joins are left alone.
  const material = new Map<string, string | undefined>();
  for (const entry of model.uvTrace) material.set(`${entry.cube.name}|${entry.face}`, entry.material);
  const acrossMaterialsOnly = options.acrossMaterialsOnly ?? true;
  const edges =
    acrossMaterialsOnly && material.size > 0
      ? allEdges.filter(
          (edge) => material.get(`${edge.a.cube}|${edge.a.face}`) !== material.get(`${edge.b.cube}|${edge.b.face}`),
        )
      : allEdges;

  // Who samples each texel. By default a bounday texel is only written when it has a *lone*
  // owner, which is a hard guarantee: the pass can never alter artwork another face depends on.
  //
  // The reason is the shared island. A named island is a deliberate shared surface — the belly
  // island is four pixels square and about forty faces read it — so a rim written for one of
  // them appears on all forty. For a large island that is exactly right. For a small one it is
  // destructive: an olive rim on a four-pixel claw island turns every claw pale, and a skin rim
  // around a four-pixel eye eats the iris. Since the tool cannot tell those apart, shared
  // islands are left alone and reported instead; a join on a shared island is a *material*
  // choice, and `deriveShade` is the tool for that.
  const texelCount = new Uint8Array(source.width * source.height);
  const texelMaterial = new Map<number, string | undefined>();
  const texelMixed = new Uint8Array(source.width * source.height);
  for (const map of maps) {
    const owner = material.get(`${map.cube}|${map.face}`);
    for (let y = map.rect[1]; y < map.rect[3]; y += 1) {
      for (let x = map.rect[0]; x < map.rect[2]; x += 1) {
        if (x < 0 || y < 0 || x >= source.width || y >= source.height) continue;
        const index = y * source.width + x;
        if (texelCount[index] === 0) texelMaterial.set(index, owner);
        else if (texelMaterial.get(index) !== owner) texelMixed[index] = 1;
        if (texelCount[index] < 255) texelCount[index] += 1;
      }
    }
  }
  const shareIslands = options.shareIslands ?? false;
  const writable = (x: number, y: number, owner: string | undefined): boolean => {
    if (x < 0 || y < 0 || x >= source.width || y >= source.height) return false;
    const index = y * source.width + x;
    if (shareIslands && owner !== undefined) {
      return texelCount[index] > 0 && texelMixed[index] === 0 && texelMaterial.get(index) === owner;
    }
    return texelCount[index] === 1;
  };
  const sharedJoins = new Set<string>();

  const sample = (x: number, y: number): Rgb | null => {
    if (x < 0 || y < 0 || x >= source.width || y >= source.height) return null;
    const [r, g, b, a] = source.get(x, y);
    return a === 0 ? null : [r, g, b];
  };

  let blended = 0;
  let pixels = 0;

  for (const edge of edges) {
    const samples = Math.max(4, Math.round(distance(edge.from, edge.to) * 2));
    let touched = false;
    for (const [self, other] of [
      [edge.a, edge.b],
      [edge.b, edge.a],
    ] as Array<[FaceUvMap, FaceUvMap]>) {
      const p1 = toPixel(self, edge.from);
      const p2 = toPixel(self, edge.to);
      const q1 = toPixel(other, edge.from);
      const q2 = toPixel(other, edge.to);
      const selfInward = inwardOffset(self, p1, p2);
      const otherInward = inwardOffset(other, q1, q2);
      const selfMaterial = material.get(`${self.cube}|${self.face}`);
      for (let s = 0; s <= samples; s += 1) {
        const t = s / samples;
        const selfPixel: [number, number] = [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
        const otherPixel: [number, number] = [q1[0] + (q2[0] - q1[0]) * t, q1[1] + (q2[1] - q1[1]) * t];
        // Sample the neighbouring material a little way inside its own face, so the bridge
        // colour comes from the bulk of the material rather than from the pixel at the join.
        const neighbour = sample(
          bandPixel(otherPixel[0], otherInward[0], softness, other.rect[0], other.rect[2]),
          bandPixel(otherPixel[1], otherInward[1], softness, other.rect[1], other.rect[3]),
        );
        if (!neighbour) continue;

        for (let band = 0; band < softness; band += 1) {
          const x = bandPixel(selfPixel[0], selfInward[0], band, self.rect[0], self.rect[2]);
          const y = bandPixel(selfPixel[1], selfInward[1], band, self.rect[1], self.rect[3]);
          const current = sample(x, y);
          if (!current) continue;
          if (rgbDistance(current, neighbour) < minDifference) continue;
          if (!writable(x, y, selfMaterial)) {
            sharedJoins.add(selfMaterial ?? 'base');
            continue;
          }
          // The join itself is solid; every further band is a dither, thinning as it goes in.
          if (band > 0 && hash01(x, y) >= strength * (1 - band / softness)) continue;
          canvas.set(x, y, [neighbour[0], neighbour[1], neighbour[2], 255]);
          pixels += 1;
          touched = true;
        }
      }
    }
    if (touched) blended += 1;
  }

  texture.data = canvas.toPng();
  return { pairs: edges.length, blended, pixels, softness, strength, sharedJoins: sharedJoins.size };
}

/** RGBA tuple for this RGB colour, at full opacity. */
export function rgbaOf(rgb: Rgb): Rgba {
  return [rgb[0], rgb[1], rgb[2], 255];
}

/** Hex helpers, re-exported so a build script needs one import for colour work. */
export const colourUtils = { hexToRgb, rgbToHex, rgbToHsl, hslToRgb, mixRgb, deriveShade, harmonize };
