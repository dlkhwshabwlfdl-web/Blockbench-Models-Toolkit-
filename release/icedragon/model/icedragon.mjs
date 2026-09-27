#!/usr/bin/env node
/**
 * Ice Dragon — the most detailed worked example in the toolkit.
 *
 * The colour idea is a single deliberate contrast: a **cold** hide (deep glacial teal, almost
 * slate) wrapped around a **burning** interior. The throat, the core crystal in the chest, the
 * eyes and the mouth are all the same hot magenta, so the dragon reads as a creature that is
 * cold outside and alive inside — and every magenta pixel is the same island, which is what
 * keeps a 48-colour texture looking deliberate.
 *
 * Run it:
 *   node examples/icedragon/icedragon.mjs --out ./out
 *   node dist/cli.js build examples/icedragon/icedragon.mjs --out ./out --bbmodel --preview --metrics
 */
import path from 'node:path';
import {
  Atlas,
  Model,
  bevelEdges,
  bands,
  breathe,
  clip,
  contactSheet,
  cycle,
  defaultMotionRig,
  deriveShade,
  eye as eyeBrush,
  formatCoincidence,
  formatMetrics,
  formatReport,
  geometricHygiene,
  grain,
  harmonize,
  headTurn,
  idleSway,
  islandRules,
  locomotion,
  metrics,
  pose,
  rgbToHex,
  skinFieldPolicy,
  softenSeams,
  tailWave,
  validate,
  writeBbmodel,
  writeBinary,
  writeJavaModel,
} from '../../dist/index.js';

/* ------------------------------------------------------------------ rig -- */

// Coordinate frame: model faces +Z, Y is up, the feet sit at y = 0, the model's left is +X.
// Pivots sit at the joints in the *folded* rest pose, so every animation is a rotation about
// a real joint rather than a correction afterwards.
const GROUPS = [
  ['root', [0, 0, 0], null],
  ['hips', [0, 14, -5], 'root'],
  ['spine', [0, 15, 1], 'hips'],
  ['chest', [0, 16, 7], 'spine'],
  ['core', [0, 16, 6], 'chest'],

  ['neck_01', [0, 18, 12], 'chest'],
  ['neck_02', [0, 20, 16], 'neck_01'],
  ['neck_03', [0, 22, 20], 'neck_02'],
  ['neck_04', [0, 23.5, 24], 'neck_03'],
  ['head', [0, 24, 27], 'neck_04'],
  ['jaw', [0, 21.5, 28], 'head'],
  ['eyes', [0, 25.5, 33], 'head'],

  // An antler-like crystal crown: two sweeping branches, each in two segments.
  ['horn_left_01', [2.8, 27, 28], 'head'],
  ['horn_left_02', [3.4, 30, 26], 'horn_left_01'],
  ['horn_right_01', [-2.8, 27, 28], 'head'],
  ['horn_right_02', [-3.4, 30, 26], 'horn_right_01'],
  // A second, shorter pair further back on the skull.
  ['horn_left_03', [2.6, 26, 24], 'head'],
  ['horn_right_03', [-2.6, 26, 24], 'head'],

  // Shoulder crystal clusters — the ice that has grown out of the animal.
  ['crystal_left_01', [5, 21, 5], 'chest'],
  ['crystal_left_02', [6.2, 25, 3], 'crystal_left_01'],
  ['crystal_right_01', [-5, 21, 5], 'chest'],
  ['crystal_right_02', [-6.2, 25, 3], 'crystal_right_01'],

  // Four-boned wing: humerus, forearm, hand, and a wrist the membrane hangs off.
  ['wing_left_01', [5, 19, 6], 'chest'],
  ['wing_left_02', [7, 25, 4], 'wing_left_01'],
  ['wing_left_03', [7.5, 19, -6], 'wing_left_02'],
  ['wing_left_04', [7, 16, -15], 'wing_left_03'],
  ['wing_right_01', [-5, 19, 6], 'chest'],
  ['wing_right_02', [-7, 25, 4], 'wing_right_01'],
  ['wing_right_03', [-7.5, 19, -6], 'wing_right_02'],
  ['wing_right_04', [-7, 16, -15], 'wing_right_03'],

  ['tail_01', [0, 15, -11], 'hips'],
  ['tail_02', [0, 14.5, -17], 'tail_01'],
  ['tail_03', [0, 14, -23], 'tail_02'],
  ['tail_04', [0, 13.5, -29], 'tail_03'],
  ['tail_05', [0, 13, -35], 'tail_04'],
  ['tail_06', [0, 12.5, -41], 'tail_05'],

  ['front_leg_left', [3.2, 14, 6], 'chest'],
  ['front_shin_left', [3.4, 7.5, 6.5], 'front_leg_left'],
  ['front_foot_left', [3.4, 2, 6], 'front_shin_left'],
  ['front_leg_right', [-3.2, 14, 6], 'chest'],
  ['front_shin_right', [-3.4, 7.5, 6.5], 'front_leg_left'],
  ['front_foot_right', [-3.4, 2, 6], 'front_shin_right'],
  ['hind_leg_left', [3.8, 14.5, -3], 'hips'],
  ['hind_shin_left', [4, 7.5, -4], 'hind_leg_left'],
  ['hind_foot_left', [4, 2, -4], 'hind_shin_left'],
  ['hind_leg_right', [-3.8, 14.5, -3], 'hips'],
  ['hind_shin_right', [-4, 7.5, -4], 'hind_leg_right'],
  ['hind_foot_right', [-4, 2, -4], 'hind_shin_right'],
];

const NECK = ['neck_01', 'neck_02', 'neck_03', 'neck_04'];
const TAIL = ['tail_01', 'tail_02', 'tail_03', 'tail_04', 'tail_05', 'tail_06'];
const WING_BONES = {
  left: ['wing_left_01', 'wing_left_02', 'wing_left_03', 'wing_left_04'],
  right: ['wing_right_01', 'wing_right_02', 'wing_right_03', 'wing_right_04'],
};

/* ---------------------------------------------------------------- cubes -- */

const CUBES = [];
const cube = (name, from, to, bone, transform) => CUBES.push({ name, from, to, bone, ...(transform ?? {}) });

/** Swap the `left` token wherever it appears, so `left_horn` and `wing_left_03` both flip. */
const flipSide = (name) => name.replace(/(^|_)left(_|$)/g, '$1right$2');

/**
 * Mirror a part across X = 0, including its rotation.
 *
 * Mirroring geometry across X flips the sense of a rotation about Y and Z and mirrors the
 * origin, while leaving a rotation about X alone. A wing is exactly the case that exposes
 * this: the left wing folds with a negative Y and the right with a positive one, so copying
 * the angles gives a wing that folds the wrong way.
 */
function mirrorX(spec) {
  const { name, from, to, bone, rotation, origin, ...rest } = spec;
  return {
    ...rest,
    name: flipSide(name),
    from: [-to[0], from[1], from[2]],
    to: [-from[0], to[1], to[2]],
    bone: flipSide(bone),
    ...(rotation ? { rotation: [rotation[0], -rotation[1], -rotation[2]] } : {}),
    ...(origin ? { origin: [-origin[0], origin[1], origin[2]] } : {}),
  };
}

/** Register a left-side part and its mirror in one call. */
const pair = (spec) => CUBES.push(spec, mirrorX(spec));

/* -- torso ---------------------------------------------------------------- */

cube('hip_block', [-5, 11, -13], [5, 20.5, -3], 'hips');
cube('spine_block', [-5.6, 10.5, -4], [5.6, 20.5, 5], 'spine');
cube('chest_block', [-6, 11, 4], [6, 22.5, 12.5], 'chest');
// The belly hangs below all three so the underside is a continuous surface, not three steps.
cube('belly', [-4.2, 9.5, -6], [4.2, 12, 8], 'spine');
// A chest plate that flares forward over the core.
cube('chest_plate', [-4.6, 13, 9], [4.6, 20, 13.5], 'chest', { rotation: [14, 0, 0], origin: [0, 16, 10] });

/* -- the core: the one warm thing in a cold animal ------------------------ */

// A cluster of glowing shards pushed through the chest plate. They interpenetrate the chest
// on purpose — the smoke test's joint check is the thing that keeps an embedded shard from
// floating a pixel off the surface. It is also the focal point the spine light points at.
cube('core_shard_main', [-2, 13.4, 11.2], [2, 20, 14.8], 'core');
pair({ name: 'left_core_shard', from: [1.6, 14.4, 11], to: [4.2, 18.6, 13.8], bone: 'core', rotation: [0, 0, 24], origin: [2.2, 16, 12.2] });
pair({ name: 'left_core_shard_low', from: [1.4, 12.6, 10.8], to: [3.4, 15.2, 13], bone: 'core', rotation: [0, 0, 32], origin: [2, 13.8, 11.8] });
pair({ name: 'left_core_shard_up', from: [1.5, 18.4, 11.4], to: [3, 21.6, 13.4], bone: 'core', rotation: [0, 0, 14], origin: [2, 19, 12.2] });
// A dark socket behind them, so the glow reads as light coming *out* of the chest.
cube('core_socket', [-4, 12.6, 10.2], [4, 20.2, 12.4], 'core');

/* -- dorsal ridge --------------------------------------------------------- */

// Swept back about their own rear edge, so the spine reads as a ridge and not a row of blocks.
[
  { name: 'ridge_hip', from: [-1.7, 20.5, -13], to: [1.7, 23.5, -8.5], bone: 'hips' },
  { name: 'ridge_spine', from: [-1.7, 20.5, -4], to: [1.7, 23.8, 1], bone: 'spine' },
  { name: 'ridge_chest', from: [-1.6, 22.5, 4], to: [1.6, 25.5, 9.5], bone: 'chest' },
].forEach((spec) =>
  cube(spec.name, spec.from, spec.to, spec.bone, {
    rotation: [-26, 0, 0],
    origin: [0, spec.from[1], spec.from[2] + 1],
  }),
);
// The ridge keeps a second, smaller row for depth.
[
  { name: 'ridge_hip_low', from: [-1.3, 20.2, -12], to: [1.3, 22, -9.5], bone: 'hips' },
  { name: 'ridge_spine_low', from: [-1.3, 20.2, -3], to: [1.3, 22.2, 0], bone: 'spine' },
].forEach((spec) =>
  cube(spec.name, spec.from, spec.to, spec.bone, {
    rotation: [-16, 0, 0],
    origin: [0, spec.from[1], spec.from[2] + 0.8],
  }),
);

/* -- neck ----------------------------------------------------------------- */

cube('neck_cube_01', [-3.9, 16, 11], [3.9, 22, 16.5], 'neck_01');
cube('neck_cube_02', [-3.3, 18, 15], [3.3, 23.5, 20.5], 'neck_02');
cube('neck_cube_03', [-2.7, 20, 19], [2.7, 25, 24.5], 'neck_03');
cube('neck_cube_04', [-2.1, 21.5, 23], [2.1, 26, 28], 'neck_04');
// Ridge plates running up the neck, getting smaller toward the head.
[
  { name: 'neck_ridge_01', from: [-1.1, 22, 12], to: [1.1, 24.2, 16.5], bone: 'neck_01' },
  { name: 'neck_ridge_02', from: [-1, 23.5, 16], to: [1, 25.5, 20.5], bone: 'neck_02' },
  { name: 'neck_ridge_03', from: [-0.85, 25, 20], to: [0.85, 26.8, 24.5], bone: 'neck_03' },
].forEach((spec) =>
  cube(spec.name, spec.from, spec.to, spec.bone, { rotation: [-24, 0, 0], origin: [0, spec.from[1], spec.from[2] + 1] }),
);
// Frill fins off the back of the neck — the ice equivalent of a lizard's crest.
pair({ name: 'left_neck_frill', from: [2.4, 21, 20], to: [4.6, 25.5, 24], bone: 'neck_03', rotation: [-18, -8, 12], origin: [2.6, 22, 20.5] });
pair({ name: 'left_neck_frill_low', from: [2.6, 19.5, 16.5], to: [4.4, 23, 20.5], bone: 'neck_02', rotation: [-16, -8, 10], origin: [2.8, 20.5, 17] });

/* -- head ----------------------------------------------------------------- */

cube('skull', [-3.6, 22, 27], [3.6, 27.5, 36], 'head');
// A brow that overhangs the eyes, pivoted at the back so the front drops.
cube('brow', [-3.4, 25, 30.5], [3.4, 27.6, 36.5], 'head', { rotation: [10, 0, 0], origin: [0, 25.5, 31] });
cube('snout', [-2.6, 22.5, 35], [2.6, 26.5, 42], 'head');
// The muzzle droops at the tip: pivoted at the back of the snout, which stays buried.
cube('nose_tip', [-2.2, 22.9, 40.5], [2.2, 26.1, 44.5], 'head', { rotation: [8, 0, 0], origin: [0, 24.5, 40.5] });
// Cheek plates, so the head is not one flat-sided box.
pair({ name: 'left_cheek_plate', from: [2.8, 23, 31.5], to: [4.2, 26.2, 35.5], bone: 'head', rotation: [0, -10, 0], origin: [3.6, 24.6, 31.5] });
pair({ name: 'left_cheek_frill', from: [2.6, 24.5, 28.5], to: [4.4, 27.5, 32], bone: 'head', rotation: [0, 14, 18], origin: [2.9, 25, 29] });

// The throat: a glowing throat-plate, the second warm surface on the animal and the one a
// camera reads first when the mouth opens.
cube('throat_glow', [-1.8, 21.6, 30], [1.8, 23.4, 41], 'head');
cube('lower_jaw', [-2.4, 20.4, 28], [2.4, 23, 39.5], 'jaw', { rotation: [3, 0, 0], origin: [0, 21.7, 39.5] });
cube('tongue', [-1.5, 22.2, 30], [1.5, 23.3, 37.5], 'jaw', { rotation: [3, 0, 0], origin: [0, 21.7, 39.5] });
pair({ name: 'left_tongue_frill', from: [1.4, 22.4, 33], to: [2.6, 23.6, 36], bone: 'jaw', rotation: [0, 0, -20], origin: [1.8, 22.8, 33.5] });

/* -- eyes: a socket, a sclera, and a glowing iris -------------------------- */

// The socket is deliberately *wider* than the eye so the dark ring around it reads as a rim
// rather than as a hole punched through the skull.
pair({ name: 'left_eye_socket', from: [2.7, 24, 32.4], to: [3.7, 26.4, 35.5], bone: 'eyes', rotation: [8, 0, 6], origin: [3.4, 25.2, 34] });
pair({ name: 'left_eye', from: [3.35, 24.5, 33], to: [3.95, 25.9, 34.9], bone: 'eyes', rotation: [8, 0, 6], origin: [3.65, 25.2, 34] });
pair({ name: 'left_nostril', from: [1.2, 24.6, 41.5], to: [2, 25.7, 43], bone: 'head' });
// A brow crystal over each eye, catching the light.
pair({ name: 'left_brow_crystal', from: [2.9, 26.2, 31.5], to: [3.9, 27.8, 35.5], bone: 'eyes', rotation: [-12, 0, 10], origin: [3.2, 26.4, 32] });

/* -- crystal crown: the antler pair --------------------------------------- */

pair({ name: 'left_horn', from: [2.4, 27, 29], to: [3.8, 30.5, 33.5], bone: 'horn_left_01', rotation: [-34, 0, -14], origin: [3, 27.6, 30] });
pair({ name: 'left_horn_tip', from: [2.2, 30, 28], to: [3.3, 32.4, 31.5], bone: 'horn_left_02', rotation: [-46, 0, -18], origin: [3, 30.6, 29.5] });
pair({ name: 'left_horn_branch', from: [2.8, 28.4, 30.5], to: [4.4, 31.4, 33], bone: 'horn_left_01', rotation: [-18, 0, 34], origin: [3.2, 28.6, 31] });
pair({ name: 'left_horn_rear', from: [2.4, 25.6, 25.5], to: [3.6, 28.6, 29.5], bone: 'horn_left_03', rotation: [-28, 0, -10], origin: [3, 26.2, 26.5] });
// A jaw tusk on each side, sweeping up past the chin.
pair({ name: 'left_jaw_spur', from: [2.2, 22, 35], to: [3.2, 27, 37.5], bone: 'jaw', rotation: [10, 0, 16], origin: [2.6, 22.6, 36] });

/* -- teeth ---------------------------------------------------------------- */

// Upper row along the snout, lower row below, with two long fangs at the front.
for (const side of [1, -1]) {
  const tag = side > 0 ? 'left' : 'right';
  [35.5, 38, 40.5].forEach((z, index) => {
    const x1 = side * 1.6;
    const x2 = side * 2.6;
    cube(`tooth_upper_${tag}_${index}`, [Math.min(x1, x2), 22, z - 0.65], [Math.max(x1, x2), 23.6, z + 0.65], 'head');
  });
  [36.5, 39].forEach((z, index) => {
    const x1 = side * 1.2;
    const x2 = side * 2;
    cube(`tooth_lower_${tag}_${index}`, [Math.min(x1, x2), 23, z - 0.55], [Math.max(x1, x2), 24.2, z + 0.55], 'jaw');
  });
}
cube('fang_upper_left', [1.5, 22, 33.2], [2.7, 26.4, 34.6], 'head', { rotation: [6, 0, 8], origin: [2, 22.4, 33.6] });
cube('fang_upper_right', [-2.7, 22, 33.2], [-1.5, 26.4, 34.6], 'head', { rotation: [6, 0, -8], origin: [-2, 22.4, 33.6] });

/* -- shoulder crystal clusters ------------------------------------------- */

pair({ name: 'left_crystal', from: [4.4, 21, 4], to: [6.6, 25, 7.5], bone: 'crystal_left_01', rotation: [-12, 0, 26], origin: [5, 21.6, 5.4] });
pair({ name: 'left_crystal_tip', from: [4.6, 24.6, 3.4], to: [6, 27.4, 6], bone: 'crystal_left_02', rotation: [-26, 0, 30], origin: [5.2, 24.8, 4.6] });
pair({ name: 'left_crystal_small', from: [4.2, 20, 6.5], to: [5.8, 22.6, 9], bone: 'crystal_left_01', rotation: [0, 0, 34], origin: [4.6, 20.6, 7.4] });

/* -- wings ---------------------------------------------------------------- */
//
// Modelled **already folded**, lying back along the body. That is the only arrangement that
// works: a creature at rest has its wings folded, so the rest pose has to be the folded one,
// and unfolding becomes a set of rotations about the joint pivots rather than a second model.

// 01 — the humerus: a short, tall peak above the shoulder. Deliberately narrow in X, because a
// folded wing that is wide at the shoulder reads as an arm held out.
pair({ name: 'left_wing_arm', from: [5.8, 18, 5], to: [8.6, 26, 10], bone: 'wing_left_01', rotation: [0, 0, 8], origin: [6, 18.5, 5.5] });
// 02 — the forearm: folded back and down along the flank, tipping backward about the elbow.
pair({ name: 'left_wing_forearm', from: [6, 15, -4], to: [8.8, 25.5, 5.5], bone: 'wing_left_02', rotation: [-22, 0, 4], origin: [6.7, 24.6, 4.4] });
// 03 — the hand, carrying on back and down past the wrist.
pair({ name: 'left_wing_hand', from: [6.2, 13.5, -13], to: [8.6, 22, -4], bone: 'wing_left_03', rotation: [-16, 0, 3], origin: [7.2, 19, -5] });
// 04 — the wrist, tucked along the hip toward the tail root.
pair({ name: 'left_wing_tip', from: [6.4, 12, -22], to: [8.4, 19.5, -13], bone: 'wing_left_04', rotation: [-12, 0, 2], origin: [7.2, 19, -5] });

// The membrane, in three panels so a large thin surface is not one flat plate. Thin in X, and
// the reason the fold reads as skin rather than as a second bone.
pair({ name: 'left_wing_membrane', from: [6.9, 15.5, -13], to: [7.7, 23.5, 1.5], bone: 'wing_left_02', rotation: [-16, 0, 3], origin: [6.7, 24.6, 4.4] });
pair({ name: 'left_wing_membrane_mid', from: [6.9, 14, -21], to: [7.6, 20, -10], bone: 'wing_left_03', rotation: [-14, 0, 2], origin: [7.2, 19, -5] });
pair({ name: 'left_wing_membrane_tip', from: [6.6, 12.5, -26], to: [7.4, 17, -18], bone: 'wing_left_04', rotation: [-10, 0, 1], origin: [7.2, 19, -5] });
// A shoulder cap where the wing root meets the chest, so the join is bridged rather than abrupt.
pair({ name: 'left_wing_shoulder', from: [5.2, 20, 4.5], to: [8.2, 23.6, 9.5], bone: 'wing_left_01', rotation: [0, 0, 9], origin: [5.4, 20.6, 5] });
// Ice along the leading edge of the wing.
pair({ name: 'left_wing_ice', from: [6.4, 22, -2], to: [7.4, 24.4, 4], bone: 'wing_left_02', rotation: [-20, 0, 4], origin: [6.7, 24.6, 4.4] });

/* -- legs ----------------------------------------------------------------- */

const LEGS = [
  { side: 'left', sign: 1, tag: 'front' },
  { side: 'right', sign: -1, tag: 'front' },
  { side: 'left', sign: 1, tag: 'hind' },
  { side: 'right', sign: -1, tag: 'hind' },
];

for (const leg of LEGS) {
  const { sign, tag, side } = leg;
  const bone = `${tag}_leg_${side}`;
  const shin = `${tag}_shin_${side}`;
  const foot = `${tag}_foot_${side}`;
  const z = tag === 'front' ? 6 : -3;
  const x = tag === 'front' ? 3.2 : 3.8;
  // Order the two X values by sign so a right-side box is never written back-to-front.
  const box = (x1, x2, y1, y2, z1, z2) => [
    [Math.min(sign * x1, sign * x2), y1, z1],
    [Math.max(sign * x1, sign * x2), y2, z2],
  ];

  const [tf, tt] = box(x - 1.6, x + 1.4, 5.5, 15, z - 3, z + 3);
  cube(`${bone}_thigh`, tf, tt, bone, { rotation: [10, 0, 0], origin: [sign * x, 13.5, z] });

  const [sf, st] = box(x - 1.2, x + 1.2, 2, 8.5, z - 2.6, z + 2.6);
  cube(`${shin}_cube`, sf, st, shin, { rotation: [-22, 0, 0], origin: [sign * (x + 0.2), 8, z + 2] });

  const [ff, ft] = box(x - 1.6, x + 1.6, 0, 3, z - 3.4, z + 4.4);
  cube(`${foot}_cube`, ff, ft, foot, { rotation: [14, 0, 0], origin: [sign * (x + 0.2), 2.4, z - 3] });
  // A hock that reads as a backward knee, so the leg is not one straight column.
  const [hf, ht] = box(x - 1, x + 1.4, 2.6, 5.4, z - 3.2, z - 1.4);
  cube(`${shin}_hock`, hf, ht, shin, { rotation: [18, 0, 0], origin: [sign * x, 4, z - 2.2] });
}

// Toe claws, lifted off the ground as they point forward. Two per foot plus an outer dewclaw.
for (const [tag, z, x] of [['front', 6, 3.2], ['hind', -3, 3.8]]) {
  const foot = `${tag}_foot`;
  pair({ name: `left_${tag}_claw`, from: [x - 0.6, 0, z + 3.6], to: [x + 0.9, 1.5, z + 5.6], bone: `${foot}_left`, rotation: [-16, 0, 0], origin: [x, 0, z + 3.6] });
  pair({ name: `left_${tag}_claw_outer`, from: [x + 1.2, 0, z + 3.2], to: [x + 2.5, 1.3, z + 5], bone: `${foot}_left`, rotation: [-18, 0, 0], origin: [x + 1.6, 0, z + 3.2] });
  pair({ name: `left_${tag}_dewclaw`, from: [x - 0.9, 1.2, z - 3.2], to: [x + 0.5, 2.4, z - 1.6], bone: `${foot}_left`, rotation: [22, 0, 0], origin: [x, 2, z - 2.4] });
}

/* -- tail ----------------------------------------------------------------- */

const TAIL_SEGMENTS = [
  [-3.8, 12, -17, 3.8, 18.5, -11.5],
  [-3.4, 12, -23, 3.4, 18, -17.5],
  [-2.9, 12, -29, 2.9, 17, -23.5],
  [-2.2, 12.2, -34.5, 2.2, 16, -29.5],
  [-1.5, 12.4, -39.5, 1.5, 14.6, -35],
  [-0.9, 12.6, -44, 0.9, 13.6, -40],
];
TAIL_SEGMENTS.forEach(([x1, y1, z1, x2, y2, z2], index) => {
  cube(`tail_cube_${index + 1}`, [x1, y1, z1], [x2, y2, z2], TAIL[index]);
});
// A ridge that flattens toward the tip.
TAIL_SEGMENTS.slice(0, 5).forEach(([x1, , z1, x2, , z2], index) => {
  cube(`tail_ridge_${index + 1}`, [x1 * 0.3, 18 - index * 0.7, z1], [x2 * 0.3, 20.4 - index * 0.7, z2], TAIL[index], {
    rotation: [-22 + index * 2, 0, 0],
    origin: [0, 18 - index * 0.7, z1 + 1],
  });
});

/* -- the cold light: what makes the colour idea readable -------------------- */
//
// A glowing core alone is a few dozen pixels in a 256px frame — measured, the warm colour
// came out at 0.1% of the render, so the "burning inside" idea did not survive contact with
// the rasteriser. What fixes it is a **line** of light along the whole spine, because a line
// traces the body from neck to tail tip and reads at any size. The core stays as the focal
// point; the spine light is what carries the idea.

const spineLight = (name, x, y, z1, z2, bone) => cube(name, [-x, y, z1], [x, y + 0.9, z2], bone);
// Down the back, narrowing as the body narrows.
spineLight('glow_ridge_hip', 0.75, 22.6, -12.4, -8.8, 'hips');
spineLight('glow_ridge_spine', 0.75, 22.8, -3.6, 0.6, 'spine');
spineLight('glow_ridge_chest', 0.7, 24.6, 4.2, 9.2, 'chest');
// Up the neck.
spineLight('glow_neck_01', 0.5, 23.5, 12.2, 16.2, 'neck_01');
spineLight('glow_neck_02', 0.45, 25, 16.2, 20.2, 'neck_02');
spineLight('glow_neck_03', 0.38, 26.4, 20.2, 24.2, 'neck_03');
spineLight('glow_neck_04', 0.3, 27.4, 23.6, 27, 'neck_04');
// Down the tail, each one smaller and dimmer than the last.
spineLight('glow_tail_01', 0.5, 19.8, -16.6, -11.8, 'tail_01');
spineLight('glow_tail_02', 0.44, 19.2, -22.6, -17.8, 'tail_02');
spineLight('glow_tail_03', 0.36, 18.4, -28.6, -23.8, 'tail_03');
spineLight('glow_tail_04', 0.28, 17.6, -34.2, -29.8, 'tail_04');
spineLight('glow_tail_05', 0.2, 16.6, -39.2, -35.2, 'tail_05');

// Light in the wing struts: the frame of a wing is a skeleton, and a lit skeleton reads as
// translucent membrane instead of a flat plate.
pair({ name: 'left_wing_strut_upper', from: [6.2, 17.5, 4.5], to: [6.9, 25.4, 9.5], bone: 'wing_left_01', rotation: [0, 0, 8], origin: [6, 18.5, 5.5] });
pair({ name: 'left_wing_strut_mid', from: [6.3, 14.6, -3.5], to: [7, 25, 5], bone: 'wing_left_02', rotation: [-22, 0, 4], origin: [6.7, 24.6, 4.4] });
pair({ name: 'left_wing_strut_low', from: [6.4, 13, -12.5], to: [7, 21.5, -4.5], bone: 'wing_left_03', rotation: [-16, 0, 3], origin: [7.2, 19, -5] });
// The spade: a fan of ice blades rather than one block, so the tail tip has a silhouette.
cube('tail_spade_core', [-2.8, 15, -43], [2.8, 18.6, -48], 'tail_06');
cube('tail_spade_blade_left', [1.6, 14.6, -44], [3.2, 17.4, -50], 'tail_06', { rotation: [0, 0, 14], origin: [2.2, 16, 45] });
cube('tail_spade_blade_right', [-3.2, 14.6, -44], [-1.6, 17.4, -50], 'tail_06', { rotation: [0, 0, -14], origin: [-2.2, 16, 45] });
cube('tail_spade_tip', [-1.2, 14.2, -48], [1.2, 16.6, -53], 'tail_06', { rotation: [10, 0, 0], origin: [0, 16, 48] });
// The tip is the brightest point on the animal: the spine light runs out here.
cube('tail_spade_glow', [-0.9, 15.2, -47.5], [0.9, 16.8, -52], 'tail_06');
cube('tail_spade_glow_left', [1.1, 15.6, -44.5], [2.2, 16.8, -48.5], 'tail_06');
cube('tail_spade_glow_right', [-2.2, 15.6, -44.5], [-1.1, 16.8, -48.5], 'tail_06');

/* -- bevels --------------------------------------------------------------- */
//
// A dragon reads as a soft-bodied animal, so every hard corner on the torso is chamfered.
// Each bevel shares its end planes with its parent, which is exactly the coincidence case —
// `geometricHygiene` pulls the duplicates out below.

for (const spec of [
  ...bevelEdges({ name: 'chest', from: [-6, 11, 4], to: [6, 22.5, 12.5], bone: 'chest', edges: ['top-left', 'top-right'], chamfer: 3, inset: 0.45 }),
  ...bevelEdges({ name: 'hip', from: [-5, 11, -13], to: [5, 20.5, -3], bone: 'hips', edges: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], chamfer: 2.6, inset: 0.42 }),
  ...bevelEdges({ name: 'spine', from: [-5.6, 10.5, -4], to: [5.6, 20.5, 5], bone: 'spine', edges: ['top-left', 'top-right'], chamfer: 2.8, inset: 0.45 }),
  ...bevelEdges({ name: 'belly', from: [-4.2, 9.5, -6], to: [4.2, 12, 8], bone: 'spine', edges: ['bottom-left', 'bottom-right'], chamfer: 2, inset: 0.35 }),
  ...bevelEdges({ name: 'skull', from: [-3.6, 22, 27], to: [3.6, 27.5, 36], bone: 'head', edges: ['top-left', 'top-right'], chamfer: 1.6, inset: 0.3 }),
]) {
  cube(spec.name, spec.from, spec.to, spec.bone, {
    ...(spec.rotation ? { rotation: spec.rotation } : {}),
    ...(spec.origin ? { origin: spec.origin } : {}),
  });
}

/* --------------------------------------------------------------- texture -- */

const hexRgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

// One cold pigment for the whole animal, harmonised into its four depths, plus one warm
// pigment reserved for everything that glows. Keeping the warm set to a single island is what
// makes a 40+ colour texture still read as a deliberate palette.
const HIDE = hexRgb('#1d5c6e');
const [SCALE, BELLY, MEMBRANE, RIDGE] = harmonize(
  [
    HIDE,
    deriveShade(HIDE, { lightness: 0.18, saturation: 0.78 }),
    deriveShade(HIDE, { lightness: -0.22, saturation: 1.3, hueShift: 26 }),
    deriveShade(HIDE, { lightness: 0.34, saturation: 0.42 }),
  ],
  { strength: 0.3 },
);
// The one warm colour. Everything bioluminescent samples this.
const GLOW = [255, 66, 158];

const PALETTE = {
  // Everything that emits: the chest core, the throat, the iris, the mouth.
  glow: [0, 0, 6, 6],
  glow_deep: [6, 0, 12, 6],
  socket: [12, 0, 16, 4],
  // The cold set.
  crystal: [0, 6, 6, 12],
  tooth: [6, 6, 10, 12],
  claw: [10, 6, 14, 12],
  membrane: [0, 12, 8, 20],
  belly: [8, 12, 16, 20],
  ridge: [0, 20, 8, 28],
  rime: [8, 20, 16, 28],
};

const ISLAND_COLOR = {
  glow: rgbToHex(GLOW),
  glow_deep: rgbToHex(deriveShade(GLOW, { lightness: -0.28, saturation: 1.15 })),
  socket: '#12202c',
  crystal: rgbToHex(RIDGE),
  tooth: '#e8f4f8',
  claw: '#9fc4d4',
  membrane: rgbToHex(MEMBRANE),
  belly: rgbToHex(BELLY),
  ridge: rgbToHex(RIDGE),
  rime: '#cfe9f2',
};

const ISLAND_CONTRAST = {
  glow: 0.3,
  glow_deep: 0.28,
  socket: 0.26,
  crystal: 0.34,
  membrane: 0.28,
  belly: 0.2,
  ridge: 0.36,
  rime: 0.22,
};

function buildAtlas() {
  const atlas = new Atlas(64, 64);
  // The skin field: everything not claimed by an island below falls here.
  atlas.define('scale', [16, 0, 64, 64]);
  // Eight vertical bands — a face window is small, so it usually crosses one boundary and
  // carries the base plus one shade.
  bands(atlas.canvas, atlas.get('scale'), SCALE, { steps: 8, contrast: 0.5, axis: 'vertical' });

  for (const [name, rect] of Object.entries(PALETTE)) {
    atlas.define(name, rect);
    bands(atlas.canvas, rect, hexRgb(ISLAND_COLOR[name]), {
      steps: name === 'glow' || name === 'glow_deep' ? 3 : 4,
      contrast: ISLAND_CONTRAST[name] ?? 0.3,
      axis: 'vertical',
    });
  }

  // The membrane is a large thin surface, so it gets mottling rather than one flat colour.
  grain(atlas.canvas, atlas.get('membrane'), hexRgb(ISLAND_COLOR.membrane), { amount: 0.07, scale: 3, seed: 11 });
  grain(atlas.canvas, atlas.get('scale'), SCALE, { amount: 0.05, scale: 1.4, seed: 3 });
  // The eye brush is worth using over hand-placed pixels because it keeps the pupil centred on
  // a rect of any size, which is what makes one eye readable at 4×4.
  eyeBrush(atlas.canvas, atlas.get('glow'), {
    sclera: [255, 176, 214],
    iris: [255, 66, 158],
    pupil: [26, 10, 22],
    brow: [18, 32, 44],
  });
  return atlas;
}

/* ------------------------------------------------------------ animations -- */

const rig = {
  ...defaultMotionRig(6),
  body: 'spine',
  chest: 'chest',
  head: 'head',
  neck: NECK,
  tail: TAIL,
  legs: [
    // A diagonal gait: front-left and hind-right move together.
    { leg: 'front_leg_left', shin: 'front_shin_left', foot: 'front_foot_left', phase: 0 },
    { leg: 'front_leg_right', shin: 'front_shin_right', foot: 'front_foot_right', phase: 0.5 },
    { leg: 'hind_leg_right', shin: 'hind_shin_right', foot: 'hind_foot_right', phase: 0 },
    { leg: 'hind_leg_left', shin: 'hind_shin_left', foot: 'hind_foot_left', phase: 0.5 },
  ],
  // `arms` is the only limb-pair slot the motion rig offers, so the wings go there.
  arms: [
    { arm: 'wing_left_01', lower: 'wing_left_02', phase: 0 },
    { arm: 'wing_right_01', lower: 'wing_right_02', phase: 0 },
  ],
};

/** Fully extended: the shoulder lifts, then the forearm, hand and wrist straighten outward. */
const WING_SPREAD = {
  wing_left_01: [0, 0, 28],
  wing_left_02: [0, -56, 4],
  wing_left_03: [0, -32, 0],
  wing_left_04: [0, -16, 0],
  wing_right_01: [0, 0, -28],
  wing_right_02: [0, 56, -4],
  wing_right_03: [0, 32, 0],
  wing_right_04: [0, 16, 0],
};

/** Half-folded: the wing is up and out but still bent — gliding and perching. */
const WING_HALF = {
  wing_left_01: [0, 0, 15],
  wing_left_02: [0, -26, 2],
  wing_left_03: [0, -15, 0],
  wing_left_04: [0, -7, 0],
  wing_right_01: [0, 0, -15],
  wing_right_02: [0, 26, -2],
  wing_right_03: [0, 15, 0],
  wing_right_04: [0, 7, 0],
};

const FOLDED = Object.fromEntries(
  [...WING_BONES.left, ...WING_BONES.right].map((bone) => [bone, [0, 0, 0]]),
);

const NEUTRAL = {
  spine: [0, 0, 0],
  chest: [0, 0, 0],
  hips: [0, 0, 0],
  head: [0, 0, 0],
  jaw: [0, 0, 0],
  ...FOLDED,
};
const neckPose = (x, y = 0) => ({
  neck_01: [x, y, 0],
  neck_02: [x * 0.7, y * 0.7, 0],
  neck_03: [x * 0.5, y * 0.5, 0],
  neck_04: [x * 0.35, y * 0.35, 0],
});
const oneShot = (name, length, entries, options = {}) =>
  clip({ name, loop: 'once', length, keys: pose(entries.map((entry) => ({ ...entry, ...options }))) });

/**
 * A wing beat.
 *
 * There is no generator for this: `MotionRig` has body/chest/head/neck/tail/legs/arms and
 * nothing else, so a wing is authored by hand. The beat is asymmetric on purpose — the
 * downstroke is fast and the recovery slow, which is what makes a wing read as pushing
 * against air instead of waving.
 */
function wingBeat({ length, samples = 8, lift = 34, drop = -20, tipLag = 0.06 }) {
  const keys = [];
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? 1 : -1;
    const [shoulder, forearm, hand, wrist] = WING_BONES[side];
    const flap = (t, lag) => {
      const phase = (t - lag + 1) % 1;
      // 0..0.35 upstroke, 0.35..0.6 snap down, then a slow settle.
      const liftPhase = phase < 0.35 ? phase / 0.35 : phase < 0.6 ? 1 - (phase - 0.35) / 0.25 : 0;
      return drop + (lift - drop) * liftPhase;
    };
    keys.push(...cycle(shoulder, 'rotation', length, samples, (t) => [0, 0, sign * (18 + flap(t, 0))]));
    keys.push(...cycle(forearm, 'rotation', length, samples, (t) => [0, -sign * 48, sign * (4 + flap(t, tipLag) * 0.4)]));
    keys.push(...cycle(hand, 'rotation', length, samples, (t) => [0, -sign * 28, sign * flap(t, tipLag * 2) * 0.5]));
    keys.push(...cycle(wrist, 'rotation', length, samples, (t) => [0, -sign * 14, sign * flap(t, tipLag * 3) * 0.3]));
  }
  return keys;
}

/** The core brightens and the whole animal shudders — the signature of a charged dragon. */
function corePulse({ length, samples = 12, amount = 1 }) {
  const keys = [];
  for (let i = 0; i < samples; i += 1) {
    const t = i / samples;
    // Two beats per cycle, sharpened at the peak, so it pulses rather than breathes.
    const beat = Math.pow(Math.max(0, Math.sin(Math.PI * 2 * t)), 3);
    const scale = 1 + beat * 0.16 * amount;
    keys.push({ bone: 'core', channel: 'scale', time: t * length, value: [scale, scale, scale], interpolation: 'catmullrom' });
    keys.push({ bone: 'core', channel: 'rotation', time: t * length, value: [beat * 6 * amount, 0, 0], interpolation: 'catmullrom' });
    keys.push({ bone: 'chest', channel: 'rotation', time: t * length, value: [beat * -1.6 * amount, 0, 0], interpolation: 'catmullrom' });
  }
  return keys;
}

/**
 * Secondary motion for the crown and the shoulder crystal.
 *
 * Horns and crystal are rigidly parented to the skull and chest, so they already travel with
 * the head — which is correct, and is also why they read as *stiff*. A few degrees of
 * phase-lagged shiver, biggest on the horn tips and decaying down the shoulder cluster, is
 * what stops them looking welded on during a roar.
 *
 * `lag` shifts the whole set back in the cycle, so it never lands in step with the head.
 */
function crownShiver({ length, samples = 8, amount = 1, lag = 0.04 } = {}) {
  const CROWN = [
    { bone: 'horn_left_01', share: 0.5, sign: 1 },
    { bone: 'horn_left_02', share: 1, sign: 1 },
    { bone: 'horn_left_03', share: 0.6, sign: 1 },
    { bone: 'horn_right_01', share: 0.5, sign: -1 },
    { bone: 'horn_right_02', share: 1, sign: -1 },
    { bone: 'horn_right_03', share: 0.6, sign: -1 },
    { bone: 'crystal_left_01', share: 0.7, sign: 1 },
    { bone: 'crystal_left_02', share: 1, sign: 1 },
    { bone: 'crystal_right_01', share: 0.7, sign: -1 },
    { bone: 'crystal_right_02', share: 1, sign: -1 },
  ];
  const keys = [];
  for (const part of CROWN) {
    // Two partial cycles per loop, so the shiver is not one long lazy swing.
    keys.push(
      ...cycle(part.bone, 'rotation', length, samples, (t) => {
        const phase = (t - lag * part.share + 1) % 1;
        return [
          Math.sin(phase * Math.PI * 4) * 1.6 * part.share * amount,
          0,
          Math.cos(phase * Math.PI * 4) * 2.2 * part.share * amount * part.sign,
        ];
      }),
    );
  }
  return keys;
}

function buildClips() {
  const clips = [];

  /* -- idle, breathing and locomotion -------------------------------------- */
  clips.push(
    clip({
      name: 'idle',
      length: 4,
      // A barely-there crown shiver, enough that the ice is not visibly welded to the skull.
      keys: [...idleSway({ rig, length: 4, samples: 10, sway: 2, sink: 0.5, headScan: 6 }), ...crownShiver({ length: 4, samples: 10, amount: 0.55, lag: 0.06 })],
    }),
  );
  clips.push(clip({ name: 'breathe', length: 3.4, keys: breathe({ rig, length: 3.4, samples: 10, amount: 0.05, sink: 0.6 }) }));
  clips.push(clip({ name: 'core_idle', length: 3.4, keys: corePulse({ length: 3.4, samples: 14, amount: 1 }) }));
  clips.push(clip({ name: 'tail_sway', length: 3.2, keys: tailWave({ rig, length: 3.2, samples: 10, sway: 7, growth: 3, lag: 0.1 }) }));
  clips.push(clip({ name: 'walk', length: 1.6, keys: locomotion({ rig, length: 1.6, stride: 20, knee: 26, bob: 0.5, lean: 1, tailLift: 1.5, armSwing: 2, headDrop: -1, samples: 10 }) }));
  clips.push(
    clip({
      name: 'run',
      length: 0.9,
      keys: [
        ...locomotion({ rig, length: 0.9, stride: 32, knee: 44, bob: 1.1, lean: 5, tailLift: 4, armSwing: 4, headDrop: -2, samples: 10 }),
        ...crownShiver({ length: 0.9, samples: 12, amount: 2.2, lag: 0.05 }),
      ],
    }),
  );
  clips.push(clip({ name: 'prowl', length: 2.6, keys: locomotion({ rig, length: 2.6, stride: 13, knee: 18, bob: 0.3, lean: -2, tailLift: 0.5, armSwing: 1, headDrop: 2, samples: 12 }) }));

  // Turning the head is neck work, and `idleSway` does not drive the neck — so every neck
  // bone needs a key at each end of the clip, or the channel holds one value and the head
  // never comes back.
  const glance = (name, length, direction) =>
    clip({
      name,
      length,
      keys: [
        ...idleSway({ rig, length, samples: 6, sway: 0.5, sink: 0.2, headScan: 0 }),
        ...pose([
          { time: 0, rotations: { ...neckPose(0), head: [0, 0, 0] } },
          { time: length * 0.5, rotations: { ...neckPose(2, 30 * direction), head: [-2, 22 * direction, 6 * direction] } },
          { time: length, rotations: { ...neckPose(0), head: [0, 0, 0] } },
        ]),
      ],
    });
  clips.push(glance('look_left', 1.1, 1));
  clips.push(glance('look_right', 1.1, -1));

  /* -- wings ---------------------------------------------------------------- */
  clips.push(oneShot('wing_unfurl', 1.2, [
    { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
    { time: 0.25, rotations: { ...WING_HALF } },
    { time: 0.55, rotations: { ...WING_SPREAD, spine: [-4, 0, 0] } },
    { time: 1.2, rotations: { ...WING_SPREAD, spine: [-2, 0, 0] } },
  ]));
  clips.push(oneShot('wing_fold', 1.1, [
    { time: 0, rotations: { ...WING_SPREAD } },
    { time: 0.4, rotations: { ...WING_HALF } },
    { time: 1.1, rotations: { ...NEUTRAL }, interpolation: 'linear' },
  ]));
  clips.push(clip({ name: 'flap', length: 1, keys: wingBeat({ length: 1, samples: 12, lift: 40, drop: -24 }) }));
  clips.push(clip({
    name: 'glide',
    length: 4,
    keys: [
      ...wingBeat({ length: 4, samples: 10, lift: 8, drop: -2, tipLag: 0.1 }),
      // Every channel named here needs a key at each end, or it holds one value for the clip.
      ...pose([
        { time: 0, rotations: { ...WING_HALF, wing_left_01: [0, 0, 16], wing_right_01: [0, 0, -16], spine: [0, 0, 0] } },
        { time: 2, rotations: { ...WING_HALF, wing_left_01: [0, 0, 12], wing_right_01: [0, 0, -12], spine: [2, 0, 0] } },
        { time: 4, rotations: { ...WING_HALF, wing_left_01: [0, 0, 16], wing_right_01: [0, 0, -16], spine: [0, 0, 0] } },
      ]),
      ...tailWave({ rig, length: 4, samples: 10, sway: 4, growth: 2.4, lag: 0.12, frequency: 0.5 }),
    ],
  }));

  clips.push(oneShot('takeoff', 2.2, [
    { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
    { time: 0.3, rotations: { ...NEUTRAL, spine: [8, 0, 0], front_leg_left: [24, 0, 0], front_leg_right: [24, 0, 0], hind_leg_left: [22, 0, 0], hind_leg_right: [22, 0, 0], front_shin_left: [34, 0, 0], front_shin_right: [34, 0, 0], hind_shin_left: [32, 0, 0], hind_shin_right: [32, 0, 0] }, positions: { spine: [0, -2.4, 0] }, interpolation: 'linear' },
    { time: 0.75, rotations: { ...WING_SPREAD, spine: [-12, 0, 0] }, positions: { spine: [0, 1.2, 0] } },
    { time: 1.15, rotations: { ...WING_SPREAD, wing_left_01: [0, 0, -6], wing_left_02: [0, -56, 4], wing_left_03: [0, -32, 0], wing_left_04: [0, -16, 0], wing_right_01: [0, 0, 6], wing_right_02: [0, 56, -4], wing_right_03: [0, 32, 0], wing_right_04: [0, 16, 0], spine: [-18, 0, 0], hind_leg_left: [-26, 0, 0], hind_leg_right: [-26, 0, 0] }, positions: { spine: [0, 5.5, 0] } },
    { time: 1.5, rotations: { ...WING_SPREAD, wing_left_01: [0, 0, 34], wing_right_01: [0, 0, -34], spine: [-14, 0, 0], hind_leg_left: [-18, 0, 0], hind_leg_right: [-18, 0, 0] }, positions: { spine: [0, 8, 0] } },
    { time: 2.2, rotations: { ...WING_SPREAD, spine: [-10, 0, 0] }, positions: { spine: [0, 9, 0] } },
  ]));
  clips.push(oneShot('land', 1.5, [
    { time: 0, rotations: { ...WING_SPREAD }, positions: { spine: [0, 6, 0] } },
    { time: 0.45, rotations: { ...WING_SPREAD, wing_left_01: [0, 0, -14], wing_right_01: [0, 0, 14], spine: [6, 0, 0], front_leg_left: [40, 0, 0], front_leg_right: [40, 0, 0], hind_leg_left: [36, 0, 0], hind_leg_right: [36, 0, 0] }, positions: { spine: [0, -1, 0] } },
    { time: 0.8, rotations: { ...WING_HALF, spine: [9, 0, 0], front_shin_left: [30, 0, 0], front_shin_right: [30, 0, 0], hind_shin_left: [28, 0, 0], hind_shin_right: [28, 0, 0] }, positions: { spine: [0, -2.2, 0] } },
    { time: 1.5, rotations: { ...NEUTRAL }, positions: { spine: [0, 0, 0] }, interpolation: 'linear' },
  ]));

  /* -- combat and states ---------------------------------------------------- */
  // A one-shot clip built by `pose` can only hold the values it names, so the crown is mixed
  // in as its own looping channel rather than as extra pose entries.
  const roar = (name, length, entries) =>
    clip({ name, loop: 'once', length, keys: [...pose(entries), ...crownShiver({ length, samples: 14, amount: 2.6, lag: 0.05 })] });
  clips.push(roar('roar', 1.9, [
    { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
    { time: 0.35, rotations: { ...neckPose(14), jaw: [8, 0, 0], spine: [-3, 0, 0], ...WING_HALF }, positions: { spine: [0, -0.6, 0] } },
    { time: 0.7, rotations: { ...neckPose(-16), jaw: [46, 0, 0], spine: [-8, 0, 0], head: [-6, 0, 0], ...WING_SPREAD }, positions: { spine: [0, 1.4, -0.6] } },
    { time: 1.3, rotations: { ...neckPose(-18), jaw: [44, 0, 0], spine: [-8, 0, 0], ...WING_SPREAD } },
    { time: 1.55, rotations: { ...neckPose(-6), jaw: [12, 0, 0], spine: [-3, 0, 0], ...WING_HALF }, positions: { spine: [0, 0.4, 0] } },
    { time: 1.9, rotations: { ...NEUTRAL }, positions: { spine: [0, 0, 0] }, interpolation: 'linear' },
  ]));

  // The signature clip: the core overloads, then the dragon breathes out cold.
  clips.push(clip({
    name: 'frost_breath',
    length: 2.4,
    keys: [
      ...corePulse({ length: 2.4, samples: 16, amount: 2.6 }),
      // The crown rings hardest at the peak of the blast.
      ...crownShiver({ length: 2.4, samples: 18, amount: 3.4, lag: 0.03 }),
      ...pose([
        { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
        { time: 0.8, rotations: { ...neckPose(-20), jaw: [40, 0, 0], spine: [-6, 0, 0], core: [0, 0, 0] } },
        { time: 1.5, rotations: { ...neckPose(-26), jaw: [48, 0, 0], spine: [-10, 0, 0], head: [-8, 0, 0], ...WING_HALF }, positions: { spine: [0, 1, -1] } },
        { time: 2.4, rotations: { ...NEUTRAL }, positions: { spine: [0, 0, 0] }, interpolation: 'linear' },
      ]),
    ],
  }));
  clips.push(roar('bite', 0.6, [
    { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
    { time: 0.14, rotations: { ...neckPose(10), jaw: [12, 0, 0] } },
    { time: 0.24, rotations: { ...neckPose(6), jaw: [40, 0, 0] } },
    { time: 0.34, rotations: { ...neckPose(-14), jaw: [-2, 0, 0], spine: [4, 0, 0] } },
    { time: 0.6, rotations: { ...NEUTRAL }, interpolation: 'linear' },
  ]));
  clips.push(oneShot('claw_swipe', 0.9, [
    { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
    { time: 0.2, rotations: { ...NEUTRAL, spine: [0, 14, 0], chest: [0, 10, 0], front_leg_left: [-34, 0, -18] }, positions: { spine: [0, 0.6, -0.6] } },
    { time: 0.4, rotations: { ...NEUTRAL, spine: [0, -18, 0], chest: [0, -12, 0], front_leg_left: [42, 0, 24], front_shin_left: [-30, 0, 0], head: [0, -14, 0] }, positions: { spine: [0, 0.2, 1.4] }, interpolation: 'linear' },
    { time: 0.9, rotations: { ...NEUTRAL }, positions: { spine: [0, 0, 0] }, interpolation: 'linear' },
  ]));
  clips.push(oneShot('tail_whip', 0.9, [
    { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
    { time: 0.25, rotations: Object.fromEntries(TAIL.map((bone, i) => [bone, [0, 18 - i * 1.6, 0]])) },
    { time: 0.5, rotations: { ...Object.fromEntries(TAIL.map((bone, i) => [bone, [0, -34 + i * 3, 0]])), spine: [0, -10, 0], head: [0, -10, 0] }, interpolation: 'linear' },
    { time: 0.9, rotations: { ...NEUTRAL }, interpolation: 'linear' },
  ]));
  clips.push(oneShot('hurt', 0.55, [
    { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
    { time: 0.08, rotations: { ...NEUTRAL, spine: [-14, 7, 0], ...neckPose(16, 10), head: [10, 8, 0], jaw: [20, 0, 0], wing_left_01: [0, 0, 20], wing_right_01: [0, 0, -20], core: [0, 0, 0] }, positions: { spine: [0, 0.4, -1.6] }, interpolation: 'linear' },
    { time: 0.24, rotations: { ...NEUTRAL, spine: [7, -3, 0], ...neckPose(-6, -3), jaw: [5, 0, 0], core: [0, 0, 0] }, positions: { spine: [0, -0.2, 0.6] } },
    { time: 0.55, rotations: { ...NEUTRAL }, positions: { spine: [0, 0, 0] }, interpolation: 'linear' },
  ]));
  clips.push(clip({
    name: 'sleep',
    length: 6,
    keys: [
      ...pose([
        { time: 0, rotations: { ...NEUTRAL, ...WING_HALF, spine: [6, 0, 0], ...neckPose(8) }, positions: { spine: [0, -1.6, 0] } },
        { time: 3, rotations: { ...NEUTRAL, ...WING_HALF, spine: [8, 0, 0], ...neckPose(10), head: [6, 0, 0] }, positions: { spine: [0, -2.1, 0] } },
        { time: 6, rotations: { ...NEUTRAL, ...WING_HALF, spine: [6, 0, 0], ...neckPose(8) }, positions: { spine: [0, -1.6, 0] } },
      ]),
      ...tailWave({ rig, length: 6, samples: 8, sway: 2.5, growth: 1.6, lag: 0.16, frequency: 0.34 }),
    ],
  }));
  // The core dims to a slow ember while the dragon sleeps.
  clips.push(clip({
    name: 'sleep_core',
    length: 6,
    keys: corePulse({ length: 6, samples: 12, amount: 0.22 }),
  }));

  return clips;
}

/* ----------------------------------------------------------------- build -- */

export function buildIceDragon(options = {}) {
  const atlas = buildAtlas();
  const model = new Model({
    name: 'icedragon',
    resolution: [64, 64],
    identifier: 'geometry.icedragon',
    uvPolicy: {
      rules: islandRules(atlas, [
        // The iris only on the outward face of the eye cube, and `exact` rather than `prefix`
        // so the surrounding socket cube (which also starts with `left_eye`) does not claim it.
        { island: 'glow', exact: 'left_eye', face: 'east' },
        { island: 'glow', exact: 'right_eye', face: 'west' },
        { island: 'socket', prefix: 'left_eye' },
        { island: 'socket', prefix: 'right_eye' },

        // Everything that emits light samples the two warm islands.
        { island: 'glow', prefix: 'glow_ridge' },
        { island: 'glow', prefix: 'glow_neck' },
        { island: 'glow', prefix: 'glow_tail' },
        { island: 'glow', prefix: 'left_wing_strut' },
        { island: 'glow', prefix: 'right_wing_strut' },
        { island: 'glow', prefix: 'core_shard' },
        { island: 'glow', prefix: 'left_core_shard' },
        { island: 'glow', prefix: 'right_core_shard' },
        { island: 'glow', prefix: 'tail_spade_glow' },
        { island: 'glow_deep', prefix: 'core_socket' },
        { island: 'glow', exact: 'throat_glow' },
        { island: 'glow', exact: 'tongue' },

        // The cold set.
        { island: 'crystal', prefix: 'left_horn' },
        { island: 'crystal', prefix: 'right_horn' },
        { island: 'crystal', prefix: 'left_jaw_spur' },
        { island: 'crystal', prefix: 'right_jaw_spur' },
        { island: 'crystal', prefix: 'left_crystal' },
        { island: 'crystal', prefix: 'right_crystal' },
        { island: 'crystal', prefix: 'left_brow_crystal' },
        { island: 'crystal', prefix: 'right_brow_crystal' },
        { island: 'crystal', prefix: 'left_neck_frill' },
        { island: 'crystal', prefix: 'right_neck_frill' },
        { island: 'crystal', prefix: 'left_cheek_frill' },
        { island: 'crystal', prefix: 'right_cheek_frill' },
        { island: 'crystal', prefix: 'tail_spade' },
        { island: 'rime', prefix: 'left_wing_ice' },
        { island: 'rime', prefix: 'right_wing_ice' },
        { island: 'tooth', prefix: 'tooth' },
        { island: 'tooth', prefix: 'fang' },
        { island: 'claw', prefix: 'left_front_claw' },
        { island: 'claw', prefix: 'right_front_claw' },
        { island: 'claw', prefix: 'left_hind_claw' },
        { island: 'claw', prefix: 'right_hind_claw' },
        { island: 'claw', prefix: 'left_front_dewclaw' },
        { island: 'claw', prefix: 'right_front_dewclaw' },
        { island: 'claw', prefix: 'left_hind_dewclaw' },
        { island: 'claw', prefix: 'right_hind_dewclaw' },
        { island: 'membrane', prefix: 'left_wing_membrane' },
        { island: 'membrane', prefix: 'right_wing_membrane' },
        { island: 'ridge', prefix: 'ridge' },
        { island: 'ridge', prefix: 'neck_ridge' },
        { island: 'ridge', prefix: 'tail_ridge' },
        { island: 'belly', prefix: 'belly' },
        { island: 'belly', exact: 'neck_cube_01', face: 'down' },
        { island: 'belly', exact: 'neck_cube_02', face: 'down' },
        { island: 'belly', exact: 'neck_cube_03', face: 'down' },
        { island: 'belly', exact: 'chest_block', face: 'down' },
        { island: 'belly', exact: 'hip_block', face: 'down' },
        { island: 'belly', exact: 'chest_plate', face: 'down' },
        { island: 'belly', exact: 'lower_jaw', face: 'down' },
        { island: 'belly', prefix: 'left_wing_hand' },
        { island: 'belly', prefix: 'right_wing_hand' },
        { island: 'belly', prefix: 'left_wing_tip' },
        { island: 'belly', prefix: 'right_wing_tip' },
        { island: 'glow_deep', exact: 'snout', face: 'down' },
        { island: 'glow_deep', exact: 'nose_tip', face: 'down' },
        { island: 'glow_deep', exact: 'lower_jaw', face: 'up' },
      ]),
      fallback: skinFieldPolicy({ region: [16, 0, 64, 64], heightReference: 26, litFromAbove: true }),
    },
  });

  for (const [name, pivot, parent] of GROUPS) model.bone(name, pivot, parent);
  for (const spec of CUBES) model.cube(spec);
  model.addTexture(atlas.toTexture('icedragon_scale', { useAsDefault: true }));
  for (const entry of buildClips()) model.addClip(entry);

  model.assignUv();
  const hygiene = geometricHygiene(model, options.hygiene === false ? { mode: 'report' } : { mode: 'hide' });
  const seams =
    options.soften === false
      ? { pairs: 0, blended: 0, pixels: 0, softness: 0, strength: 0, sharedJoins: 0 }
      : softenSeams(model, { style: options.style ?? 'balanced' });

  return { model, atlas, hygiene, seams };
}

/* ------------------------------------------------------------------- cli -- */

function parseArgs(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags.set(key, next);
      i += 1;
    } else flags.set(key, true);
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(typeof flags.get('out') === 'string' ? flags.get('out') : 'out');
  const fs = await import('node:fs');
  fs.mkdirSync(outDir, { recursive: true });

  const { model, hygiene, seams } = buildIceDragon();
  model.assignUv();

  console.log(formatCoincidence(hygiene.report));
  console.log(`  → ${hygiene.resolved.length} face(s) adjusted to stop z-fighting`);
  console.log(`  → ${seams.pixels} texture pixel(s) bridged across ${seams.blended} seam(s)`);
  if (seams.sharedJoins > 0) console.log(`  → ${seams.sharedJoins} material(s) left alone (shared atlas islands)`);

  const report = validate(model, { warnOnEmptyBones: true });
  console.log(formatReport(report));
  if (!report.ok) process.exitCode = 1;

  console.log(`→ ${writeBbmodel(model, path.join(outDir, 'icedragon.bbmodel'))}`);
  const java = writeJavaModel(model, path.join(outDir, 'java'), { writeTexture: true, writeMcmeta: true });
  console.log(`→ ${java.modelPath}`);
  if (java.texturePath) console.log(`→ ${java.texturePath}`);

  const sheet = contactSheet(model, { width: 220, height: 220, outline: true });
  console.log(`→ ${writeBinary(path.join(outDir, 'icedragon_preview.png'), sheet.toPng())}`);

  console.log(model.summary());
  console.log(formatMetrics(metrics(model)));
}

if (import.meta.url === `file://${path.resolve(process.argv[1] ?? '').replace(/\\/g, '/')}` || process.argv[1]?.endsWith('icedragon.mjs')) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export default buildIceDragon;
