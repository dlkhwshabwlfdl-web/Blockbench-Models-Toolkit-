---
name: minecraft-rig-and-bones
description: Build and structure the bone rig for a Minecraft model — pivots, parent hierarchy, limbs, tail and neck chains, teeth and claw rows, mirrored left/right parts, and box/plate primitives. Use when defining a skeleton, animating a limb, creating a mob's body structure, mirroring a part across X, or when a model needs a bone hierarchy before cubes can be attached.
---

# Rig and geometry

A **bone** (Blockbench calls it a group) owns a pivot and a parent. It is the only thing that
makes a model animatable, and every cube must be attached to one.

## Bones

```js
model.bone('root', [0, 0, 0]);            // no parent = root
model.bone('body', [0, 22, -4], 'root');  // pivot, parent
model.bone('head', [0, 32, 20], 'body');
```

- **Pivots are in model space and are the rotation origin.** Put a knee bone's pivot at the
  knee, an elbow bone's at the elbow, a jaw bone's at the hinge. A pivot in the wrong place
  makes an otherwise correct animation look broken.
- **Declare parents first.** `model.bone('head', …, 'body')` throws if `body` does not exist.
- Duplicate names throw. Self-parenting throws.
- Exactly one root bone is the convention; `validate()` warns about more.
- Optional extra: `model.bone(name, pivot, parent, { color: 3, rotation: [0, 0, 0] })`.

### Inspect the rig

```js
model.rig.get('head');            // the Bone record
model.rig.ancestry('head');       // root → … → head
model.rig.subtree('body');        // body plus every descendant, parents first
model.rig.childrenOf('body');
model.rig.depth('toes');          // distance from the root
model.rig.has('tail_01');
```

### Move a whole limb

```js
model.translateBone('head', [0, 2, 0]);   // shifts every cube in the subtree and the pivots
model.reassign('old_bone', 'new_bone');   // re-home every cube of one bone
```

## Cubes

```js
model.cube({
  name: 'torso',
  from: [-7, 17, -9],
  to: [7, 29, 3],
  bone: 'body',
  inflate: 0,          // optional, grows every side
  rotation: [0, 0, 0], // optional, element-local
  faces: {},           // optional, explicit UV windows per face
});
```

`from` and `to` are normalised, so either corner order works — convenient for mirrored
limbs. A zero-size box throws.

## Higher-order builders

```js
import { mirrorPair, spikes, boneChain, segmentedBoxes, plate, series } from '…/dist/index.js';

// left and right halves in one call
model.cube(...mirrorPair({ name: 'leg', from: [3.4, 9, -7], to: [8.8, 19.6, 3],
                           bone: 'left_leg', mirroredBone: 'right_leg' }));

// a row of teeth on both sides
for (const cube of spikes({ count: 3, start: [2.8, 29, 32.3], step: [0, 0, 3], size: [1.2, 2, 1.4],
                            bone: 'upper_jaw', prefix: 'tooth_upper', bothSides: true })) model.cube(cube);

// a neck or tail: bones and their pivots in one call
const tail = boneChain(model, {
  names: ['tail_01', 'tail_02', 'tail_03'],
  pivots: [[0, 22, -9], [0, 22, -17], [0, 22, -25]],
  parent: 'body',
});

// a tapering run of boxes on one bone
for (const cube of segmentedBoxes({ bone: 'tail_01', prefix: 'tail_cube', start: [-5.4, 18, -17],
                                    count: 3, size: [10.8, 9, 8], step: [0, 0, -8], taper: 0.9 })) model.cube(cube);

// a thin fin or ridge
model.cube(plate({ name: 'fin', from: [-1, 28, -6], to: [1, 34, 4], bone: 'body', thicknessAxis: 'x', thickness: 1.2 }));
```

## Proportions that read as Minecraft

- Keep the model in the same rough scale as a vanilla entity (a mob is typically 16–48
  units tall). Extreme values distort the in-game camera views.
- Feet at `y = 0`. Legs should touch the ground, not float or sink.
- Build large masses from a few boxes and add small boxes for the details that carry
  character: eyes, teeth, claws, ridges, ears. Detail boxes are cheap; a shape made of 40
  boxes reads better than one 6-box slab.
- For a limb, split it at the joints even if the parts are co-linear — a single box cannot
  bend, so a knee-less leg cannot walk.
- Mirror deliberately for symmetry, but leave small asymmetries (a scar, one raised ear) —
  perfect symmetry is what the metrics flag as "check for a missing part".

## Worked example — a quadruped leg

```js
model.bone('left_leg',  [3, 14, -2], 'body');
model.bone('left_shin', [3, 8, -1],  'left_leg');
model.bone('left_foot', [3, 3, 0],   'left_shin');
model.bone('left_toes', [3, 2, 4],   'left_foot');

for (const [name, from, to, bone] of [
  ['left_thigh',  [2.5, 8, -3.5], [6, 15, 3],   'left_leg'],
  ['left_shin_c', [2.8, 2.6, -2], [5.5, 8.4, 2],'left_shin'],
  ['left_foot_c', [2.7, 0, -1.5], [5.8, 3.2, 5],'left_foot'],
  ['left_toe',    [2.9, 0, 5],    [5.6, 1.6, 8],'left_toes'],
]) model.cube({ name, from, to, bone });

// the mirrored half
model.bone('right_leg',  [-3, 14, -2], 'body');
model.bone('right_shin', [-3, 8, -1],  'right_leg');
model.bone('right_foot', [-3, 3, 0],   'right_shin');
model.bone('right_toes', [-3, 2, 4],   'right_foot');
for (const [name, from, to, bone] of [
  ['right_thigh',  [-6, 8, -3.5], [-2.5, 15, 3],   'right_leg'],
  ['right_shin_c', [-5.5, 2.6, -2], [-2.8, 8.4, 2],'right_shin'],
  ['right_foot_c', [-5.8, 0, -1.5], [-2.7, 3.2, 5],'right_foot'],
  ['right_toe',    [-5.6, 0, 5],    [-2.9, 1.6, 8],'right_toes'],
]) model.cube({ name, from, to, bone });
```

## Reference

`reference.md` lists every builder function and its options.
