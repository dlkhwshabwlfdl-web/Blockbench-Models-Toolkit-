import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { Model } from '../src/model/model.js';
import { resolveSpec, type JsonSpec } from '../src/spec.js';
import { validate } from '../src/qa/validate.js';
import { toBbmodel, serializeBbmodel, writeBbmodel } from '../src/export/bbmodel.js';
import { javaTransform, toJavaModel, toMcmeta, writeJavaModel } from '../src/export/java.js';
import { writeOraxen } from '../src/export/oraxen.js';
import { writeItemsAdder } from '../src/export/itemsadder.js';
import { toYaml } from '../src/export/yaml.js';
import { Canvas } from '../src/texture/canvas.js';
import { Atlas } from '../src/texture/atlas.js';
import { bands } from '../src/texture/brush.js';
import { clip } from '../src/anim/clip.js';
import { pos3, rot3 } from '../src/anim/keys.js';
import { metrics } from '../src/render/metrics.js';
import { contactSheet } from '../src/render/render.js';
import { projectModel, viewBasis, VIEWS } from '../src/render/projector.js';
import { buildScene, samplePose, boneWorldTransforms, rotationZYX, transformPoint } from '../src/render/scene.js';
import { FACE_NAMES } from '../src/model/types.js';

/** A two-bone model with a painted atlas, used by most tests below. */
function buildFixture(options: { noisy?: boolean } = {}) {
  const atlas = new Atlas(32, 32);
  atlas.define('skin', [0, 0, 32, 32]);
  bands(atlas.canvas, atlas.get('skin'), [120, 150, 90], {
    // 6 clean bands for the good case; a per-pixel hash for the "noisy" case
    steps: options.noisy ? 1 : 6,
    contrast: 0.4,
  });
  if (options.noisy) {
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        const v = (x * 37 + y * 91) % 255;
        atlas.canvas.set(x, y, [v, (v * 3) % 255, (v * 7) % 255, 255]);
      }
    }
  }

  const model = new Model({ name: 'fixture', resolution: [32, 32] });
  model.bone('root', [0, 0, 0]);
  model.bone('body', [0, 8, 0], 'root');
  model.bone('head', [0, 16, 0], 'body');
  model.cube({ name: 'body_box', from: [-4, 8, -3], to: [4, 16, 3], bone: 'body' });
  model.cube({ name: 'head_box', from: [-3, 16, -3], to: [3, 22, 5], bone: 'head' });
  model.addTexture(atlas.toTexture('fixture_skin', { useAsDefault: true }));
  model.addClip(
    clip({
      name: 'nod',
      loop: 'once',
      length: 1,
      keys: [rot3('head', 0, 0, 0, 0), rot3('head', 1, 25, 0, 0), pos3('body', 0, 0, 0, 0), pos3('body', 1, 0, -1, 0)],
    }),
  );
  model.assignUv();
  return { model, atlas };
}

describe('model', () => {
  it('refuses cubes that target a bone that does not exist', () => {
    const model = new Model({ name: 'x' });
    model.bone('root', [0, 0, 0]);
    expect(() => model.cube({ from: [0, 0, 0], to: [1, 1, 1], bone: 'ghost' })).toThrow(/unknown bone/);
  });

  it('reports bounds, size and a summary', () => {
    const { model } = buildFixture();
    expect(model.size()).toEqual([8, 14, 8]);
    expect(model.bounds().min).toEqual([-4, 8, -3]);
    expect(model.summary()).toContain('2 cubes');
  });

  it('translates a whole subtree', () => {
    const { model } = buildFixture();
    model.translateBone('head', [0, 2, 0]);
    expect(model.findCube('head_box')!.from[1]).toBe(18);
    expect(model.findCube('body_box')!.from[1]).toBe(8);
    expect(model.rig.get('head').pivot[1]).toBe(18);
  });

  it('drops clip keys aimed at bones the model lacks, and says so', () => {
    const model = new Model({ name: 'x' });
    model.bone('root', [0, 0, 0]);
    model.cube({ from: [0, 0, 0], to: [2, 2, 2], bone: 'root' });
    model.addClip(clip({ name: 'mixed', length: 1, keys: [rot3('root', 0, 1, 0, 0), rot3('ghost', 0, 1, 0, 0)] }));
    expect(model.clips[0].keys).toHaveLength(1);
    expect(model.warnings[0]).toMatch(/ghost/);
    expect(validate(model).warnings.some((w) => /ghost/.test(w))).toBe(true);
  });
});

describe('validate', () => {
  it('accepts a clean model', () => {
    const { model } = buildFixture();
    const report = validate(model);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('catches out-of-bounds uv, duplicate names and unknown bone keys', () => {
    const { model } = buildFixture();
    model.findCube('body_box')!.faces.north = [28, 0, 40, 8];
    model.cubes[1].name = 'body_box';
    model.clips[0].keys.push(rot3('phantom', 0, 1, 0, 0));
    const report = validate(model);
    expect(report.errors.some((e) => /outside the 32×32 texture/.test(e))).toBe(true);
    expect(report.errors.some((e) => /duplicate cube name/.test(e))).toBe(true);
    expect(report.errors.some((e) => /keys unknown bone "phantom"/.test(e))).toBe(true);
  });

  it('flags a zero-area uv window', () => {
    const { model } = buildFixture();
    model.findCube('head_box')!.faces.up = [4, 4, 4, 8];
    expect(validate(model).errors.some((e) => /zero-area/.test(e))).toBe(true);
  });
});

describe('.bbmodel writer', () => {
  it('writes the schema Blockbench expects', () => {
    const { model } = buildFixture();
    const doc = toBbmodel(model);
    expect(doc.meta).toEqual({ format_version: '5.0', model_format: 'free', box_uv: false });
    expect(doc.resolution).toEqual({ width: 32, height: 32 });
    expect(doc.elements).toHaveLength(2);
    expect(doc.groups.map((g) => g.name)).toEqual(['root', 'body', 'head']);
    expect(doc.elements[0].type).toBe('cube');
    expect(Object.keys(doc.elements[0].faces).sort()).toEqual([...FACE_NAMES].sort());
    expect(doc.textures[0].source.startsWith('data:image/png;base64,')).toBe(true);
    expect(doc.animations).toHaveLength(1);
    expect(Object.keys(doc.animations[0].animators)).toHaveLength(2);
    const allFrames = Object.values(doc.animations[0].animators).flatMap((animator) => animator.keyframes);
    const rotation = allFrames.find((frame) => frame.channel === 'rotation')!;
    expect(rotation).toMatchObject({ channel: 'rotation', color: -1 });
    expect(rotation.data_points[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(allFrames.some((frame) => frame.channel === 'position')).toBe(true);
  });

  it('nests the outliner and references every element by uuid string', () => {
    const { model } = buildFixture();
    const doc = toBbmodel(model);
    const collect = (node: { children: unknown[] }): Array<string | object> =>
      node.children.flatMap((child) => (typeof child === 'string' ? [child] : [child, ...collect(child as { children: unknown[] })]));
    const root = doc.outliner[0];
    const flattened = collect({ children: [root] });
    const elementUuids = new Set(doc.elements.map((e) => e.uuid));
    for (const uuid of elementUuids) expect(flattened).toContain(uuid);
  });

  it('is byte-for-byte deterministic and serialises with a trailing newline', () => {
    const { model } = buildFixture();
    const text = serializeBbmodel(model);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toBe(serializeBbmodel(model));
  });

  it('can omit animations for a geometry snapshot', () => {
    const { model } = buildFixture();
    expect(toBbmodel(model, { omitAnimations: true }).animations).toEqual([]);
  });

  it('writes to disk', () => {
    const { model } = buildFixture();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimodel-'));
    const file = writeBbmodel(model, path.join(dir, 'fixture.bbmodel'));
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(parsed.name).toBe('fixture');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('java exporter', () => {
  it('fits the model into 0..16 on Y and keeps uv inside the texture', () => {
    const { model } = buildFixture();
    const { model: java, warnings } = toJavaModel(model);
    expect(warnings).toEqual([]);
    for (const element of java.elements) {
      expect(element.from[1]).toBeGreaterThanOrEqual(-0.001);
      expect(element.to[1]).toBeLessThanOrEqual(16.001);
      for (const face of Object.values(element.faces)) {
        expect(face.texture).toBe('#0');
        expect(face.uv[0]).toBeGreaterThanOrEqual(0);
        expect(face.uv[2]).toBeLessThanOrEqual(32);
      }
    }
    expect(java.texture_size).toEqual([32, 32]);
    expect(java.display.gui).toBeDefined();
  });

  it('warns when an element rotates on more than one axis', () => {
    const { model } = buildFixture();
    model.findCube('head_box')!.rotation = [10, 20, 0];
    const { warnings } = toJavaModel(model);
    expect(warnings.some((w) => /rotation on x\+y axes/.test(w))).toBe(true);
  });

  it('flips Y so the feet land at 16', () => {
    const { model } = buildFixture();
    const transform = javaTransform(model);
    const bottom = transform([0, 8, 0]);
    expect(bottom[1]).toBeCloseTo(16, 6);
  });

  it('writes model, texture and mcmeta', () => {
    const { model } = buildFixture();
    model.textures[0].frameOrder = [0, 1];
    model.textures[0].frameTime = 2;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimodel-java-'));
    const result = writeJavaModel(model, dir, { writeMcmeta: true });
    expect(fs.existsSync(result.modelPath)).toBe(true);
    expect(fs.existsSync(result.texturePath!)).toBe(true);
    expect(JSON.parse(fs.readFileSync(result.mcmetaPath!, 'utf8')).animation.frametime).toBe(2);
    expect(toMcmeta(3, [0, 1], true).animation).toEqual({ frametime: 3, interpolate: true, frames: [0, 1] });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('plugin pack exporters', () => {
  it('writes an Oraxen fragment', () => {
    const { model } = buildFixture();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimodel-oraxen-'));
    const result = writeOraxen(model, dir, { itemId: 'crate_item', namespace: 'oraxen' });
    expect(fs.existsSync(result.modelPath)).toBe(true);
    expect(result.modelPath.replace(/\\/g, '/')).toContain('pack/models/fixture.json');
    expect(fs.existsSync(result.texturePath)).toBe(true);
    expect(fs.readFileSync(result.configPath!, 'utf8')).toContain('crate_item:');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes an ItemsAdder fragment', () => {
    const { model } = buildFixture();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimodel-ia-'));
    const result = writeItemsAdder(model, dir, { namespace: 'trex' });
    expect(result.modelPath.replace(/\\/g, '/')).toContain('data/items_packs/trex/models/fixture.json');
    expect(fs.readFileSync(result.configPath!, 'utf8')).toContain('namespace: trex');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('emits valid YAML for nested maps and lists', () => {
    const yaml = toYaml({ info: { namespace: 'trex' }, items: { thing: { textures: ['a:b', 'c:d'], material: 'PAPER', generate: true } } });
    expect(yaml).toContain('namespace: trex');
    expect(yaml).toContain("- 'a:b'");
    expect(yaml).toContain('generate: true');
  });
});

describe('spec resolver', () => {
  const spec: JsonSpec = {
    name: 'prop',
    resolution: [32, 32],
    palette: { stone: '#8a8f98', gold: '#d8a13a' },
    materials: {
      stone: { palette: 'stone', steps: 3 },
      gold: { palette: 'gold', steps: 2 },
    },
    bones: [
      { name: 'root', pivot: [0, 0, 0] },
      { name: 'top', pivot: [0, 8, -4], parent: 'root' },
    ],
    cubes: [
      { name: 'base', from: [-4, 0, -4], to: [4, 8, 4], bone: 'root', material: 'stone' },
      { name: 'cap', from: [-4, 8, -4], to: [4, 10, 4], bone: 'top', material: 'gold' },
    ],
    animations: [
      { kind: 'poses', name: 'flip', length: 0.5, loop: 'once', poses: [{ time: 0, rotations: { top: [0, 0, 0] } }, { time: 0.5, rotations: { top: [-90, 0, 0] } }] },
    ],
  };

  it('builds bones, cubes, materials, texture and animations', () => {
    const { model, atlas } = resolveSpec(spec);
    expect(model.rig.size).toBe(2);
    expect(model.cubes).toHaveLength(2);
    expect(atlas.has('stone')).toBe(true);
    expect(atlas.has('gold')).toBe(true);
    expect(model.textures).toHaveLength(1);
    expect(model.clips).toHaveLength(1);
    for (const cube of model.cubes) {
      for (const face of FACE_NAMES) expect(cube.faces[face]).toBeDefined();
    }
    expect(validate(model).ok).toBe(true);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(resolveSpec(spec).model.clips)).toBe(JSON.stringify(resolveSpec(spec).model.clips));
  });

  it('throws on an unknown material and an out-of-order parent', () => {
    expect(() => resolveSpec({ ...spec, cubes: [{ ...spec.cubes[0], material: 'ghost' }] })).toThrow(/unknown material/);
    expect(() => resolveSpec({ ...spec, bones: [{ name: 'top', pivot: [0, 8, 0], parent: 'root' }, { name: 'root', pivot: [0, 0, 0] }] })).toThrow(/declared later/);
  });

  it('warns when a material names a colour that is not in the palette', () => {
    const { warnings } = resolveSpec({ ...spec, materials: { stone: { palette: 'ghost' }, gold: { palette: 'gold' } } });
    expect(warnings.some((w) => /unknown palette colour/.test(w))).toBe(true);
  });
});

describe('renderer', () => {
  it('exposes the expected views with orthonormal bases', () => {
    for (const name of ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso', 'iso-back']) {
      const basis = VIEWS[name];
      expect(basis).toBeDefined();
      const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(dot(basis.right, basis.up)).toBeCloseTo(0, 6);
      expect(dot(basis.right, basis.forward)).toBeCloseTo(0, 6);
      expect(Math.hypot(...basis.right)).toBeCloseTo(1, 6);
    }
    expect(() => viewBasis('nope')).toThrow(/unknown view/);
  });

  it('covers the model in each view and preserves the expected aspect ratios', () => {
    const { model } = buildFixture();
    const measure = (view: string) => {
      const canvas = projectModel(model, viewBasis(view), { width: 200, height: 200, padding: 4 });
      let x1 = 1e9, y1 = 1e9, x2 = -1, y2 = -1, count = 0;
      for (let y = 0; y < 200; y += 1) {
        for (let x = 0; x < 200; x += 1) {
          if (canvas.get(x, y)[3] > 0) {
            count += 1;
            x1 = Math.min(x1, x);
            y1 = Math.min(y1, y);
            x2 = Math.max(x2, x);
            y2 = Math.max(y2, y);
          }
        }
      }
      return { w: x2 - x1 + 1, h: y2 - y1 + 1, count };
    };
    // model is 8 wide (X), 14 tall (Y), 8 deep (Z)
    const front = measure('front');
    expect(front.count).toBeGreaterThan(100);
    expect(front.w / front.h).toBeCloseTo(8 / 14, 1);
    const side = measure('left');
    expect(side.w / side.h).toBeCloseTo(8 / 14, 1);
    const top = measure('top');
    expect(top.w / top.h).toBeCloseTo(1, 1);
  });

  it('renders a contact sheet wide enough for every tile', () => {
    const { model } = buildFixture();
    const sheet = contactSheet(model, { width: 64, height: 64, views: ['front', 'iso'] });
    expect(sheet.width).toBeGreaterThan(64 * 2);
    expect(sheet.height).toBeGreaterThan(64);
  });
});

describe('scene and pose', () => {
  it('builds a face per cube face', () => {
    const { model } = buildFixture();
    const scene = buildScene(model);
    expect(scene.faces).toHaveLength(2 * 6);
    expect(scene.posed).toBe(false);
  });

  it('interpolates a clip and moves the posed geometry', () => {
    const { model } = buildFixture();
    const pose = samplePose(model.clips[0], 0.5);
    expect(pose.get('head')!.rotation[0]).toBeGreaterThan(0);
    const rest = buildScene(model);
    const posed = buildScene(model, pose);
    const restHead = rest.faces.find((f) => f.cube === 'head_box' && f.face === 'north')!;
    const posedHead = posed.faces.find((f) => f.cube === 'head_box' && f.face === 'north')!;
    expect(posed.posed).toBe(true);
    expect(posedHead.corners[0]).not.toEqual(restHead.corners[0]);
  });

  it('rotates around the bone pivot, not the origin', () => {
    const { model } = buildFixture();
    const world = boneWorldTransforms(model, samplePose({ ...model.clips[0] }, 1));
    const headPivot = model.rig.get('head').pivot;
    const transformed = transformPoint(world.get('head')!, headPivot);
    expect(transformed[0]).toBeCloseTo(headPivot[0], 6);
    expect(transformed[2]).toBeCloseTo(headPivot[2], 6);
    expect(rotationZYX([0, 0, 0])[0]).toBe(1);
  });
});

describe('metrics', () => {
  it('scores clean banded art above noisy art', () => {
    const clean = metrics(buildFixture().model);
    const noisy = metrics(buildFixture({ noisy: true }).model);
    expect(clean.score).toBeGreaterThan(noisy.score);
    expect(noisy.notes.join(' ')).toMatch(/noisy|palette/);
  });

  it('reports palette, colours-per-face and animation coverage', () => {
    const report = metrics(buildFixture().model);
    expect(report.palette).toBeGreaterThan(0);
    expect(report.coloursPerFace).toBeGreaterThan(0);
    expect(report.animatedBoneShare).toBeGreaterThan(0);
    expect(report.orphanAnimators).toEqual([]);
    expect(['S', 'A', 'B', 'C', 'D']).toContain(report.grade);
  });

  it('never scores flatness, only reports it', () => {
    const { model } = buildFixture();
    // flatten every face window to a single colour
    const atlas = Canvas.fromPng(model.textures[0].data);
    atlas.rect(0, 0, 32, 32, [90, 120, 70, 255]);
    model.textures[0].data = atlas.toPng();
    const report = metrics(model);
    expect(report.flatFaceShare).toBe(1);
    expect(report.score).toBeLessThan(100);
  });

  it('lists orphan animators', () => {
    const { model } = buildFixture();
    model.clips[0].keys.push({ bone: 'ghost', channel: 'rotation', time: 0, value: [1, 1, 1], interpolation: 'linear' });
    expect(metrics(model).orphanAnimators).toContain('ghost');
  });
});
