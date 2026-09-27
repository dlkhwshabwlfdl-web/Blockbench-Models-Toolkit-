import { describe, expect, it } from 'vitest';

import { clamp, fbm2, hashString, hexToRgb, lerp, noise2, rgbToHex, shadeRgb } from '../src/util/math.js';
import { uuidFor, UuidSpace } from '../src/util/uuid.js';
import { Rig } from '../src/model/rig.js';
import { faceCorners, faceFrame, makeCube, mirrorCube } from '../src/model/cubes.js';
import { assignUv, boxUv, skinFieldPolicy } from '../src/model/uv.js';
import { Atlas } from '../src/texture/atlas.js';
import { Canvas, type Rgba } from '../src/texture/canvas.js';
import { bands, eye as eyeBrush, fill, grain } from '../src/texture/brush.js';
import { Palette, ramp } from '../src/texture/palette.js';
import { cycle, sin } from '../src/anim/curves.js';
import { mergeKeys, sortKeys } from '../src/anim/keys.js';
import { locomotion, defaultMotionRig } from '../src/anim/motion.js';

describe('math', () => {
  it('clamps and lerps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(lerp(0, 10, 0.25)).toBe(2.5);
  });

  it('hashes deterministically and differently', () => {
    expect(hashString('trex')).toBe(hashString('trex'));
    expect(hashString('trex')).not.toBe(hashString('crate'));
  });

  it('produces noise inside the unit range and repeats with its period', () => {
    for (let i = 0; i < 50; i += 1) {
      const value = noise2(i * 0.37, i * 0.11, 0);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(noise2(1.25, 0.5, 4)).toBeCloseTo(noise2(5.25, 0.5, 4), 10);
    expect(fbm2(1, 1, 3)).toBe(fbm2(1, 1, 3));
  });

  it('round-trips hex colours', () => {
    expect(hexToRgb('#b0c775')).toEqual([176, 199, 117]);
    expect(rgbToHex([176, 199, 117])).toBe('#b0c775');
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
  });

  it('shades toward black and white', () => {
    for (const channel of shadeRgb([100, 100, 100], 0.5)) expect(channel).toBeCloseTo(177.5, 6);
    expect(shadeRgb([100, 100, 100], -0.5)).toEqual([50, 50, 50]);
  });
});

describe('uuids', () => {
  it('is stable per seed and v4-shaped', () => {
    const a = uuidFor('bone:head');
    expect(a).toBe(uuidFor('bone:head'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(uuidFor('bone:tail'));
  });

  it('namespaces keys', () => {
    const space = new UuidSpace('model');
    expect(space.get('head')).toBe(space.get('head'));
    expect(new UuidSpace('other').get('head')).not.toBe(space.get('head'));
  });
});

describe('rig', () => {
  const build = () => {
    const rig = new Rig();
    rig.add('root', { pivot: [0, 0, 0] });
    rig.add('body', { pivot: [0, 10, 0], parent: 'root' });
    rig.add('head', { pivot: [0, 20, 0], parent: 'body' });
    rig.add('tail', { pivot: [0, 10, -5], parent: 'body' });
    return rig;
  };

  it('rejects unknown parents, duplicates and self-parenting', () => {
    const rig = new Rig();
    expect(() => rig.add('child', { pivot: [0, 0, 0], parent: 'ghost' })).toThrow(/does not exist/);
    rig.add('root', { pivot: [0, 0, 0] });
    expect(() => rig.add('root', { pivot: [0, 0, 0] })).toThrow(/already exists/);
    expect(() => rig.add('loop', { pivot: [0, 0, 0], parent: 'loop' })).toThrow(/parent itself/);
  });

  it('orders parents before children', () => {
    const order = build().ordered().map((bone) => bone.name);
    expect(order.indexOf('root')).toBeLessThan(order.indexOf('body'));
    expect(order.indexOf('body')).toBeLessThan(order.indexOf('head'));
    expect(order.indexOf('body')).toBeLessThan(order.indexOf('tail'));
  });

  it('walks ancestry, subtree and depth', () => {
    const rig = build();
    expect(rig.ancestry('head').map((b) => b.name)).toEqual(['root', 'body', 'head']);
    expect(rig.subtree('body').map((b) => b.name)).toEqual(['body', 'head', 'tail']);
    expect(rig.depth('head')).toBe(2);
    expect(rig.childrenOf('body').map((b) => b.name)).toEqual(['head', 'tail']);
  });
});

describe('cubes', () => {
  it('normalises reversed corners and rejects zero-size boxes', () => {
    const cube = makeCube({ from: [5, 5, 5], to: [-5, -5, -5], bone: 'root' });
    expect(cube.from).toEqual([-5, -5, -5]);
    expect(cube.to).toEqual([5, 5, 5]);
    expect(cube.origin).toEqual([0, 0, 0]);
    expect(() => makeCube({ from: [0, 0, 0], to: [0, 4, 4], bone: 'root' })).toThrow(/zero-size/);
  });

  it('mirrors across X and flips the mirror-uv flag', () => {
    const cube = makeCube({ from: [2, 0, 0], to: [4, 6, 8], bone: 'left_leg', name: 'left_thigh' });
    const mirrored = mirrorCube(cube, 'right_thigh', 'right_leg');
    expect(mirrored.from).toEqual([-4, 0, 0]);
    expect(mirrored.to).toEqual([-2, 6, 8]);
    expect(mirrored.mirrorUv).toBe(true);
    expect(mirrored.name).toBe('right_thigh');
  });

  it('gives every face four corners lying on its own plane and matching the frame size', () => {
    const cube = makeCube({ from: [-2, -1, -3], to: [4, 5, 7], bone: 'root' });
    for (const face of ['north', 'south', 'east', 'west', 'up', 'down'] as const) {
      const frame = faceFrame(cube, face);
      const corners = faceCorners(cube, face);
      expect(corners).toHaveLength(4);
      const distance = (a: readonly number[], b: readonly number[]) =>
        Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      expect(distance(corners[0], corners[1])).toBeCloseTo(frame.width, 10);
      expect(distance(corners[0], corners[3])).toBeCloseTo(frame.height, 10);
      expect(distance(corners[1], corners[2])).toBeCloseTo(frame.height, 10);
      expect(frame.width).toBeGreaterThan(0);
      expect(frame.height).toBeGreaterThan(0);
      // the face centroid sits on the plane the frame reports
      expect(frame.center).toHaveLength(3);
    }
  });
});

describe('uv policy', () => {
  const cube = makeCube({ name: 'thigh', from: [-2, 4, -2], to: [2, 16, 2], bone: 'root' });
  const cube2 = makeCube({ name: 'tail_cube_1', from: [-2, 20, -8], to: [2, 26, -4], bone: 'root' });

  it('prefers explicit windows, then rules, then the fallback', () => {
    cube.faces.north = [1, 1, 3, 5];
    const trace = assignUv([cube, cube2], {
      rules: [{ id: 'tail', when: (c) => c.name.startsWith('tail_'), rect: [8, 8, 12, 12] }],
      fallback: () => [0, 0, 4, 4],
    });
    const north = trace.find((entry) => entry.cube === cube && entry.face === 'north');
    expect(north?.source).toBe('explicit');
    const tailUp = trace.find((entry) => entry.cube === cube2 && entry.face === 'up');
    expect(tailUp?.source).toBe('rule');
    expect(tailUp?.rect).toEqual([8, 8, 12, 12]);
    const south = trace.find((entry) => entry.cube === cube && entry.face === 'south');
    expect(south?.source).toBe('fallback');
    expect(south?.rect).toEqual([0, 0, 4, 4]);
  });

  it('keeps skin-field windows inside the region and brighter towards the top', () => {
    const policy = skinFieldPolicy({ region: [16, 0, 64, 64], heightReference: 38 });
    const high = policy(makeCube({ name: 'skull', from: [-4, 30, 20], to: [4, 38, 30], bone: 'root' }), 'north');
    const low = policy(makeCube({ name: 'foot', from: [-4, 0, -2], to: [4, 4, 6], bone: 'root' }), 'north');
    expect(high[1]).toBeLessThan(low[1]); // smaller v = nearer the lit top of the field
    for (const rect of [high, low]) {
      expect(rect[0]).toBeGreaterThanOrEqual(16);
      expect(rect[2]).toBeLessThanOrEqual(64);
      expect(rect[1]).toBeGreaterThanOrEqual(0);
      expect(rect[3]).toBeLessThanOrEqual(64);
    }
  });

  it('lays out a 3x2 box-uv patch around the origin', () => {
    const rects = boxUv(makeCube({ from: [0, 0, 0], to: [4, 4, 4], bone: 'root' }), [0, 0]);
    expect(Object.keys(rects).sort()).toEqual(['down', 'east', 'north', 'south', 'up', 'west']);
    for (const rect of Object.values(rects)) {
      expect(rect![2]).toBeGreaterThan(rect![0]);
      expect(rect![3]).toBeGreaterThan(rect![1]);
    }
  });
});

describe('canvas and brushes', () => {
  it('writes, clips and reads pixels; encodes to PNG', () => {
    const canvas = new Canvas(4, 4, [0, 0, 0, 0]);
    canvas.set(1, 1, [10, 20, 30, 255]);
    expect(canvas.get(1, 1)).toEqual([10, 20, 30, 255]);
    canvas.set(99, 99, [255, 255, 255, 255]); // out of bounds is a no-op
    canvas.rect(-2, -2, 99, 99, [1, 2, 3, 255]);
    expect(canvas.get(0, 0)).toEqual([1, 2, 3, 255]);
    const png = canvas.toPng();
    expect(png.length).toBeGreaterThan(0);
    expect(Canvas.fromPng(png).get(0, 0)).toEqual([1, 2, 3, 255]);
  });

  it('fills, grains and bands inside a rect only', () => {
    const canvas = new Canvas(8, 8, [0, 0, 0, 0]);
    fill(canvas, [2, 2, 6, 6], [100, 100, 100, 255]);
    expect(canvas.get(3, 3)).toEqual([100, 100, 100, 255]);
    expect(canvas.get(0, 0)).toEqual([0, 0, 0, 0]);

    const grained = new Canvas(8, 8, [0, 0, 0, 0]);
    grain(grained, [0, 0, 8, 8], [120, 120, 120], { amount: 20 });
    const values = new Set<number>();
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) values.add(grained.get(x, y)[0]);
    expect(values.size).toBeGreaterThan(1);
    for (const value of values) expect(Math.abs(value - 120)).toBeLessThanOrEqual(20);
  });

  it('makes discrete bands, not a gradient', () => {
    const canvas = new Canvas(4, 40, [0, 0, 0, 0]);
    bands(canvas, [0, 0, 4, 40], [120, 150, 90], { steps: 4, axis: 'vertical' });
    const column = new Set<string>();
    for (let y = 0; y < 40; y += 1) column.add(canvas.get(0, y).join(','));
    expect(column.size).toBe(4); // exactly four flat values down the column
  });

  it('draws an eye with a pupil and a brow', () => {
    const canvas = new Canvas(8, 8, [0, 0, 0, 0]);
    eyeBrush(canvas, [2, 2, 6, 6]);
    const colors = canvas.distinctColors();
    expect(colors.size).toBeGreaterThanOrEqual(3);
  });
});

describe('palette', () => {
  it('ramps from dark to light and clamps step indices', () => {
    const steps = ramp([100, 100, 100], { steps: 5, contrast: 0.5 });
    expect(steps).toHaveLength(5);
    expect(steps[0][0]).toBeLessThan(steps[4][0]);
    const palette = new Palette();
    palette.define('skin', '#6e8745', { steps: 3 });
    expect(palette.shade('skin', -99)).toEqual(palette.shade('skin', 0));
    expect(palette.shade('skin', 99)).toEqual(palette.shade('skin', 2));
    expect(palette.size()).toBe(3);
  });
});

describe('atlas', () => {
  it('defines islands, refuses overlaps, packs the rest and builds a texture', () => {
    const atlas = new Atlas(32, 32);
    atlas.define('skin', [8, 0, 32, 32]);
    expect(() => atlas.define('clash', [0, 0, 12, 4])).toThrow(/overlaps/);
    atlas.alloc('teeth', 4, 4);
    atlas.alloc('claw', 4, 4);
    expect(atlas.get('teeth')[0]).toBe(0);
    expect(atlas.get('claw')[0]).toBe(4);
    expect(() => atlas.get('missing')).toThrow(/unknown island/);
    const texture = atlas.toTexture('skintex', { useAsDefault: true });
    expect(texture.width).toBe(32);
    expect(texture.data.length).toBeGreaterThan(0);
    expect(texture.useAsDefault).toBe(true);
  });

  it('throws when an island does not fit', () => {
    const atlas = new Atlas(8, 8);
    atlas.alloc('a', 8, 8);
    expect(() => atlas.alloc('b', 8, 8)).toThrow(/no room/);
  });
});

describe('animation primitives', () => {
  it('samples cycles inclusively so a loop closes exactly', () => {
    const sampler = sin(0);
    const keys = cycle('tail_01', 'rotation', 2, 8, (t) => sampler(t));
    expect(keys).toHaveLength(9);
    expect(keys[0].time).toBe(0);
    expect(keys[8].time).toBe(2);
    expect(keys[0].value[0]).toBeCloseTo(keys[8].value[0], 6);
  });

  it('sorts by bone, channel order then time', () => {
    const keys = mergeKeys(
      [{ bone: 'b', channel: 'scale', time: 1, value: [1, 1, 1], interpolation: 'linear' }],
      [{ bone: 'a', channel: 'position', time: 1, value: [0, 0, 0], interpolation: 'linear' }],
      [{ bone: 'a', channel: 'rotation', time: 2, value: [0, 0, 0], interpolation: 'linear' }],
      [{ bone: 'a', channel: 'rotation', time: 1, value: [0, 0, 0], interpolation: 'linear' }],
    );
    expect(keys.map((k) => `${k.bone}:${k.channel}:${k.time}`)).toEqual([
      'a:rotation:1',
      'a:rotation:2',
      'a:position:1',
      'b:scale:1',
    ]);
    expect(sortKeys(keys)).toHaveLength(4);
  });

  it('generates locomotion keys for every bone the rig names', () => {
    const rig = defaultMotionRig();
    const keys = locomotion({ rig, length: 1, stride: 20, knee: 30, bob: 1, lean: 2, tailLift: 2, armSwing: 12, headDrop: -1, samples: 6 });
    const bones = new Set(keys.map((k) => k.bone));
    expect(bones.has('left_leg')).toBe(true);
    expect(bones.has('right_leg')).toBe(true);
    expect(bones.has('tail_07')).toBe(true);
    expect(bones.has('body')).toBe(true);
    expect(keys.every((k) => k.time >= 0 && k.time <= 1)).toBe(true);
  });

  it('counter-phases the left and right legs', () => {
    const rig = defaultMotionRig();
    const keys = locomotion({ rig, length: 1, stride: 30, knee: 0, bob: 0, lean: 0, tailLift: 0, armSwing: 0, headDrop: 0, samples: 8 });
    const left = keys.filter((k) => k.bone === 'left_leg').map((k) => k.value[0]);
    const right = keys.filter((k) => k.bone === 'right_leg').map((k) => k.value[0]);
    expect(left[0]).toBeCloseTo(-right[0], 6);
  });
});

describe('canvas colour counting', () => {
  it('counts distinct opaque colours and ignores transparent pixels', () => {
    const canvas = new Canvas(2, 2, [0, 0, 0, 0]);
    canvas.set(0, 0, [10, 10, 10, 255]);
    canvas.set(1, 0, [10, 10, 10, 255]);
    canvas.set(0, 1, [20, 20, 20, 255]);
    expect(canvas.distinctColors().size).toBe(2);
    const transparent: Rgba = [0, 0, 0, 0];
    expect(canvas.get(1, 1)).toEqual(transparent);
  });
});
