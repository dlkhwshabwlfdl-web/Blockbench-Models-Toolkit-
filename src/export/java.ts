import type { Model } from '../model/model.js';
import { FACE_NAMES } from '../model/types.js';
import type { FaceName, Vec3 } from '../model/types.js';
import { fileStem, writeBinary, writeJson, writeText } from './io.js';

export interface JavaDisplayTransform {
  rotation?: [number, number, number];
  translation?: [number, number, number];
  scale?: [number, number, number];
}

export type JavaDisplay = Record<string, JavaDisplayTransform>;

/** The default Java item-model display block Blockbench writes for a held item. */
export const DEFAULT_JAVA_DISPLAY: JavaDisplay = {
  thirdperson_righthand: { rotation: [75, 45, 35], translation: [0, 2.5, 0], scale: [0.375, 0.375, 0.375] },
  thirdperson_lefthand: { rotation: [75, 45, -35], translation: [0, 2.5, 0], scale: [0.375, 0.375, 0.375] },
  firstperson_righthand: { rotation: [0, 45, 0], scale: [0.4, 0.4, 0.4] },
  firstperson_lefthand: { rotation: [0, -45, 0], scale: [0.4, 0.4, 0.4] },
  gui: { rotation: [30, 225, 0], scale: [0.625, 0.625, 0.625] },
  ground: { translation: [0, 3, 0], scale: [0.25, 0.25, 0.25] },
  fixed: { rotation: [0, 180, 0], scale: [1, 1, 1] },
  head: { rotation: [0, 180, 0], scale: [1, 1, 1] },
};

export interface JavaElementFace {
  uv: [number, number, number, number];
  texture: string;
  rotation?: number;
}

export interface JavaElement {
  name: string;
  from: [number, number, number];
  to: [number, number, number];
  rotation?: { origin: [number, number, number]; axis: 'x' | 'y' | 'z'; angle: number; rescale: boolean };
  faces: Partial<Record<FaceName, JavaElementFace>>;
}

export interface JavaModel {
  credit: string;
  texture_size: [number, number];
  textures: Record<string, string>;
  elements: JavaElement[];
  display: JavaDisplay;
}

export interface JavaOptions {
  /** Height in Java units the model is scaled to occupy. `null` keeps raw units. */
  fitHeight?: number | null;
  /** Java's y axis points down; keep this true unless you already authored y-down. */
  flipY?: boolean;
  display?: JavaDisplay | false;
  credit?: string;
  /** Texture variable map. Defaults to `{ '0': <first texture name>, particle: <same> }`. */
  textures?: Record<string, string>;
  /** Horizontal centre in Java units (usually 8). */
  center?: number;
}

export interface JavaExportResult {
  model: JavaModel;
  /** Non-fatal problems (e.g. a multi-axis element rotation Java cannot express). */
  warnings: string[];
}

const round = (value: number, precision = 4): number => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

/**
 * Convert the toolkit's model space (Y up, feet near y=0) into a Java Block/Item model.
 *
 * Java models are y-down and conventionally live inside a 0..16 box, so the transform is:
 * scale the model to `fitHeight`, mirror Y about that height, and centre it horizontally.
 * Skeletal animation is not representable here — Java carries geometry, UV and texture
 * only; the rig and clips stay in the `.bbmodel`.
 */
export function toJavaModel(model: Model, options: JavaOptions = {}): JavaExportResult {
  model.assignUv();
  const warnings: string[] = [];
  const fitHeight = options.fitHeight === undefined ? 16 : options.fitHeight;
  const flipY = options.flipY ?? true;
  const center = options.center ?? 8;

  const { min, max } = model.bounds();
  const sizeY = max[1] - min[1];
  const scale = fitHeight === null || sizeY === 0 ? 1 : fitHeight / sizeY;
  const midX = (min[0] + max[0]) / 2;
  const midZ = (min[2] + max[2]) / 2;

  const tx = (x: number): number => (x - midX) * scale + center;
  const tz = (z: number): number => (z - midZ) * scale + center;
  const ty = (y: number): number =>
    flipY ? center * 2 - (y - min[1]) * scale : (y - min[1]) * scale;

  const elements: JavaElement[] = model.cubes.map((cube) => {
    const from: [number, number, number] = [tx(cube.from[0]), ty(cube.from[1]), tz(cube.from[2])];
    const to: [number, number, number] = [tx(cube.to[0]), ty(cube.to[1]), tz(cube.to[2])];

    // Java wants from <= to on every axis; the y flip can invert it.
    const minJ: [number, number, number] = [Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.min(from[2], to[2])];
    const maxJ: [number, number, number] = [Math.max(from[0], to[0]), Math.max(from[1], to[1]), Math.max(from[2], to[2])];

    const faces: JavaElement['faces'] = {};
    for (const face of FACE_NAMES) {
      const uv = cube.faces[face];
      if (!uv) continue;
      const v1 = Math.round(uv[1]);
      const v2 = Math.round(uv[3]);
      faces[face] = {
        uv: [Math.round(uv[0]), Math.min(v1, v2), Math.round(uv[2]), Math.max(v1, v2)],
        texture: '#0',
      };
    }

    const element: JavaElement = {
      name: cube.name,
      from: minJ.map((value) => round(value)) as [number, number, number],
      to: maxJ.map((value) => round(value)) as [number, number, number],
      faces,
    };

    const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
    const active = axes.filter((_, i) => Math.abs(cube.rotation[i]) > 1e-6);
    if (active.length === 1) {
      const axis = active[0];
      const index = axes.indexOf(axis);
      element.rotation = {
        origin: [round(tx(cube.origin[0])), round(ty(cube.origin[1])), round(tz(cube.origin[2]))],
        axis,
        angle: round(cube.rotation[index]),
        rescale: false,
      };
    } else if (active.length > 1) {
      warnings.push(
        `java: cube "${cube.name}" has rotation on ${active.join('+')} axes; Java models support one axis — rotation dropped`,
      );
    }
    return element;
  });

  const primaryTexture = options.textures ?? (() => {
    const name = model.textures[0]?.name ?? fileStem(model.name);
    return { '0': name, particle: name };
  })();

  const javaModel: JavaModel = {
    credit: options.credit ?? 'Generated by @trex/aimodel',
    texture_size: [model.resolution[0], model.resolution[1]],
    textures: primaryTexture,
    elements,
    display: options.display === false ? {} : (options.display ?? DEFAULT_JAVA_DISPLAY),
  };

  return { model: javaModel, warnings };
}

export interface JavaWriteOptions extends JavaOptions {
  /** Also write a sibling `<stem>.png` with the model's first texture. */
  writeTexture?: boolean;
  /** Also write the `texture_size` PNG even without a model file. */
  writeMcmeta?: boolean;
}

export interface JavaWriteResult {
  modelPath: string;
  texturePath?: string;
  mcmetaPath?: string;
  warnings: string[];
}

/**
 * Write `<outDir>/<stem>.json`, optionally the texture PNG and a `.mcmeta` sidecar for an
 * animated texture.
 */
export function writeJavaModel(model: Model, outDir: string, options: JavaWriteOptions = {}): JavaWriteResult {
  const { model: javaModel, warnings } = toJavaModel(model, options);
  const stem = fileStem(model.name);
  const modelPath = writeJson(`${outDir}/${stem}.json`, javaModel);

  let texturePath: string | undefined;
  const texture = model.textures[0];
  if (options.writeTexture !== false && texture) {
    texturePath = writeBinary(`${outDir}/${stem}.png`, texture.data);
  }

  let mcmetaPath: string | undefined;
  if (options.writeMcmeta && texture && texture.frameOrder.length > 0) {
    const frametime = texture.frameTime > 0 ? texture.frameTime : 1;
    mcmetaPath = writeText(
      `${outDir}/${stem}.png.mcmeta`,
      `${JSON.stringify(
        {
          animation: {
            frametime,
            interpolate: texture.frameInterpolate,
            frames: texture.frameOrder,
          },
        },
        null,
        2,
      )}\n`,
    );
  }

  return { modelPath, ...(texturePath ? { texturePath } : {}), ...(mcmetaPath ? { mcmetaPath } : {}), warnings };
}

/** The `.mcmeta` document for an animated texture. */
export function toMcmeta(frametime: number, frames: number[], interpolate = false): {
  animation: { frametime: number; interpolate: boolean; frames: number[] };
} {
  return { animation: { frametime, interpolate, frames } };
}

/** Convenience used by tests: the transform a Java export applied. */
export function javaTransform(model: Model, options: JavaOptions = {}): (point: Vec3) => Vec3 {
  const fitHeight = options.fitHeight === undefined ? 16 : options.fitHeight;
  const flipY = options.flipY ?? true;
  const center = options.center ?? 8;
  const { min, max } = model.bounds();
  const sizeY = max[1] - min[1];
  const scale = fitHeight === null || sizeY === 0 ? 1 : fitHeight / sizeY;
  const midX = (min[0] + max[0]) / 2;
  const midZ = (min[2] + max[2]) / 2;
  return (point: Vec3): Vec3 => [
    (point[0] - midX) * scale + center,
    flipY ? center * 2 - (point[1] - min[1]) * scale : (point[1] - min[1]) * scale,
    (point[2] - midZ) * scale + center,
  ];
}
