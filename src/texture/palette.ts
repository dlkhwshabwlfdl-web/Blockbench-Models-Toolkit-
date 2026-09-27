import { hexToRgb, mixRgb, rgbToHex, shadeRgb } from '../util/math.js';
import type { Rgba } from './canvas.js';

export type Rgb = [number, number, number];

export interface RampOptions {
  /** Number of discrete steps from darkest to lightest. 3 is the sweet spot for a face. */
  steps?: number;
  /** How far apart the darkest and lightest step sit, 0..1. */
  contrast?: number;
  /** Percentage of the ramp that sits at or below the base colour. */
  bias?: number;
}

/**
 * Build a discrete light→shadow ramp around a base colour.
 *
 * Minecraft art reads well when shading is made of a small number of flat, clearly
 * separated colour steps — not a smooth gradient and definitely not a dither pattern.
 * Everything in this toolkit that "shades" does it by picking from a ramp like this.
 */
export function ramp(base: Rgb | string, options: RampOptions = {}): Rgb[] {
  const rgb = typeof base === 'string' ? hexToRgb(base) : base;
  const steps = Math.max(2, Math.round(options.steps ?? 3));
  const contrast = options.contrast ?? 0.42;
  const bias = options.bias ?? 0.5;
  const out: Rgb[] = [];
  for (let i = 0; i < steps; i += 1) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    // t=0 → darkest shade, t=1 → lightest tint.
    const amount = (t - bias) * 2 * contrast;
    out.push(shadeRgb(rgb, amount));
  }
  return out;
}

/** Wrap an RGB triple as an opaque RGBA. */
export const rgba = (rgb: Rgb, alpha = 255): Rgba => [rgb[0], rgb[1], rgb[2], alpha];

export interface PaletteEntry {
  name: string;
  base: Rgb;
  steps: Rgb[];
}

/**
 * Named palette. A texture's colours should be a deliberate list, not whatever the noise
 * produced; registering them here gives the metrics something to count and gives the
 * painter named handles (`palette.dark('skin')`) instead of magic RGB tuples.
 */
export class Palette {
  private readonly entries = new Map<string, PaletteEntry>();

  define(name: string, color: Rgb | string, options: RampOptions = {}): PaletteEntry {
    const base = typeof color === 'string' ? hexToRgb(color) : color;
    const entry: PaletteEntry = { name, base, steps: ramp(base, options) };
    this.entries.set(name, entry);
    return entry;
  }

  get(name: string): PaletteEntry {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`palette: unknown colour "${name}"`);
    return entry;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Step index 0 = darkest, last = lightest. Index is clamped, so loops are safe. */
  shade(name: string, index: number): Rgb {
    const entry = this.get(name);
    const clamped = Math.min(Math.max(Math.round(index), 0), entry.steps.length - 1);
    return entry.steps[clamped];
  }

  dark(name: string): Rgba {
    return rgba(this.shade(name, 0));
  }

  baseRgba(name: string): Rgba {
    return rgba(this.get(name).base);
  }

  light(name: string): Rgba {
    const entry = this.get(name);
    return rgba(entry.steps[entry.steps.length - 1]);
  }

  /** Every distinct step across every entry — what the palette-size metric counts. */
  allSteps(): Rgb[] {
    const seen = new Map<string, Rgb>();
    for (const entry of this.entries.values()) {
      for (const step of entry.steps) seen.set(rgbToHex(step), step);
    }
    return [...seen.values()];
  }

  size(): number {
    return this.allSteps().length;
  }

  names(): string[] {
    return [...this.entries.keys()];
  }
}

/** Blend a ramp step toward another colour, e.g. tinting scales toward a darker back. */
export function tint(step: Rgb, toward: Rgb, amount: number): Rgb {
  return mixRgb(step, toward, amount);
}
