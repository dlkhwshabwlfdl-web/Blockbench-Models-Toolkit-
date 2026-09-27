import type { Model } from '../model/model.js';
import type { Vec3 } from '../util/math.js';
import { Canvas, type Rgba } from '../texture/canvas.js';
import { projectModel, projectScene, viewBasis, type RenderOptions } from './projector.js';
import { buildScene, samplePose } from './scene.js';
import { writeBinary } from '../export/io.js';

export interface SheetOptions extends RenderOptions {
  /** Views to include, left to right. Defaults to the four orthogonal sides plus iso. */
  views?: string[];
  /** Gap between tiles in pixels. */
  gap?: number;
  /** Draw a label bar under each tile. */
  background?: Rgba;
  tileBackground?: Rgba;
}

const DEFAULT_VIEWS = ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso'];

/**
 * Render a contact sheet: one tile per named view, laid out left-to-right. This is the
 * image an agent looks at to check a model, so each tile is rendered from the same world
 * lighting and fitted to its own frame.
 */
export function contactSheet(model: Model, options: SheetOptions = {}): Canvas {
  const views = options.views ?? DEFAULT_VIEWS;
  const tileWidth = Math.max(32, Math.round(options.width ?? 256));
  const tileHeight = Math.max(32, Math.round(options.height ?? 256));
  const gap = options.gap ?? 8;
  const columns = options.views ? views.length : Math.min(views.length, 4);
  const rows = Math.ceil(views.length / columns);
  const sheet = new Canvas(
    columns * tileWidth + (columns + 1) * gap,
    rows * tileHeight + (rows + 1) * gap,
    options.background ?? ([24, 26, 32, 255] as Rgba),
  );

  views.forEach((view, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const tile = projectModel(model, viewBasis(view), {
      ...options,
      width: tileWidth,
      height: tileHeight,
      background: options.tileBackground ?? ([16, 17, 21, 255] as Rgba),
    });
    sheet.blit(tile, gap + column * (tileWidth + gap), gap + row * (tileHeight + gap));
  });

  return sheet;
}

export interface StripOptions extends RenderOptions {
  /** Clip name to render. */
  clip: string;
  /** Discrete times (seconds) to sample. */
  times: number[];
  view?: string;
  gap?: number;
  tileBackground?: Rgba;
}

/**
 * Render one clip as a horizontal strip of poses.
 *
 * Each tile is rendered at a sampled time from the actual skeleton, so the strip shows the
 * motion rather than the rest pose. All tiles share one frame — the union of every sampled
 * pose and the rest pose — so the model does not appear to change size as the animation plays,
 * and a foot sinking through the floor stays visible instead of being refitted away.
 */
export function clipStrip(model: Model, options: StripOptions): Canvas {
  const view = viewBasis(options.view ?? 'front');
  const tileWidth = Math.max(32, Math.round(options.width ?? 192));
  const tileHeight = Math.max(32, Math.round(options.height ?? 192));
  const gap = options.gap ?? 4;
  const times = options.times.length > 0 ? options.times : [0];
  const count = times.length;
  const clip = model.clips.find((candidate) => candidate.name === options.clip);
  const scenes = times.map((time) => buildScene(model, clip ? samplePose(clip, time) : undefined));

  const frame = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  } as { min: Vec3; max: Vec3 };
  for (const scene of [buildScene(model), ...scenes]) {
    for (let axis = 0; axis < 3; axis += 1) {
      frame.min[axis] = Math.min(frame.min[axis], scene.bounds.min[axis]);
      frame.max[axis] = Math.max(frame.max[axis], scene.bounds.max[axis]);
    }
  }

  const sheet = new Canvas(
    count * tileWidth + (count + 1) * gap,
    tileHeight + gap * 2,
    options.background ?? ([24, 26, 32, 255] as Rgba),
  );
  scenes.forEach((scene, i) => {
    const tile = projectScene(scene, view, {
      ...options,
      width: tileWidth,
      height: tileHeight,
      frame,
      background: options.tileBackground ?? ([16, 17, 21, 255] as Rgba),
    });
    sheet.blit(tile, gap + i * (tileWidth + gap), gap);
  });
  return sheet;
}

/** Render one view and write it as a PNG. */
export function renderToFile(model: Model, view: string, file: string, options: RenderOptions = {}): string {
  const canvas = projectModel(model, viewBasis(view), options);
  return writeBinary(file, canvas.toPng());
}
