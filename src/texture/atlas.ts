import type { Rect } from './canvas.js';
import { Canvas } from './canvas.js';
import type { FaceName, Texture, UvRect } from '../model/types.js';
import type { Cube } from '../model/types.js';
import type { UvRule } from '../model/uv.js';

/**
 * A texture atlas: one image, divided into named islands.
 *
 * Islands are how you keep materials apart — teeth, claws, eyes, mouth and the main skin
 * each get their own patch, and the UV policy points faces at the right one. Two ways to
 * claim an island: `define()` for a fixed rectangle you want to control, `alloc()` for a
 * shelf-packed patch when you don't care where it lands.
 */
export class Atlas {
  readonly canvas: Canvas;
  private readonly islands = new Map<string, Rect>();
  private cursorX = 0;
  private cursorY = 0;
  private shelfHeight = 0;

  constructor(width: number, height: number, fill: [number, number, number, number] = [0, 0, 0, 0]) {
    this.canvas = new Canvas(width, height, fill);
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  /** Claim a fixed rectangle. Throws on overlap so a layout mistake surfaces at build time. */
  define(name: string, rect: UvRect): Rect {
    if (this.islands.has(name)) throw new Error(`atlas: island "${name}" already defined`);
    if (rect[0] < 0 || rect[1] < 0 || rect[2] > this.width || rect[3] > this.height) {
      throw new Error(`atlas: island "${name}" ${rect.join(',')} is outside ${this.width}×${this.height}`);
    }
    for (const [existing, other] of this.islands) {
      if (rect[0] < other[2] && rect[2] > other[0] && rect[1] < other[3] && rect[3] > other[1]) {
        throw new Error(`atlas: island "${name}" overlaps "${existing}"`);
      }
    }
    this.islands.set(name, rect);
    return rect;
  }

  /** Shelf-pack a patch of `w`×`h` starting from the current cursor. */
  alloc(name: string, w: number, h: number, options: { gap?: number; origin?: [number, number] } = {}): Rect {
    if (this.islands.has(name)) throw new Error(`atlas: island "${name}" already defined`);
    const gap = options.gap ?? 0;
    if (options.origin) {
      this.cursorX = options.origin[0];
      this.cursorY = options.origin[1];
      this.shelfHeight = 0;
    }
    if (w <= 0 || h <= 0) throw new Error(`atlas: island "${name}" has non-positive size`);
    if (this.cursorX + w > this.width) {
      this.cursorX = 0;
      this.cursorY += this.shelfHeight + gap;
      this.shelfHeight = 0;
    }
    if (this.cursorY + h > this.height) {
      throw new Error(`atlas: no room for island "${name}" (${w}×${h}) in ${this.width}×${this.height}`);
    }
    const rect: Rect = [this.cursorX, this.cursorY, this.cursorX + w, this.cursorY + h];
    this.islands.set(name, rect);
    this.cursorX += w + gap;
    this.shelfHeight = Math.max(this.shelfHeight, h);
    return rect;
  }

  /** Convenience: allocate a square island. */
  allocSquare(name: string, size: number, options?: { gap?: number; origin?: [number, number] }): Rect {
    return this.alloc(name, size, size, options);
  }

  get(name: string): Rect {
    const rect = this.islands.get(name);
    if (!rect) throw new Error(`atlas: unknown island "${name}"`);
    return rect;
  }

  has(name: string): boolean {
    return this.islands.has(name);
  }

  names(): string[] {
    return [...this.islands.keys()];
  }

  /** Run a paint callback scoped to an island, passing its rect. */
  paint(name: string, fn: (rect: Rect, canvas: Canvas) => void): void {
    fn(this.get(name), this.canvas);
  }

  /** A UV rule that points matching faces at an island. */
  rule(id: string, island: string, when: (cube: Cube, face: FaceName) => boolean): UvRule {
    const rect = this.get(island);
    return { id, when, rect };
  }

  /** Wrap the painted image as a Texture ready to attach to a model. */
  toTexture(name: string, options: Partial<Pick<Texture, 'particle' | 'useAsDefault' | 'renderMode' | 'renderSides' | 'wrapMode' | 'frameOrder' | 'frameTime' | 'frameInterpolate'>> = {}): Texture {
    return {
      name,
      width: this.width,
      height: this.height,
      data: this.canvas.toPng(),
      particle: options.particle ?? false,
      useAsDefault: options.useAsDefault ?? false,
      renderMode: options.renderMode ?? 'default',
      renderSides: options.renderSides ?? 'auto',
      wrapMode: options.wrapMode ?? 'repeat',
      frameOrder: options.frameOrder ?? [],
      frameTime: options.frameTime ?? 0,
      frameInterpolate: options.frameInterpolate ?? false,
    };
  }
}

/**
 * Build a UV rule list from a name → island map. `patterns` matches by cube-name prefix
 * (and optionally a specific face), which is enough for the common "all teeth use the
 * teeth island" shape without writing predicates by hand.
 */
export function islandRules(
  atlas: Atlas,
  patterns: Array<{ island: string; prefix?: string; suffix?: string; exact?: string; face?: FaceName | FaceName[]; id?: string }>,
): UvRule[] {
  return patterns.map((pattern, index) => {
    const rect = atlas.get(pattern.island);
    const faces = pattern.face ? (Array.isArray(pattern.face) ? pattern.face : [pattern.face]) : null;
    return {
      // Deliberately *not* indexed: several rules may point at one island (a prefix and a
      // suffix, say), and they all name the same material. Downstream passes key on this to
      // tell a material change from a step within one material, so it has to be stable.
      id: pattern.id ?? `island:${pattern.island}`,
      when: (cube: Cube, face: FaceName) => {
        if (faces && !faces.includes(face)) return false;
        if (pattern.exact && cube.name !== pattern.exact) return false;
        if (pattern.prefix && !cube.name.startsWith(pattern.prefix)) return false;
        if (pattern.suffix && !cube.name.endsWith(pattern.suffix)) return false;
        return Boolean(pattern.exact || pattern.prefix || pattern.suffix);
      },
      rect,
    };
  });
}
