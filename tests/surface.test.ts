import { describe, expect, it } from 'vitest';

import { Model } from '../src/model/model.js';
import { posedFaceCorners, visibleFaces } from '../src/model/cubes.js';
import { bevelEdges, elementMatrix, rotateAround, setRotation, slab } from '../src/model/rotation.js';
import { Atlas } from '../src/texture/atlas.js';
import { Canvas } from '../src/texture/canvas.js';
import { bands } from '../src/texture/brush.js';
import {
  bridgeColors,
  deriveShade,
  harmonize,
  hslToRgb,
  resolveStyle,
  rgbToHsl,
  softenSeams,
  SURFACE_STYLES,
} from '../src/texture/harmony.js';
import {
  findCoincidentFaces,
  findDuplicateCubes,
  geometricHygiene,
  faceSurfaceAreas,
} from '../src/qa/coincident.js';
import { boneWorldTransforms, samplePose } from '../src/render/scene.js';
import { clip, pose } from '../src/anim/clip.js';
import { rot } from '../src/anim/keys.js';

/** A model with a root bone, ready for cubes. */
function scaffold(name = 'test'): Model {
  const model = new Model({ name, resolution: [64, 64] });
  model.bone('root', [0, 0, 0]);
  return model;
}

describe('element rotation', () => {
  it('rotates around the cube centre by default', () => {
    const cube = {
      from: [0, 0, 0] as [number, number, number],
      to: [4, 2, 2] as [number, number, number],
      rotation: [0, 0, 180] as [number, number, number],
      origin: [2, 1, 1] as [number, number, number],
    };
    const corners = posedFaceCorners(cube as never, 'up');
    // A half turn about the centre maps every corner onto another corner, so the axis-aligned
    // extent is unchanged even though the cube has flipped.
    const xs = corners.map((corner) => corner[0]);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(4, 6);
  });

  it('moves corners off the axis grid when tilted', () => {
    const model = scaffold();
    const flat = model.cube({ name: 'flat', from: [0, 0, 0], to: [4, 4, 4], bone: 'root' });
    const upright = posedFaceCorners(flat, 'up');

    const tilted = model.cube({
      name: 'tilted',
      from: [0, 0, 0],
      to: [4, 4, 4],
      bone: 'root',
      rotation: [45, 0, 0],
      origin: [2, 0, 0],
    });
    const sloped = posedFaceCorners(tilted, 'up');

    // The flat top face is planar at y = 4; the tilted one is not, which is the whole point.
    expect(upright.every((corner) => Math.abs(corner[1] - 4) < 1e-9)).toBe(true);
    expect(sloped.some((corner) => Math.abs(corner[1] - 4) > 0.5)).toBe(true);
    // Rotating about the shared bottom edge leaves that edge where it was.
    expect(Math.min(...sloped.map((corner) => corner[1]))).toBeCloseTo(0, 6);
  });

  it('writes rotation into the element transform', () => {
    const cube = { rotation: [0, 90, 0] as [number, number, number], origin: [0, 0, 0] as [number, number, number] };
    const matrix = elementMatrix(cube);
    // 90° about Y sends +X to −Z.
    expect(matrix[0]).toBeCloseTo(0, 6);
    expect(matrix[2]).toBeCloseTo(-1, 6);
  });

  it('sets, composes and clears rotation', () => {
    const model = scaffold();
    const cube = model.cube({ name: 'c', from: [0, 0, 0], to: [2, 2, 2], bone: 'root' });
    setRotation(cube, [10, 0, 0]);
    rotateAround(cube, 'y', 15);
    expect(cube.rotation).toEqual([10, 15, 0]);
    rotateAround(cube, 'z', 5, [1, 1, 1]);
    expect(cube.origin).toEqual([1, 1, 1]);
  });

  it('builds a bevel strip that is rotated about the free axis', () => {
    const strips = bevelEdges({
      name: 'box',
      from: [-4, 0, -4],
      to: [4, 8, 4],
      bone: 'root',
      edges: ['top-left'],
      chamfer: 2,
    });
    expect(strips).toHaveLength(1);
    const [strip] = strips;
    expect(strip.rotation?.[2]).toBe(45);
    expect(strip.rotation?.[0]).toBe(0);
    // The strip keeps the parent's full extent on the free axis (z) and is narrower on the two
    // pinned axes, so it can only ever shave the corner.
    expect(strip.from?.[2]).toBe(-4);
    expect(strip.to?.[2]).toBe(4);
    expect((strip.to?.[0] ?? 0) - (strip.from?.[0] ?? 0)).toBeLessThan(8);
  });

  it('rejects an edge that names two ends of the same axis', () => {
    expect(() =>
      bevelEdges({ name: 'box', from: [-1, 0, -1], to: [1, 2, 1], bone: 'root', edges: ['top-bottom' as never] }),
    ).toThrow(/unknown edge|different axes/);
  });

  it('builds a wedge slab pivoted where asked', () => {
    const options = slab({
      name: 'fin',
      from: [0, 4, 0],
      to: [1, 8, 6],
      bone: 'root',
      axis: 'x',
      degrees: -22,
      origin: [0.5, 4, 0],
    });
    expect(options.rotation).toEqual([-22, 0, 0]);
    expect(options.origin).toEqual([0.5, 4, 0]);
  });
});

describe('coincident geometry', () => {
  it('finds two faces sharing a plane and a normal', () => {
    const model = scaffold();
    // Level with each other and overlapping by half in x: their top faces are on one plane and
    // point the same way, which is the arrangement that shimmers.
    model.cube({ name: 'a', from: [0, 0, 0], to: [4, 4, 4], bone: 'root' });
    model.cube({ name: 'b', from: [2, 0, 0], to: [6, 4, 4], bone: 'root' });
    const report = findCoincidentFaces(model);
    const pair = report.pairs.find((entry) => entry.kind === 'duplicate');
    expect(pair).toBeDefined();
    expect(pair?.overlap).toBeCloseTo(8, 6);
    expect(pair?.coverage).toBeCloseTo(0.5, 6);
  });

  it('classifies back-to-back faces as interior', () => {
    const model = scaffold();
    model.cube({ name: 'a', from: [0, 0, 0], to: [4, 4, 4], bone: 'root' });
    model.cube({ name: 'b', from: [0, 0, 4], to: [4, 4, 8], bone: 'root' });
    const report = findCoincidentFaces(model);
    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0].kind).toBe('interior');
    expect(report.pairs[0].coverage).toBeCloseTo(1, 6);
  });

  it('reports nothing for faces that only touch along an edge', () => {
    // Stacked diagonally: the two faces are coplanar but share no area, so there is nothing to
    // z-fight over and no report to make.
    const model = scaffold();
    model.cube({ name: 'a', from: [0, 0, 0], to: [4, 4, 4], bone: 'root' });
    model.cube({ name: 'b', from: [4, 4, 0], to: [8, 8, 4], bone: 'root' });
    expect(findCoincidentFaces(model).pairs).toHaveLength(0);
  });

  it('treats two cubes butted face to face as one interior pair', () => {
    // They share a whole plane, so those two faces are never visible from outside.
    const model = scaffold();
    model.cube({ name: 'a', from: [0, 0, 0], to: [4, 4, 4], bone: 'root' });
    model.cube({ name: 'b', from: [4, 0, 0], to: [8, 4, 4], bone: 'root' });
    const report = findCoincidentFaces(model);
    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0].kind).toBe('interior');
    expect(report.pairs[0].coverage).toBeCloseTo(1, 6);
  });

  it('finds duplicate cubes by bounds and rotation', () => {
    const model = scaffold();
    model.cube({ name: 'a', from: [0, 0, 0], to: [4, 4, 4], bone: 'root' });
    model.cube({ name: 'b', from: [0, 0, 0], to: [4, 4, 4], bone: 'root' });
    expect(findDuplicateCubes(model)).toEqual([{ a: 'a', b: 'b' }]);
  });

  it('hides a fully covered face but leaves a barely covered one alone', () => {
    // A small ridge on a wide back. The ridge's bottom face is fully covered and can go; the
    // back's top face is only 7% covered and hiding it would cut a hole straight through.
    const model = scaffold();
    model.cube({ name: 'back', from: [-7, 0, -8], to: [7, 10, 4], bone: 'root' });
    model.cube({ name: 'ridge', from: [-1.6, 10, -6], to: [1.6, 13, -2], bone: 'root' });
    const result = geometricHygiene(model);

    const back = model.findCube('back');
    const ridge = model.findCube('ridge');
    expect(ridge?.hidden.has('down')).toBe(true);
    expect(back?.hidden.has('up')).toBe(false);
    expect(result.hiddenByCube.back).toBeUndefined();
  });

  it('retracts a partly overlapping duplicate instead of deleting it', () => {
    // Side by side with their tops level: the two top faces claim the same plane and face the
    // same way, and each covers only a third of the other. Neither may be deleted — the loser's
    // surface is real geometry — so its face is pulled just behind the winner's.
    const model = scaffold();
    model.cube({ name: 'first', from: [0, 0, 0], to: [6, 4, 6], bone: 'root' });
    const later = model.cube({ name: 'later', from: [4, 0, 0], to: [10, 4, 6], bone: 'root' });
    const result = geometricHygiene(model, { epsilon: 0.05 });

    expect(later.to[1]).toBeCloseTo(3.95, 6);
    expect(later.from[1]).toBeCloseTo(0.05, 6);
    expect(later.hidden.size).toBe(0);
    expect(result.resolved).toContainEqual({ cube: 'later', face: 'up', reason: 'duplicate' });
  });

  it('reports accumulated coverage per face, not per pair', () => {
    const model = scaffold();
    model.cube({ name: 'base', from: [-6, 0, -6], to: [6, 4, 6], bone: 'root' });
    model.cube({ name: 'left', from: [-6, 4, -6], to: [0, 6, 6], bone: 'root' });
    model.cube({ name: 'right', from: [0, 4, -6], to: [6, 6, 6], bone: 'root' });
    const areas = faceSurfaceAreas(model);
    expect(areas.get('base|up')).toBeCloseTo(144, 6);
    // Two neighbours covering half each add up to full coverage of the base's top face.
    const hidden = geometricHygiene(model).hiddenByCube;
    expect(hidden.base).toContain('up');
  });

  it('writes nothing in report mode', () => {
    const model = scaffold();
    model.cube({ name: 'a', from: [0, 0, 0], to: [4, 4, 4], bone: 'root' });
    model.cube({ name: 'b', from: [0, 0, 4], to: [4, 4, 8], bone: 'root' });
    const result = geometricHygiene(model, { mode: 'report' });
    expect(result.resolved).toHaveLength(2);
    expect(model.cubes.every((cube) => cube.hidden.size === 0)).toBe(true);
  });

  it('ignores hidden faces', () => {
    const model = scaffold();
    model.cube({ name: 'a', from: [0, 0, 0], to: [4, 4, 4], bone: 'root' });
    model.cube({ name: 'b', from: [0, 0, 4], to: [4, 4, 8], bone: 'root' });
    model.findCube('a')?.hidden.add('south');
    expect(findCoincidentFaces(model).pairs).toHaveLength(0);
    expect(visibleFaces(model.findCube('a')!)).not.toContain('south');
  });

  it('steps a face out of the plane only when asked to separate', () => {
    const model = scaffold();
    model.cube({ name: 'a', from: [0, 0, 0], to: [4, 4, 4], bone: 'root' });
    model.cube({ name: 'b', from: [0, 0, 4], to: [4, 4, 8], bone: 'root' });
    geometricHygiene(model, { mode: 'separate', epsilon: 0.1 });
    expect(model.findCube('a')?.to[2]).toBeCloseTo(3.9, 6);
    expect(model.findCube('b')?.from[2]).toBeCloseTo(4.1, 6);
  });
});

describe('colour harmony', () => {
  it('round-trips RGB through HSL', () => {
    for (const rgb of [
      [0, 0, 0],
      [255, 255, 255],
      [176, 199, 117],
      [126, 48, 64],
      [12, 200, 45],
    ] as Array<[number, number, number]>) {
      const back = hslToRgb(rgbToHsl(rgb));
      expect(Math.abs(back[0] - rgb[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(back[1] - rgb[1])).toBeLessThanOrEqual(1);
      expect(Math.abs(back[2] - rgb[2])).toBeLessThanOrEqual(1);
    }
  });

  it('pulls a set of colours toward one hue without flattening lightness', () => {
    const olive: [number, number, number] = [176, 199, 117];
    const swamp: [number, number, number] = [62, 74, 40];
    const [a, b] = harmonize([olive, swamp], { strength: 0.8 });
    const hueGap = (x: number[], y: number[]): number => {
      const delta = Math.abs(rgbToHsl(x as never)[0] - rgbToHsl(y as never)[0]);
      return Math.min(delta, 360 - delta);
    };
    // Closer in hue than they started...
    expect(hueGap(a, b)).toBeLessThan(hueGap(olive, swamp));
    // ...but still different in lightness, so the shading survives.
    expect(rgbToHsl(a as never)[2]).toBeGreaterThan(rgbToHsl(b as never)[2] + 0.2);
  });

  it('leaves a single colour untouched and respects pinned indices', () => {
    const colors: Array<[number, number, number]> = [
      [200, 60, 60],
      [60, 200, 60],
    ];
    expect(harmonize([colors[0]])).toEqual([colors[0]]);
    const [first] = harmonize(colors, { strength: 1, pinned: [0] });
    expect(first).toEqual(colors[0]);
  });

  it('derives a shade that keeps the hue', () => {
    const base: [number, number, number] = [176, 199, 117];
    const dark = deriveShade(base, { lightness: -0.2 });
    // Quantising back to 8 bits shifts the hue a fraction of a degree; anything larger means
    // the shade has drifted into a different colour family.
    const hueGap = Math.abs(rgbToHsl(dark)[0] - rgbToHsl(base)[0]);
    expect(Math.min(hueGap, 360 - hueGap)).toBeLessThan(1.5);
    expect(rgbToHsl(dark)[2]).toBeLessThan(rgbToHsl(base)[2]);
  });

  it('accepts hex as well as RGB', () => {
    expect(deriveShade('#b0c775', { lightness: -0.2 })).toEqual(deriveShade([176, 199, 117], { lightness: -0.2 }));
  });

  it('bridges two colours through the middle', () => {
    const steps = bridgeColors([0, 0, 0], [100, 100, 100], 2);
    expect(steps).toHaveLength(2);
    expect(steps[0][0]).toBeLessThan(steps[1][0]);
  });

  it('resolves style names and partial overrides', () => {
    expect(resolveStyle('sharp').edgeSoftness).toBe(0);
    expect(resolveStyle({ edgeSoftness: 9 }).edgeSoftness).toBe(9);
    expect(resolveStyle({ edgeSoftness: 9 }).bands).toBe(SURFACE_STYLES.balanced.bands);
  });
});

describe('seam softening', () => {
  const FACES = ['north', 'south', 'east', 'west', 'up', 'down'] as const;

  /** Hands out a fresh 4×4 slot inside a region, one per call. */
  function slotter(x0: number, y0: number, columns = 4): () => [number, number, number, number] {
    let n = 0;
    return () => {
      const x = x0 + (n % columns) * 4;
      const y = y0 + Math.floor(n / columns) * 4;
      n += 1;
      return [x, y, x + 4, y + 4];
    };
  }

  /**
   * Two stacked cubes, each face given its own texture window.
   *
   * Distinct windows matter: a tool that only ever writes texels with a single owner can only
   * be exercised by a model where every face owns its own texels, which is what a healthy atlas
   * looks like. Sharing one window between six faces is the failing case, tested separately.
   */
  function stack(): Model {
    const atlas = new Atlas(64, 64);
    atlas.define('body', [0, 0, 16, 16]);
    atlas.define('plate', [16, 0, 32, 16]);
    bands(atlas.canvas, atlas.get('body'), [176, 199, 117], { steps: 4, contrast: 0.3, axis: 'vertical' });
    bands(atlas.canvas, atlas.get('plate'), [62, 74, 40], { steps: 4, contrast: 0.3, axis: 'vertical' });

    const model = scaffold('two');
    model.cube({ name: 'main', from: [0, 0, 0], to: [8, 8, 8], bone: 'root' });
    model.cube({ name: 'plate_cube', from: [0, 8, 0], to: [8, 10, 8], bone: 'root' });
    model.addTexture(atlas.toTexture('t', { useAsDefault: true }));

    const bodySlot = slotter(0, 0);
    const plateSlot = slotter(16, 0);
    model.uvPolicy = {
      rules: [{ id: 'island:plate', when: (cube) => cube.name.startsWith('plate'), rect: () => plateSlot() }],
      fallback: () => bodySlot(),
    };
    model.assignUv();
    return model;
  }

  it('records which rule claimed each face', () => {
    const model = stack();
    const plate = model.uvTrace.find((entry) => entry.cube.name === 'plate_cube' && entry.face === 'up');
    const main = model.uvTrace.find((entry) => entry.cube.name === 'main' && entry.face === 'up');
    expect(plate?.material).toBe('island:plate');
    expect(main?.material).toBeUndefined();
  });

  it('bridges a join between two materials', () => {
    const result = softenSeams(stack(), { style: 'balanced' });
    expect(result.pixels).toBeGreaterThan(0);
    expect(result.sharedJoins).toBe(0);
  });

  it('never introduces a colour that was not already in the texture', () => {
    const model = stack();
    const before = new Set(Canvas.fromPng(model.textures[0].data).distinctColors().keys());
    softenSeams(model, { style: 'soft' });
    const after = Canvas.fromPng(model.textures[0].data).distinctColors().keys();
    for (const key of after) expect(before.has(key)).toBe(true);
  });

  it('does nothing at all in the sharp style', () => {
    const model = stack();
    const original = model.textures[0].data.slice();
    const result = softenSeams(model, { style: 'sharp' });
    expect(result.softness).toBe(0);
    expect(result.pixels).toBe(0);
    expect(model.textures[0].data).toEqual(original);
  });

  it('leaves joins inside one material alone', () => {
    // One fallback for every face: no material changes anywhere, so nothing should move —
    // even though neighbouring faces sample visibly different bands.
    const model = scaffold('one');
    model.cube({ name: 'main', from: [0, 0, 0], to: [8, 8, 8], bone: 'root' });
    model.cube({ name: 'top', from: [0, 8, 0], to: [8, 10, 8], bone: 'root' });
    const atlas = new Atlas(64, 64);
    bands(atlas.canvas, [0, 0, 16, 16], [176, 199, 117], { steps: 6, contrast: 0.5, axis: 'vertical' });
    model.addTexture(atlas.toTexture('t', { useAsDefault: true }));
    const slot = slotter(0, 0);
    model.uvPolicy = { fallback: () => slot() };
    model.assignUv();

    expect(softenSeams(model, { style: 'balanced' }).pixels).toBe(0);
    expect(softenSeams(model, { style: 'balanced', acrossMaterialsOnly: false }).pixels).toBeGreaterThan(0);
  });

  it('refuses to write texels that several faces read', () => {
    // Every face of both cubes pointing at one window: the texels have twelve owners and a
    // mixture of materials. Writing would recolour all of them, so nothing may be written.
    const model = stack();
    for (const cube of model.cubes) {
      for (const face of FACES) cube.faces[face] = [0, 0, 8, 8];
    }
    const original = model.textures[0].data.slice();
    // `minDifference: 0` so the colour test cannot mask the ownership check — every join is
    // offered to the writer, and the writer must turn all of them down.
    const result = softenSeams(model, {
      style: 'balanced',
      acrossMaterialsOnly: false,
      minDifference: 0,
    });
    expect(result.sharedJoins).toBeGreaterThan(0);
    expect(result.pixels).toBe(0);
    expect(model.textures[0].data).toEqual(original);
  });

  it('writes a shared island when explicitly allowed', () => {
    // Six faces per window, one material throughout: this is the belly-island shape, where a
    // rim on the whole island is a deliberate choice rather than contamination.
    const model = stack();
    for (const cube of model.cubes) {
      const window = cube.name === 'main' ? [16, 0, 20, 4] : [16, 12, 20, 16];
      for (const face of FACES) cube.faces[face] = window as [number, number, number, number];
    }
    const blocked = softenSeams(model, { style: 'balanced', acrossMaterialsOnly: false });
    expect(blocked.pixels).toBe(0);
    expect(blocked.sharedJoins).toBeGreaterThan(0);

    const allowed = softenSeams(stackWithSharedWindows(), {
      style: 'balanced',
      acrossMaterialsOnly: false,
      shareIslands: true,
    });
    expect(allowed.pixels).toBeGreaterThan(0);
  });

  /** The same geometry with the shared-window atlas, built fresh so the first pass is clean. */
  function stackWithSharedWindows(): Model {
    const model = stack();
    for (const cube of model.cubes) {
      const window = cube.name === 'main' ? [16, 0, 20, 4] : [16, 12, 20, 16];
      for (const face of FACES) cube.faces[face] = window as [number, number, number, number];
    }
    return model;
  }

  it('respects minDifference', () => {
    const result = softenSeams(stack(), { style: 'balanced', minDifference: 765 });
    expect(result.pixels).toBe(0);
  });

  it('produces a deterministic result', () => {
    const first = stack();
    softenSeams(first, { style: 'soft' });
    const second = stack();
    softenSeams(second, { style: 'soft' });
    expect(first.textures[0].data).toEqual(second.textures[0].data);
  });

  it('meshes with a posed skeleton without throwing', () => {
    const model = stack();
    const active = clip({
      name: 'sway',
      length: 1,
      keys: pose([
        { time: 0, rotations: { root: rot(0, 20, 0) } },
        { time: 1, rotations: { root: rot(0, -20, 0) } },
      ]),
    });
    model.addClip(active);
    expect(boneWorldTransforms(model, samplePose(active, 0.5)).has('root')).toBe(true);
    expect(() => softenSeams(model, { style: 'soft', pose: samplePose(active, 0.5) })).not.toThrow();
  });
});
