import { describe, expect, it } from 'vitest';

import { Model } from '../src/model/model.js';
import { aroundOrigin, invertAround, transformPoint } from '../src/util/mat4.js';
import type { Vec3 } from '../src/util/math.js';
import {
  auditSeal,
  findBuriedFaces,
  formatSeal,
  penetrationDepth,
} from '../src/qa/assembly.js';

/** A model with one bone and the given cubes already attached to it. */
function scaffold(
  cubes: Array<{ name: string; from: Vec3; to: Vec3; rotation?: Vec3; origin?: Vec3 }>,
): Model {
  const model = new Model({ name: 'test', resolution: [64, 64] });
  model.bone('root', [0, 0, 0]);
  for (const cube of cubes) {
    model.cube({ name: cube.name, from: cube.from, to: cube.to, bone: 'root', rotation: cube.rotation, origin: cube.origin });
  }
  return model;
}

const at = (model: Model, name: string) => model.cubes.find((cube) => cube.name === name)!;

describe('invertAround', () => {
  // Every geometric number downstream is computed in a rotated cube's own frame, so this has to be
  // an exact inverse. Negating the angles is the tempting version and it is wrong: rotationZYX
  // composes Rz·Ry·Rx, whose inverse is Rxᵀ·Ryᵀ·Rzᵀ, not Rz(-c)·Ry(-b)·Rx(-a).
  it('is an exact inverse of aroundOrigin, including non-commuting angles', () => {
    for (const rotation of [[0, 0, 0], [12, -30, 7], [-45, 88, 160], [180, 0, 90], [33, 33, 33]] as Vec3[]) {
      const origin: Vec3 = [3.7, -1.2, 8.4];
      const forward = aroundOrigin(rotation, origin);
      const inverse = invertAround(rotation, origin);
      for (const point of [[0, 0, 0], [5, -2, 9], [-4, 11, -3], [1, 1, 1]] as Vec3[]) {
        const back = transformPoint(inverse, transformPoint(forward, point));
        expect(Math.hypot(back[0] - point[0], back[1] - point[1], back[2] - point[2])).toBeLessThan(1e-9);
      }
    }
  });
});

describe('penetrationDepth', () => {
  it('is zero for boxes that merely touch', () => {
    const model = scaffold([
      { name: 'a', from: [0, 0, 0], to: [4, 4, 4] },
      { name: 'b', from: [4, 0, 0], to: [8, 4, 4] },
    ]);
    expect(penetrationDepth(at(model, 'a'), at(model, 'b')).depth).toBeCloseTo(0, 6);
  });

  it('is zero for boxes that miss each other', () => {
    const model = scaffold([
      { name: 'a', from: [0, 0, 0], to: [4, 4, 4] },
      { name: 'b', from: [5, 0, 0], to: [8, 4, 4] },
    ]);
    expect(penetrationDepth(at(model, 'a'), at(model, 'b')).depth).toBe(0);
  });

  it('reports the narrowest shared width, not the widest', () => {
    // 3 units shared on x, 4 on y, 4 on z — the answer is 3.
    const model = scaffold([
      { name: 'a', from: [0, 0, 0], to: [6, 4, 4] },
      { name: 'b', from: [3, 0, 0], to: [9, 4, 4] },
    ]);
    expect(penetrationDepth(at(model, 'a'), at(model, 'b')).depth).toBeCloseTo(3, 6);
  });

  it('measures how much is shared, not how far it would have to move', () => {
    // A 0.8-thick fin welded inside a 12-unit body, sharing x 3..5, y 4.4..5.2 and z -2..2. The
    // shared widths are 2, 0.8 and 4, so the answer is 0.8 — the fin is attached across its whole
    // thickness. Two things this pins down: `radiusA + radiusB - distance` would say 9.6 here
    // (the body's thickness, not the fin's weld), and the old sampler could never report more
    // than 0.4, so a correctly welded fin sat below the threshold forever.
    const model = scaffold([
      { name: 'body', from: [-6, -6, -6], to: [6, 6, 6] },
      { name: 'fin', from: [3, 4.4, -2], to: [5, 5.2, 2] },
    ]);
    expect(penetrationDepth(at(model, 'body'), at(model, 'fin')).depth).toBeCloseTo(0.8, 9);
  });

  it('is symmetric in its arguments', () => {
    const model = scaffold([
      { name: 'a', from: [0, 0, 0], to: [6, 4, 4] },
      { name: 'b', from: [3, 1, 1], to: [9, 3, 3] },
    ]);
    const forward = penetrationDepth(at(model, 'a'), at(model, 'b')).depth;
    const backward = penetrationDepth(at(model, 'b'), at(model, 'a')).depth;
    expect(forward).toBeCloseTo(backward, 9);
  });

  it('accounts for rotation rather than the unrotated extent', () => {
    // Two boxes whose unrotated extents overlap by 4 on z, but one is rolled 45° so they only
    // meet at a corner. Reading `from`/`to` alone would call this a 4-unit joint.
    const model = scaffold([
      { name: 'a', from: [-2, -2, 0], to: [2, 2, 4] },
      { name: 'b', from: [-2, -2, 6], to: [2, 2, 10], rotation: [0, 0, 45], origin: [0, 0, 8] },
    ]);
    const unrotated = 4;
    const depth = penetrationDepth(at(model, 'a'), at(model, 'b')).depth;
    expect(depth).toBeLessThan(unrotated / 2);
  });

  it('finds a rotated pair that share a hinge and stay sealed', () => {
    const model = scaffold([
      { name: 'a', from: [0, 0, 0], to: [6, 6, 6], rotation: [0, -20, 0], origin: [2, 3, 3] },
      { name: 'b', from: [2, 1, 1], to: [8, 5, 5], rotation: [0, -28, 0], origin: [2, 3, 3] },
    ]);
    expect(penetrationDepth(at(model, 'a'), at(model, 'b')).depth).toBeGreaterThan(1);
  });
});

describe('auditSeal', () => {
  it('checks consecutive pairs only', () => {
    const model = scaffold([
      { name: 'a', from: [0, 0, 0], to: [4, 4, 4] },
      { name: 'b', from: [2, 0, 0], to: [6, 4, 4] },
      // Overlaps `b`, not `a` — and is not adjacent to `a` in the chain, so it is not a joint.
      { name: 'c', from: [4, 0, 0], to: [9, 4, 4] },
    ]);
    const report = auditSeal(model, [['a', 'b', 'c']], { minDepth: 1 });
    expect(report.pairs.map((pair) => `${pair.a}->${pair.b}`)).toEqual(['a->b', 'b->c']);
    expect(report.ok).toBe(true);
  });

  it('reports a chain whose second joint is open', () => {
    const model = scaffold([
      { name: 'a', from: [0, 0, 0], to: [4, 4, 4] },
      { name: 'b', from: [2, 0, 0], to: [6, 4, 4] },
      { name: 'c', from: [6.2, 0, 0], to: [9, 4, 4] },
    ]);
    const report = auditSeal(model, [['a', 'b', 'c']], { minDepth: 1 });
    expect(report.ok).toBe(false);
    expect(report.open).toHaveLength(1);
    expect(report.open[0].b).toBe('c');
    expect(formatSeal(report)).toContain('OPEN');
  });

  it('ignores a chain that names a cube the model does not have', () => {
    const model = scaffold([{ name: 'a', from: [0, 0, 0], to: [4, 4, 4] }]);
    const report = auditSeal(model, [['a', 'ghost']], { minDepth: 1 });
    expect(report.pairs).toHaveLength(0);
    expect(report.ok).toBe(true);
  });
});

describe('findBuriedFaces', () => {
  /** A head with an eye on its east side, and a cheek plate outboard of the eye. */
  const headEyeCheek = (cheekRotation?: Vec3): Model =>
    scaffold([
      { name: 'head', from: [-4, 0, -4], to: [4, 8, 4] },
      { name: 'eye', from: [2, 3, -2], to: [5, 5, 2] },
      {
        // Starts at x 3.8, inside the head's 4, so between them the head and the cheek close off
        // every direction the eye could be seen from. A plate starting at 4.5 leaves a sliver of
        // the eye's north face open and the eye is then, strictly, still visible.
        name: 'cheek',
        from: [3.8, 2, -3],
        to: [6, 6, 3],
        ...(cheekRotation ? { rotation: cheekRotation, origin: [6, 2, -3] as Vec3 } : {}),
      },
    ]);

  it('reports an eye whose cheek grew past it', () => {
    // The eye is present, correctly placed and correctly textured, and the cheek plate outboard of
    // it covers its outward face completely. Nothing is malformed; the detail just cannot be seen.
    const report = findBuriedFaces(headEyeCheek());
    expect(report.hiddenCubes.map((entry) => entry.cube)).toEqual(['eye']);
    expect(report.hiddenCubes[0].faces).toBe(6);
    expect(report.ok).toBe(false);
    // The outward face specifically is the one the cheek took, and the inward one is the head.
    const east = report.buriedFaces.find((face) => face.cube === 'eye' && face.face === 'east');
    expect(east?.blockedBy).toBe('cheek');
    const west = report.buriedFaces.find((face) => face.cube === 'eye' && face.face === 'west');
    expect(west?.blockedBy).toBe('head');
  });

  it('does not treat a buried face as a hidden cube', () => {
    // The eye sits half inside the head, so its inward face is buried — which is normal and not a
    // defect. Only a cube with *no* visible face is. Gating on buried faces instead would flag
    // almost every cube in a jointed model.
    const report = findBuriedFaces(scaffold([
      { name: 'head', from: [-4, 0, -4], to: [4, 8, 4] },
      { name: 'eye', from: [2, 3, -2], to: [5, 5, 2] },
    ]));
    expect(report.buriedFaces.some((face) => face.cube === 'eye')).toBe(true);
    expect(report.hiddenCubes).toHaveLength(0);
    expect(report.ok).toBe(true);
  });

  it('never reports a cube as blocking itself', () => {
    const model = scaffold([{ name: 'solo', from: [0, 0, 0], to: [4, 4, 4] }]);
    const report = findBuriedFaces(model);
    expect(report.buriedFaces).toHaveLength(0);
    expect(report.hiddenCubes).toHaveLength(0);
  });

  it('tracks a rotation when deciding what is in front', () => {
    // The same cheek, rolled 90° about its own bottom-front edge so it lies flat and below the eye.
    // Read from `from`/`to` alone it still covers the eye; the rotated pose does not.
    const report = findBuriedFaces(headEyeCheek([90, 0, 0]));
    expect(report.hiddenCubes).toHaveLength(0);
  });
});
