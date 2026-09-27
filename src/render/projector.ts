import type { Model } from '../model/model.js';
import type { Vec3 } from '../model/types.js';
import { Canvas, type Rgba } from '../texture/canvas.js';
import { clamp, crossVec, dotVec, normalizeVec } from '../util/math.js';
import { buildScene, type Scene, type SceneFace } from './scene.js';

export interface ViewBasis {
  /** Unit vector the camera looks along (into the scene). */
  forward: Vec3;
  /** Screen-up axis. */
  up: Vec3;
  /** Screen-right axis (derived). */
  right: Vec3;
}

const basis = (forward: Vec3, up: Vec3): ViewBasis => {
  const f = normalizeVec(forward);
  const r = normalizeVec(crossVec(f, up));
  const u = normalizeVec(crossVec(r, f));
  return { forward: f, up: u, right: r };
};

/** The named orthographic views plus two three-quarter views. */
export const VIEWS: Record<string, ViewBasis> = {
  front: basis([0, 0, -1], [0, 1, 0]),
  back: basis([0, 0, 1], [0, 1, 0]),
  right: basis([-1, 0, 0], [0, 1, 0]),
  left: basis([1, 0, 0], [0, 1, 0]),
  top: basis([0, -1, 0], [0, 0, 1]),
  bottom: basis([0, 1, 0], [0, 0, 1]),
  iso: basis([-1, -0.55, -1], [0, 1, 0]),
  'iso-back': basis([1, -0.55, 1], [0, 1, 0]),
};

export function viewBasis(name: string): ViewBasis {
  const known = VIEWS[name];
  if (known) return known;
  throw new Error(`render: unknown view "${name}" (have ${Object.keys(VIEWS).join(', ')})`);
}

export interface RenderOptions {
  width?: number;
  height?: number;
  /** Pixel padding inside the frame. */
  padding?: number;
  background?: Rgba;
  /** World light direction; faces pointing at it render brighter. */
  light?: Vec3;
  /** Ambient floor, 0..1. */
  ambient?: number;
  /** Darken the outline that touches the background. */
  outline?: boolean;
  /** Force a px-per-unit scale instead of fitting the frame. */
  scale?: number;
  /** Nearest-neighbour sampling (authentic) or bilinear. */
  filter?: 'nearest' | 'linear';
  /**
   * Fit the frame to these bounds instead of the scene's own. A strip of poses rendered from
   * one clip must share a frame, otherwise the model appears to change size as it animates
   * and a foot sinking through the floor is invisible.
   */
  frame?: { min: Vec3; max: Vec3 };
}

interface Texel {
  r: number;
  g: number;
  b: number;
  a: number;
}

function sampleTexture(texture: Canvas | null, u: number, v: number, filter: 'nearest' | 'linear'): Texel {
  if (!texture) {
    const grey = 170;
    return { r: grey, g: grey, b: grey, a: 255 };
  }
  const width = texture.width;
  const height = texture.height;
  if (filter === 'linear') {
    const x = u - 0.5;
    const y = v - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const read = (px: number, py: number): Texel => {
      const cx = ((px % width) + width) % width;
      const cy = ((py % height) + height) % height;
      const [r, g, b, a] = texture.get(cx, cy);
      return { r, g, b, a };
    };
    const p00 = read(x0, y0);
    const p10 = read(x0 + 1, y0);
    const p01 = read(x0, y0 + 1);
    const p11 = read(x0 + 1, y0 + 1);
    const mix = (a: number, b: number, c: number, d: number): number =>
      (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    return {
      r: mix(p00.r, p10.r, p01.r, p11.r),
      g: mix(p00.g, p10.g, p01.g, p11.g),
      b: mix(p00.b, p10.b, p01.b, p11.b),
      a: mix(p00.a, p10.a, p01.a, p11.a),
    };
  }
  const cx = ((Math.floor(u) % width) + width) % width;
  const cy = ((Math.floor(v) % height) + height) % height;
  const [r, g, b, a] = texture.get(cx, cy);
  return { r, g, b, a };
}

/**
 * Rasterise a scene from one orthographic view.
 *
 * Uses a per-pixel depth buffer instead of painter's-algorithm sorting, because posed rigs
 * interpenetrate freely and a centroid sort draws the wrong box on top the moment two
 * overlap. Each visible face is split into two triangles; a pixel keeps its interpolated
 * depth (depth-tested) and interpolated UV (sampled from the atlas). Lighting is a fixed
 * world light, so a surface is the same brightness in every view — that is what makes the
 * contact sheets usable for spotting geometry and UV problems.
 */
export function projectScene(scene: Scene, view: ViewBasis, options: RenderOptions = {}): Canvas {
  const width = Math.max(1, Math.round(options.width ?? 512));
  const height = Math.max(1, Math.round(options.height ?? 512));
  const padding = options.padding ?? 12;
  const filter = options.filter ?? 'nearest';
  const background = options.background ?? ([0, 0, 0, 0] as Rgba);
  const light = normalizeVec(options.light ?? [-0.35, 0.85, 0.4]);
  const ambient = clamp(options.ambient ?? 0.55, 0, 1);

  const target = new Canvas(width, height, background);
  const depthBuffer = new Float64Array(width * height).fill(Infinity);

  const { min, max } = options.frame ?? scene.bounds;
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];

  let extentRight = 0;
  let extentUp = 0;
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const rel: Vec3 = [x - center[0], y - center[1], z - center[2]];
        extentRight = Math.max(extentRight, Math.abs(dotVec(rel, view.right)));
        extentUp = Math.max(extentUp, Math.abs(dotVec(rel, view.up)));
      }
    }
  }
  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - padding * 2);
  const fitScale = Math.min(
    extentRight > 0 ? usableWidth / (extentRight * 2) : Infinity,
    extentUp > 0 ? usableHeight / (extentUp * 2) : Infinity,
  );
  const scale = options.scale ?? (Number.isFinite(fitScale) ? fitScale : 1);

  const texture = scene.texture ? Canvas.fromPng(scene.texture.data) : null;

  const project = (point: Vec3): [number, number, number] => {
    const rel: Vec3 = [point[0] - center[0], point[1] - center[1], point[2] - center[2]];
    return [
      dotVec(rel, view.right) * scale + width / 2,
      height / 2 - dotVec(rel, view.up) * scale,
      dotVec(rel, view.forward),
    ];
  };

  for (const face of scene.faces) {
    // Visible when the outward normal points back toward the camera.
    if (dotVec(face.normal, view.forward) >= -1e-6) continue;
    const lambert = Math.max(0, dotVec(face.normal, light));
    const brightness = clamp(ambient + (1 - ambient) * lambert, 0, 1);
    drawFace(target, depthBuffer, width, height, face, project, texture, filter, brightness);
  }

  if (options.outline) outlineSilhouette(target, depthBuffer, width, height);
  return target;
}

function drawFace(
  target: Canvas,
  depthBuffer: Float64Array,
  width: number,
  height: number,
  face: SceneFace,
  project: (point: Vec3) => [number, number, number],
  texture: Canvas | null,
  filter: 'nearest' | 'linear',
  brightness: number,
): void {
  const projected = face.corners.map(project);
  const uv = face.uv;
  // UV windows are in texture pixels, so they can be sampled directly.
  const fallback: [number, number, number, number] = texture ? [0, 0, texture.width, texture.height] : [0, 0, 1, 1];
  const rect = uv ?? fallback;
  const texCoords: Array<[number, number]> = [
    [rect[0], rect[1]],
    [rect[2], rect[1]],
    [rect[2], rect[3]],
    [rect[0], rect[3]],
  ];

  const triangles: Array<[number, number, number]> = [
    [0, 1, 2],
    [0, 2, 3],
  ];
  for (const [ia, ib, ic] of triangles) {
    rasterizeTriangle({
      target,
      depthBuffer,
      width,
      height,
      vertices: [projected[ia], projected[ib], projected[ic]],
      uvs: [texCoords[ia], texCoords[ib], texCoords[ic]],
      texture,
      filter,
      brightness,
    });
  }
}

interface TriangleInput {
  target: Canvas;
  depthBuffer: Float64Array;
  width: number;
  height: number;
  vertices: Array<[number, number, number]>;
  uvs: Array<[number, number]>;
  texture: Canvas | null;
  filter: 'nearest' | 'linear';
  brightness: number;
}

function rasterizeTriangle(input: TriangleInput): void {
  const { target, depthBuffer, width, height, vertices, uvs, texture, filter, brightness } = input;
  const [a, b, c] = vertices;
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-9) return;

  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const invArea = 1 / area;

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const x = px + 0.5;
      const y = py + 0.5;
      const weightC = ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) * invArea;
      const weightA = ((c[0] - b[0]) * (y - b[1]) - (c[1] - b[1]) * (x - b[0])) * invArea;
      const weightB = ((a[0] - c[0]) * (y - c[1]) - (a[1] - c[1]) * (x - c[0])) * invArea;
      if (weightA < -1e-6 || weightB < -1e-6 || weightC < -1e-6) continue;

      const depth = weightA * a[2] + weightB * b[2] + weightC * c[2];
      const index = py * width + px;
      if (depth >= depthBuffer[index]) continue;

      const u = weightA * uvs[0][0] + weightB * uvs[1][0] + weightC * uvs[2][0];
      const v = weightA * uvs[0][1] + weightB * uvs[1][1] + weightC * uvs[2][1];
      const texel = sampleTexture(texture, u, v, filter);
      if (texel.a === 0) continue;
      depthBuffer[index] = depth;
      target.set(px, py, [texel.r * brightness, texel.g * brightness, texel.b * brightness, 255]);
    }
  }
}

/** Darken pixels that touch the background, giving the render a 1px contour. */
function outlineSilhouette(target: Canvas, depthBuffer: Float64Array, width: number, height: number): void {
  const visible = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && depthBuffer[y * width + x] !== Infinity;
  const edges: Array<[number, number]> = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!visible(x, y)) continue;
      if (!visible(x - 1, y) || !visible(x + 1, y) || !visible(x, y - 1) || !visible(x, y + 1)) edges.push([x, y]);
    }
  }
  for (const [x, y] of edges) {
    const [r, g, b] = target.get(x, y);
    target.set(x, y, [r * 0.45, g * 0.45, b * 0.45, 255]);
  }
}

/** Render a model in its rest pose. */
export function projectModel(model: Model, view: ViewBasis, options: RenderOptions = {}): Canvas {
  return projectScene(buildScene(model), view, options);
}
