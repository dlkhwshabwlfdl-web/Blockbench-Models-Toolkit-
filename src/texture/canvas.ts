import { PNG } from 'pngjs';
import { clamp } from '../util/math.js';

export type Rgba = [number, number, number, number];

/** A rectangle in image space: `[x1, y1, x2, y2]`, half-open (x2/y2 exclusive). */
export type Rect = [number, number, number, number];

export const TRANSPARENT: Rgba = [0, 0, 0, 0];
export const WHITE: Rgba = [255, 255, 255, 255];
export const BLACK: Rgba = [0, 0, 0, 255];

/**
 * A plain RGBA raster.
 *
 * Deliberately not built on a 2D canvas library: the texture sizes here are tiny (16–256
 * px), the operations are pixel-exact, and staying on a `Uint8Array` means a rebuild is
 * bit-identical on every machine. `pngjs` is used only to encode/decode PNG bytes.
 */
export class Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number, fill: Rgba = TRANSPARENT) {
    if (width <= 0 || height <= 0) throw new Error(`canvas: bad size ${width}×${height}`);
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
    if (fill[3] !== 0) this.fill(fill);
  }

  index(x: number, y: number): number {
    return (y * this.width + x) * 4;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): Rgba {
    if (!this.inBounds(x, y)) return [...TRANSPARENT];
    const i = this.index(x, y);
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  set(x: number, y: number, color: Rgba): void {
    if (!this.inBounds(x, y)) return;
    const i = this.index(x, y);
    this.data[i] = clamp(Math.round(color[0]), 0, 255);
    this.data[i + 1] = clamp(Math.round(color[1]), 0, 255);
    this.data[i + 2] = clamp(Math.round(color[2]), 0, 255);
    this.data[i + 3] = clamp(Math.round(color[3]), 0, 255);
  }

  fill(color: Rgba): void {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) this.set(x, y, color);
    }
  }

  /** Fill a half-open rectangle, clipped to the canvas. */
  rect(x1: number, y1: number, x2: number, y2: number, color: Rgba): void {
    const left = Math.max(0, Math.min(x1, x2));
    const right = Math.min(this.width, Math.max(x1, x2));
    const top = Math.max(0, Math.min(y1, y2));
    const bottom = Math.min(this.height, Math.max(y1, y2));
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) this.set(x, y, color);
    }
  }

  /** Stroke a 1px rectangle outline (drawn inside the bounds). */
  outlineRect(x1: number, y1: number, x2: number, y2: number, color: Rgba): void {
    for (let x = x1; x < x2; x += 1) {
      this.set(x, y1, color);
      this.set(x, y2 - 1, color);
    }
    for (let y = y1; y < y2; y += 1) {
      this.set(x1, y, color);
      this.set(x2 - 1, y, color);
    }
  }

  /** Bresenham line. */
  line(x0: number, y0: number, x1: number, y1: number, color: Rgba): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const tx = Math.round(x1);
    const ty = Math.round(y1);
    const dx = Math.abs(tx - x);
    const dy = Math.abs(ty - y);
    const sx = x < tx ? 1 : -1;
    const sy = y < ty ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.set(x, y, color);
      if (x === tx && y === ty) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** Filled ellipse centred on (cx, cy) with radii (rx, ry). */
  ellipse(cx: number, cy: number, rx: number, ry: number, color: Rgba): void {
    if (rx <= 0 || ry <= 0) return;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(x, y, color);
      }
    }
  }

  /** Copy another canvas in at (x, y). */
  blit(source: Canvas, x: number, y: number): void {
    for (let sy = 0; sy < source.height; sy += 1) {
      for (let sx = 0; sx < source.width; sx += 1) {
        this.set(x + sx, y + sy, source.get(sx, sy));
      }
    }
  }

  clone(): Canvas {
    const copy = new Canvas(this.width, this.height);
    copy.data.set(this.data);
    return copy;
  }

  /** Mirror the left half onto the right (or right onto left) — classic skin symmetry. */
  mirrorHorizontal(from: 'left' | 'right' = 'left'): void {
    const half = Math.floor(this.width / 2);
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < half; x += 1) {
        const sourceX = from === 'left' ? x : this.width - 1 - x;
        const targetX = from === 'left' ? this.width - 1 - x : x;
        this.set(targetX, y, this.get(sourceX, y));
      }
    }
  }

  toPng(): Uint8Array {
    const png = new PNG({ width: this.width, height: this.height });
    png.data = Buffer.from(this.data);
    return new Uint8Array(PNG.sync.write(png));
  }

  static fromPng(bytes: Uint8Array): Canvas {
    const png = PNG.sync.read(Buffer.from(bytes));
    const canvas = new Canvas(png.width, png.height);
    canvas.data.set(png.data);
    return canvas;
  }

  /** Distinct opaque colours, for metrics. */
  distinctColors(): Map<string, number> {
    const counts = new Map<string, number>();
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const [r, g, b, a] = this.get(x, y);
        if (a === 0) continue;
        const key = `${r},${g},${b}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }
}
