#!/usr/bin/env node
/**
 * Dragon — a winged quadruped, built with the surface passes in from the start.
 *
 * This example exists to push the toolkit somewhere the T-Rex does not. Three things are new
 * here and each one stresses a different layer:
 *
 *  - **A folded wing.** The wing is a three-bone chain whose rest pose is already folded along
 *    the body, so unfolding is pure animation. That means the geometry has to be placed in
 *    *absolute* folded coordinates while the rotations happen around joint pivots — which is
 *    the cases where a mirrored part needs mirrored rotation signs, not copied ones.
 *  - **Four legs.** `locomotion()` takes a leg list, so a diagonal gait is a matter of phases,
 *    but the neck/tail generators were written for a biped and the rig has to be described to
 *    them explicitly.
 *  - **Bevels everywhere.** A dragon reads as a soft-bodied animal, so the chest, hips and
 *    tail root are chamfered and the spine carries an angled scute row.
 *
 *   node examples/dragon/dragon.mjs --out ./out
 */
import path from 'node:path';
import {
  Atlas,
  Model,
  bands,
  bevelEdges,
  clip,
  eye as eyeBrush,
  contactSheet,
  cycle,
  defaultMotionRig,
  deriveShade,
  formatCoincidence,
  formatMetrics,
  formatReport,
  geometricHygiene,
  grain,
  harmonize,
  idleSway,
  islandRules,
  locomotion,
  metrics,
  pose,
  rgbToHex,
  skinFieldPolicy,
  slab,
  softenSeams,
  tailWave,
  validate,
  writeBbmodel,
  writeBinary,
  writeJavaModel,
  TAU,
} from '../../dist/index.js';

/* ------------------------------------------------------------------ bones -- */

// Model space: +X is the model's left, +Y is up with the feet at y = 0, the model faces +Z.
// A dragon stands low, so the body sits at y 9..21 and the legs are short and bent.
const GROUPS = [
  ['root', [0, 0, 0], null],
  ['hips', [0, 13, -5], 'root'],
  ['spine', [0, 14, 1], 'hips'],
  ['chest', [0, 15, 7], 'spine'],
  ['neck_01', [0, 17, 12], 'chest'],
  ['neck_02', [0, 19, 16], 'neck_01'],
  ['neck_03', [0, 21, 20], 'neck_02'],
  ['head', [0, 22, 24], 'neck_03'],
  ['jaw', [0, 20, 25], 'head'],
  ['eyes', [0, 23.5, 26], 'head'],

  // The wing chain, pivots at the joints of the *folded* rest pose: the shoulder, the top of
  // the folded peak (the elbow), and the wrist where the hand sweeps back.
  ['wing_left_01', [4.5, 18, 6], 'chest'],
  ['wing_left_02', [6.5, 23.5, 4], 'wing_left_01'],
  ['wing_left_03', [7, 18, -5], 'wing_left_02'],
  ['wing_right_01', [-4.5, 18, 6], 'chest'],
  ['wing_right_02', [-6.5, 23.5, 4], 'wing_right_01'],
  ['wing_right_03', [-7, 18, -5], 'wing_right_02'],

  ['tail_01', [0, 14, -11], 'hips'],
  ['tail_02', [0, 13.5, -17], 'tail_01'],
  ['tail_03', [0, 13, -23], 'tail_02'],
  ['tail_04', [0, 12.5, -28], 'tail_03'],
  ['tail_05', [0, 12, -33], 'tail_04'],

  // Front legs hang off the chest, hind legs off the hips.
  ['front_leg_left', [3, 13, 6], 'chest'],
  ['front_shin_left', [3, 7, 7], 'front_leg_left'],
  ['front_foot_left', [3, 1.5, 6.5], 'front_shin_left'],
  ['front_leg_right', [-3, 13, 6], 'chest'],
  ['front_shin_right', [-3, 7, 7], 'front_leg_right'],
  ['front_foot_right', [-3, 1.5, 6.5], 'front_shin_right'],
  ['hind_leg_left', [3.5, 13.5, -3], 'hips'],
  ['hind_shin_left', [3.5, 7, -4], 'hind_leg_left'],
  ['hind_foot_left', [3.5, 1.5, -3], 'hind_shin_left'],
  ['hind_leg_right', [-3.5, 13.5, -3], 'hips'],
  ['hind_shin_right', [-3.5, 7, -4], 'hind_leg_right'],
  ['hind_foot_right', [-3.5, 1.5, -3], 'hind_shin_right'],
];

const NECK = ['neck_01', 'neck_02', 'neck_03'];
const TAIL = ['tail_01', 'tail_02', 'tail_03', 'tail_04', 'tail_05'];

/* ------------------------------------------------------------------ cubes -- */

const CUBES = [];
const cube = (name, from, to, bone, transform) =>
  CUBES.push({ name, from, to, bone, ...(transform ?? {}) });

/**
 * Mirror a part across the X = 0 plane.
 *
 * This is `mirrorPair` plus the part `mirrorPair` does not do: **mirrored rotation signs**.
 * Mirroring geometry across X flips the sense of a rotation about Y and Z while leaving a
 * rotation about X alone, and it mirrors the rotation origin too. A folded wing is exactly the
 * case that exposes it — the left wing folds with a negative Y and the right with a positive
 * one, so copying the angles gives a wing that folds the wrong way.
 */
/** Swap the `left` token wherever it appears: `left_wing_arm` and `wing_left_03` both flip. */
const flipSide = (name) => name.replace(/(^|_)left(_|$)/g, '$1right$2');

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
function pair(spec) {
  CUBES.push(spec, mirrorX(spec));
}

// torso: hips, spine, chest, and a belly that bulges below all three
cube('hip_block', [-4.5, 10, -12], [4.5, 19, -3], 'hips');
cube('spine_block', [-5, 9.5, -4], [5, 19.5, 4], 'spine');
cube('chest_block', [-5.5, 10, 3], [5.5, 21, 11], 'chest');
cube('belly', [-3.8, 8.5, -6], [3.8, 11, 7], 'spine');

// Dorsal scutes, swept back about their own rear edge so the spine reads as a ridge rather
// than a row of blocks.
[
  { name: 'ridge_hip', from: [-1.5, 19, -12], to: [1.5, 21.5, -8], bone: 'hips' },
  { name: 'ridge_spine', from: [-1.5, 19.5, -4], to: [1.5, 22, 0], bone: 'spine' },
  { name: 'ridge_chest', from: [-1.4, 21, 3], to: [1.4, 23.5, 8], bone: 'chest' },
].forEach((spec) =>
  cube(spec.name, spec.from, spec.to, spec.bone, {
    rotation: [-28, 0, 0],
    origin: [0, spec.from[1], spec.from[2] + 1],
  }),
);

// neck, tapering and rising
cube('neck_cube_01', [-3.5, 15, 10], [3.5, 20.5, 15], 'neck_01');
cube('neck_cube_02', [-3, 17, 14], [3, 22, 19], 'neck_02');
cube('neck_cube_03', [-2.4, 19, 18], [2.4, 23.5, 23], 'neck_03');
cube('neck_ridge_01', [-1, 20.5, 11], [1, 22.5, 15], 'neck_01', { rotation: [-24, 0, 0], origin: [0, 20.5, 12] });
cube('neck_ridge_02', [-1, 22, 15], [1, 24, 19], 'neck_02', { rotation: [-24, 0, 0], origin: [0, 22, 16] });

// head
cube('skull', [-3.4, 20.5, 22], [3.4, 26, 31], 'head');
// A brow that overhangs the eyes, pivoted at its back so the front drops.
cube('brow', [-3.2, 23.5, 25.5], [3.2, 26, 31.5], 'head', { rotation: [10, 0, 0], origin: [0, 24, 26] });
cube('snout', [-2.4, 21, 30], [2.4, 25, 36.5], 'head');
// Muzzle droops at the tip: pivot at the back of the snout, which stays buried.
cube('nose_tip', [-2, 21.4, 35], [2, 24.6, 39], 'head', { rotation: [8, 0, 0], origin: [0, 23, 35] });
cube('lower_jaw', [-2.2, 19, 24], [2.2, 21.6, 35], 'jaw', { rotation: [3, 0, 0], origin: [0, 20.3, 35] });
cube('tongue', [-1.4, 20.8, 26], [1.4, 21.9, 33], 'jaw', { rotation: [3, 0, 0], origin: [0, 20.3, 35] });

// horns swept back and up off the skull, and a pair of jaw spikes
pair({ name: 'left_horn', from: [2.4, 24.5, 26], to: [3.6, 26.5, 30.5], bone: 'head', rotation: [-38, 0, -12], origin: [3, 25, 28] });
pair({ name: 'left_horn_tip', from: [2.2, 26, 25], to: [3.1, 27.6, 28.4], bone: 'head', rotation: [-48, 0, -16], origin: [3, 26.5, 27] });
// cheek plate: a slab along the side of the skull, so the head is not one flat-sided box
pair({ name: 'left_cheek_plate', from: [2.6, 21.4, 26.5], to: [3.9, 24.6, 30.5], bone: 'head', rotation: [0, -10, 0], origin: [3.4, 23, 26.5] });

// A shallow socket with the eye set into it. The socket is deliberately *wider* than the eye
// so the dark ring around it reads as a rim rather than as a hole punched through the skull —
// a whole cube painted dark, which is what this was first, reads as exactly that.
pair({ name: 'left_eye_socket', from: [2.5, 22.4, 26.9], to: [3.5, 24.8, 30], bone: 'head', rotation: [8, 0, 6], origin: [3.2, 23.6, 28.4] });
pair({ name: 'left_eye', from: [3.15, 22.9, 27.5], to: [3.75, 24.3, 29.4], bone: 'head', rotation: [8, 0, 6], origin: [3.45, 23.6, 28.4] });
pair({ name: 'left_nostril', from: [1.1, 23, 36], to: [1.9, 24.1, 37.4], bone: 'head' });

// teeth: a row along the upper jaw and a shorter row below
for (const side of [1, -1]) {
  const tag = side > 0 ? 'left' : 'right';
  [30.5, 33, 35.5].forEach((z, index) => {
    const x1 = side * 1.5;
    const x2 = side * 2.4;
    cube(`tooth_upper_${tag}_${index}`, [Math.min(x1, x2), 20.6, z - 0.6], [Math.max(x1, x2), 22.2, z + 0.6], 'head');
  });
  [31.5, 34].forEach((z, index) => {
    const x1 = side * 1.1;
    const x2 = side * 1.9;
    cube(`tooth_lower_${tag}_${index}`, [Math.min(x1, x2), 21.6, z - 0.5], [Math.max(x1, x2), 22.8, z + 0.5], 'jaw');
  });
}

/* ------------------------------------------------------------------- wing -- */
//
// The wing is modelled **already folded**, lying back along the body, and the unfold is pure
// animation. That is the only arrangement that works: a creature at rest has its wings folded,
// so the rest pose has to be the folded one, and unfolding then becomes a set of rotations
// around the joint pivots rather than a second set of geometry.

// 01 — the humerus: a short, tall peak rising off the shoulder. This is the bump you see above
// a resting dragon's back, and it is deliberately narrow in X: a folded wing that is wide at
// the shoulder reads as an arm held out.
pair({ name: 'left_wing_arm', from: [5.6, 17, 4.5], to: [8.2, 24.5, 9.5], bone: 'wing_left_01', rotation: [0, 0, 8], origin: [5.8, 17.5, 5] });
// 02 — the forearm: folded back and down along the flank, tipping backward about the elbow.
pair({
  name: 'left_wing_forearm',
  from: [5.8, 14, -4.5],
  to: [8.4, 24, 5],
  bone: 'wing_left_02',
  rotation: [-22, 0, 4],
  origin: [6.5, 23.5, 4],
});
// 03 — the hand: carries on back and down past the wrist, over the hips.
pair({
  name: 'left_wing_hand',
  from: [6, 12.5, -14],
  to: [8.4, 21, -4],
  bone: 'wing_left_03',
  rotation: [-16, 0, 3],
  origin: [7, 18, -5],
});
// the tip, tucked along the hip toward the tail root
pair({
  name: 'left_wing_tip',
  from: [6.2, 11, -22],
  to: [8.2, 18.5, -13],
  bone: 'wing_left_03',
  rotation: [-12, 0, 2],
  origin: [7, 18, -5],
});
// the membrane: one thin plate hanging between the forearm and the flank. Thin in X, and the
// reason the fold reads as skin rather than as a second bone.
pair({
  name: 'left_wing_membrane',
  from: [6.7, 14.5, -14],
  to: [7.5, 22, 1],
  bone: 'wing_left_02',
  rotation: [-16, 0, 3],
  origin: [6.5, 23.5, 4],
});
// a shoulder cap where the wing root meets the chest, so the join is bridged rather than abrupt
pair({ name: 'left_wing_shoulder', from: [5, 19, 4], to: [8, 22.6, 9], bone: 'wing_left_01', rotation: [0, 0, 9], origin: [5.2, 19.6, 5] });

/* ------------------------------------------------------------------- legs -- */

const LEGS = [
  { side: 'left', sign: 1, tag: 'front', thigh: [2, 6.5, 2.5], knee: [2.2, 5.6, 3.2] },
  { side: 'right', sign: -1, tag: 'front', thigh: [2, 6.5, 2.5], knee: [2.2, 5.6, 3.2] },
  { side: 'left', sign: 1, tag: 'hind', thigh: [2.4, 7.5, 3.6], knee: [2.6, 6.2, 3.4] },
  { side: 'right', sign: -1, tag: 'hind', thigh: [2.4, 7.5, 3.6], knee: [2.6, 6.2, 3.4] },
];

for (const leg of LEGS) {
  const { sign, tag, side } = leg;
  const bone = `${tag}_leg_${side}`;
  const shin = `${tag}_shin_${side}`;
  const foot = `${tag}_foot_${side}`;
  const box = (x1, x2, from, to) => [
    [Math.min(sign * x1, sign * x2), from[1], from[2]],
    [Math.max(sign * x1, sign * x2), to[1], to[2]],
  ];
  const z = tag === 'front' ? 6 : -3;

  const [tf, tt] = box(sign > 0 ? 1.4 : 1.4, sign > 0 ? 4.6 : 4.6, [0, 5.5, z - 3], [0, 14.5, z + 3]);
  cube(`${bone}_thigh`, tf, tt, bone, { rotation: [10, 0, 0], origin: [sign * 3, 13, z] });

  const [sf, st] = box(2, 4.4, [0, 2, z - 2.6], [0, 8, z + 2.6]);
  cube(`${shin}_cube`, sf, st, shin, { rotation: [-22, 0, 0], origin: [sign * 3.2, 7.5, z + 2] });

  const [ff, ft] = box(1.6, 4.8, [0, 0, z - 3.4], [0, 3, z + 4.4]);
  cube(`${foot}_cube`, ff, ft, foot, { rotation: [14, 0, 0], origin: [sign * 3.2, 2.4, z - 3] });
}

// toe claws, lifted off the ground as they point forward
[['front', 6], ['hind', -3]].forEach(([tag, z]) => {
  const foot = `${tag}_foot`;
  pair({
    name: `left_${tag}_claw`,
    from: [1.8, 0, z + 3.6],
    to: [3.4, 1.5, z + 5.6],
    bone: `${foot}_left`,
    rotation: [-16, 0, 0],
    origin: [2.6, 0, z + 3.6],
  });
  pair({
    name: `left_${tag}_claw_outer`,
    from: [3.6, 0, z + 3.2],
    to: [5, 1.3, z + 5],
    bone: `${foot}_left`,
    rotation: [-18, 0, 0],
    origin: [4.3, 0, z + 3.2],
  });
});

/* -------------------------------------------------------------------- tail -- */

const TAIL_SEGMENTS = [
  [-3.4, 11, -16, 3.4, 17.5, -11],
  [-3, 11, -22, 3, 17, -17],
  [-2.5, 11, -27.5, 2.5, 16, -23],
  [-1.9, 11.2, -32.5, 1.9, 15, -28],
  [-1.2, 11.6, -37, 1.2, 13.6, -33],
];
TAIL_SEGMENTS.forEach(([x1, y1, z1, x2, y2, z2], index) => {
  cube(`tail_cube_${index + 1}`, [x1, y1, z1], [x2, y2, z2], TAIL[index]);
});
// A ridge that flattens toward the tip, plus a spade at the end.
TAIL_SEGMENTS.slice(0, 4).forEach(([x1, , z1, x2, , z2], index) => {
  cube(`tail_ridge_${index + 1}`, [x1 * 0.28, 17 - index * 0.7, z1], [x2 * 0.28, 19 - index * 0.7, z2], TAIL[index], {
    rotation: [-22 + index * 2, 0, 0],
    origin: [0, 17 - index * 0.7, z1 + 1],
  });
});
cube('tail_spade_01', [-2.6, 14.4, -36], [2.6, 18.4, -42], 'tail_05', { rotation: [0, 0, 0] });
cube('tail_spade_02', [-1.4, 15.2, -40], [1.4, 17.6, -45], 'tail_05');

/* ------------------------------------------------------------------ bevels -- */
//
// A dragon reads as a soft-bodied animal, so every hard corner on the torso is chamfered.
// Each bevel shares its end planes with its parent, which is exactly the coincidence case —
// `geometricHygiene` pulls the duplicates out below.

for (const spec of [
  ...bevelEdges({ name: 'chest', from: [-5.5, 10, 3], to: [5.5, 21, 11], bone: 'chest', edges: ['top-left', 'top-right'], chamfer: 2.8, inset: 0.45 }),
  ...bevelEdges({ name: 'hip', from: [-4.5, 10, -12], to: [4.5, 19, -3], bone: 'hips', edges: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], chamfer: 2.4, inset: 0.42 }),
  ...bevelEdges({ name: 'spine', from: [-5, 9.5, -4], to: [5, 19.5, 4], bone: 'spine', edges: ['top-left', 'top-right'], chamfer: 2.6, inset: 0.45 }),
  ...bevelEdges({ name: 'belly', from: [-3.8, 8.5, -6], to: [3.8, 11, 7], bone: 'spine', edges: ['bottom-left', 'bottom-right'], chamfer: 2, inset: 0.35 }),
]) {
  cube(spec.name, spec.from, spec.to, spec.bone, {
    ...(spec.rotation ? { rotation: spec.rotation } : {}),
    ...(spec.origin ? { origin: spec.origin } : {}),
  });
}

/* ----------------------------------------------------------------- texture -- */

// One pigment, four depths. The membrane is the only part that shifts hue at all, and only
// enough to read as thinner skin over the same animal.
const SCALE_BASE = [92, 152, 106];
const [SCALE, BELLY, MEMBRANE, RIDGE] = harmonize(
  [
    SCALE_BASE,
    deriveShade(SCALE_BASE, { lightness: 0.16, saturation: 0.72 }),
    deriveShade(SCALE_BASE, { lightness: -0.2, saturation: 1.25, hueShift: -12 }),
    deriveShade(SCALE_BASE, { lightness: -0.07, saturation: 1.1 }),
  ],
  { strength: 0.35 },
);

const PALETTE = {
  horn: [0, 0, 4, 4],
  claw: [4, 0, 8, 4],
  socket: [8, 0, 12, 4],
  iris: [12, 0, 16, 4],
  membrane: [0, 4, 8, 12],
  belly: [8, 4, 16, 12],
  mouth: [0, 12, 4, 16],
  teeth: [4, 12, 8, 16],
  ridge: [8, 12, 12, 16],
};

const ISLAND_COLOR = {
  horn: '#ded2b4',
  claw: '#26241f',
  socket: '#3a4a3c',
  iris: '#d8a63c',
  membrane: rgbToHex(MEMBRANE),
  belly: rgbToHex(BELLY),
  mouth: '#6d2b39',
  teeth: '#efe9d6',
  ridge: rgbToHex(RIDGE),
};

const ISLAND_CONTRAST = { membrane: 0.26, belly: 0.2, horn: 0.3, ridge: 0.34, socket: 0.24 };

function hexRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function buildAtlas() {
  const atlas = new Atlas(64, 64);
  atlas.define('scale', [16, 0, 64, 64]);
  // Eight vertical bands: a face window is small, so it usually crosses one boundary and
  // carries the base plus one shade.
  bands(atlas.canvas, atlas.get('scale'), SCALE, { steps: 8, contrast: 0.48, axis: 'vertical' });

  for (const [name, rect] of Object.entries(PALETTE)) {
    atlas.define(name, rect);
    bands(atlas.canvas, rect, hexRgb(ISLAND_COLOR[name]), {
      steps: name === 'eye' || name === 'pupil' ? 1 : 4,
      contrast: ISLAND_CONTRAST[name] ?? 0.3,
      axis: 'vertical',
    });
  }

  // The membrane gets cross-hatching so a large thin surface is not one flat colour, and the
  // iris island gets a proper eye: flat sclera, flat iris, a 2×2 pupil and a brow shadow. The
  // `eye` brush is worth using over hand-placed pixels because it keeps the pupil centred on a
  // rect of any size, which is what makes one eye readable at 4×4.
  grain(atlas.canvas, atlas.get('membrane'), hexRgb(ISLAND_COLOR.membrane), { amount: 0.06, scale: 3, seed: 7 });
  eyeBrush(atlas.canvas, atlas.get('iris'), {
    sclera: [216, 166, 60],
    iris: [122, 74, 26],
    pupil: [10, 9, 9],
    brow: [58, 74, 52],
  });
  return atlas;
}

/* --------------------------------------------------------------- animations -- */

const rig = {
  ...defaultMotionRig(5),
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

const WING_BONES = {
  left: ['wing_left_01', 'wing_left_02', 'wing_left_03'],
  right: ['wing_right_01', 'wing_right_02', 'wing_right_03'],
};

/** Fully extended: the shoulder lifts, then the forearm and hand straighten outward. */
const WING_SPREAD = {
  wing_left_01: [0, 0, 26],
  wing_left_02: [0, -52, 4],
  wing_left_03: [0, -30, 0],
  wing_right_01: [0, 0, -26],
  wing_right_02: [0, 52, -4],
  wing_right_03: [0, 30, 0],
};

/** Half-folded: the wing is up and out but still bent — gliding and perching. */
const WING_HALF = {
  wing_left_01: [0, 0, 14],
  wing_left_02: [0, -24, 2],
  wing_left_03: [0, -14, 0],
  wing_right_01: [0, 0, -14],
  wing_right_02: [0, 24, -2],
  wing_right_03: [0, 14, 0],
};

const FOLDED = {
  wing_left_01: [0, 0, 0],
  wing_left_02: [0, 0, 0],
  wing_left_03: [0, 0, 0],
  wing_right_01: [0, 0, 0],
  wing_right_02: [0, 0, 0],
  wing_right_03: [0, 0, 0],
};

/**
 * A wing beat.
 *
 * There is no generator for this: `MotionRig` has body/chest/head/neck/tail/legs/arms and
 * nothing else, so a wing has to be authored by hand. The beat is asymmetric on purpose — the
 * downstroke is fast and the recovery is slow, which is what makes a wing read as pushing
 * against air instead of waving.
 */
function wingBeat({ length, samples = 8, lift = 34, drop = -20, tipLag = 0.06 }) {
  const keys = [];
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? 1 : -1;
    const [shoulder, forearm, hand] = WING_BONES[side];
    const flap = (t, lag) => {
      const phase = (t - lag + 1) % 1;
      // 0..0.35 upstroke, 0.35..0.6 snap down, then a slow settle.
      const liftPhase = phase < 0.35 ? phase / 0.35 : phase < 0.6 ? 1 - (phase - 0.35) / 0.25 : 0;
      return drop + (lift - drop) * liftPhase;
    };
    keys.push(...cycle(shoulder, 'rotation', length, samples, (t) => [0, 0, sign * (18 + flap(t, 0))]));
    keys.push(...cycle(forearm, 'rotation', length, samples, (t) => [0, -sign * 46, sign * (4 + flap(t, tipLag) * 0.4)]));
    keys.push(...cycle(hand, 'rotation', length, samples, (t) => [0, -sign * 26, sign * flap(t, tipLag * 2) * 0.5]));
  }
  return keys;
}

const NEUTRAL = {
  spine: [0, 0, 0],
  chest: [0, 0, 0],
  hips: [0, 0, 0],
  head: [0, 0, 0],
  jaw: [0, 0, 0],
  ...FOLDED,
};
const neckPose = (x, y = 0) => ({ neck_01: [x, y, 0], neck_02: [x * 0.7, y * 0.7, 0], neck_03: [x * 0.5, y * 0.5, 0] });
const oneShot = (name, length, entries, options = {}) =>
  clip({ name, loop: 'once', length, keys: pose(entries.map((e) => ({ ...e, ...options }))) });

function buildClips() {
  const clips = [];

  /* -- idle and locomotion ------------------------------------------------- */
  clips.push(clip({ name: 'idle', length: 4, keys: idleSway({ rig, length: 4, samples: 10, sway: 2, sink: 0.5, headScan: 6 }) }));
  clips.push(clip({ name: 'breathe', length: 3.4, keys: idleSway({ rig, length: 3.4, samples: 8, sway: 1, sink: 0.7, headScan: 2 }) }));
  clips.push(clip({ name: 'tail_sway', length: 3.2, keys: tailWave({ rig, length: 3.2, samples: 10, sway: 7, growth: 3, lag: 0.1 }) }));
  clips.push(
    clip({
      name: 'walk',
      length: 1.6,
      keys: locomotion({ rig, length: 1.6, stride: 20, knee: 26, bob: 0.5, lean: 1, tailLift: 1.5, armSwing: 2, headDrop: -1, samples: 10 }),
    }),
  );
  clips.push(
    clip({
      name: 'run',
      length: 0.9,
      keys: locomotion({ rig, length: 0.9, stride: 32, knee: 44, bob: 1.1, lean: 5, tailLift: 4, armSwing: 4, headDrop: -2, samples: 10 }),
    }),
  );
  clips.push(
    clip({
      name: 'prowl',
      length: 2.6,
      keys: locomotion({ rig, length: 2.6, stride: 13, knee: 18, bob: 0.3, lean: -2, tailLift: 0.5, armSwing: 1, headDrop: 2, samples: 12 }),
    }),
  );
  // Turning the head is neck work, and `idleSway` does not drive the neck — so every neck bone
  // needs a key at each end of the clip, not just at the turn, or the channel holds a single
  // value and the head never comes back.
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

  /* -- wings --------------------------------------------------------------- */
  clips.push(
    oneShot('wing_unfurl', 1.2, [
      { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
      { time: 0.25, rotations: { ...WING_HALF } },
      { time: 0.55, rotations: { ...WING_SPREAD, spine: [-4, 0, 0] } },
      { time: 1.2, rotations: { ...WING_SPREAD, spine: [-2, 0, 0] } },
    ]),
  );
  clips.push(
    oneShot('wing_fold', 1.1, [
      { time: 0, rotations: { ...WING_SPREAD } },
      { time: 0.4, rotations: { ...WING_HALF } },
      { time: 1.1, rotations: { ...NEUTRAL }, interpolation: 'linear' },
    ]),
  );
  clips.push(clip({ name: 'flap', length: 1, keys: wingBeat({ length: 1, samples: 12, lift: 40, drop: -24 }) }));
  clips.push(
    clip({
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
    }),
  );
  clips.push(
    oneShot('takeoff', 2.2, [
      { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
      { time: 0.3, rotations: { ...NEUTRAL, spine: [8, 0, 0], front_leg_left: [24, 0, 0], front_leg_right: [24, 0, 0], hind_leg_left: [22, 0, 0], hind_leg_right: [22, 0, 0], front_shin_left: [34, 0, 0], front_shin_right: [34, 0, 0], hind_shin_left: [32, 0, 0], hind_shin_right: [32, 0, 0] }, positions: { spine: [0, -2.4, 0] }, interpolation: 'linear' },
      { time: 0.75, rotations: { ...WING_SPREAD, spine: [-12, 0, 0] }, positions: { spine: [0, 1.2, 0] } },
      { time: 1.15, rotations: { ...WING_SPREAD, wing_left_01: [0, 0, -6], wing_left_02: [0, -52, 4], wing_left_03: [0, -30, 0], wing_right_01: [0, 0, 6], wing_right_02: [0, 52, -4], wing_right_03: [0, 30, 0], spine: [-18, 0, 0], hind_leg_left: [-26, 0, 0], hind_leg_right: [-26, 0, 0] }, positions: { spine: [0, 5.5, 0] } },
      { time: 1.5, rotations: { ...WING_SPREAD, wing_left_01: [0, 0, 34], wing_right_01: [0, 0, -34], spine: [-14, 0, 0], hind_leg_left: [-18, 0, 0], hind_leg_right: [-18, 0, 0] }, positions: { spine: [0, 8, 0] } },
      { time: 2.2, rotations: { ...WING_SPREAD, spine: [-10, 0, 0] }, positions: { spine: [0, 9, 0] } },
    ]),
  );
  clips.push(
    oneShot('land', 1.5, [
      { time: 0, rotations: { ...WING_SPREAD }, positions: { spine: [0, 6, 0] } },
      { time: 0.45, rotations: { ...WING_SPREAD, wing_left_01: [0, 0, -14], wing_right_01: [0, 0, 14], spine: [6, 0, 0], front_leg_left: [40, 0, 0], front_leg_right: [40, 0, 0], hind_leg_left: [36, 0, 0], hind_leg_right: [36, 0, 0] }, positions: { spine: [0, -1, 0] } },
      { time: 0.8, rotations: { ...WING_HALF, spine: [9, 0, 0], front_shin_left: [30, 0, 0], front_shin_right: [30, 0, 0], hind_shin_left: [28, 0, 0], hind_shin_right: [28, 0, 0] }, positions: { spine: [0, -2.2, 0] } },
      { time: 1.5, rotations: { ...NEUTRAL }, positions: { spine: [0, 0, 0] }, interpolation: 'linear' },
    ]),
  );

  /* -- combat and states ---------------------------------------------------- */
  clips.push(
    oneShot('roar', 1.9, [
      { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
      { time: 0.35, rotations: { ...neckPose(14), jaw: [8, 0, 0], spine: [-3, 0, 0], ...WING_HALF }, positions: { spine: [0, -0.6, 0] } },
      { time: 0.7, rotations: { ...neckPose(-16), jaw: [46, 0, 0], spine: [-8, 0, 0], head: [-6, 0, 0], ...WING_SPREAD }, positions: { spine: [0, 1.4, -0.6] } },
      { time: 1.3, rotations: { ...neckPose(-18), jaw: [44, 0, 0], spine: [-8, 0, 0], ...WING_SPREAD } },
      { time: 1.55, rotations: { ...neckPose(-6), jaw: [12, 0, 0], spine: [-3, 0, 0], ...WING_HALF }, positions: { spine: [0, 0.4, 0] } },
      { time: 1.9, rotations: { ...NEUTRAL }, positions: { spine: [0, 0, 0] }, interpolation: 'linear' },
    ]),
  );
  clips.push(
    oneShot('bite', 0.6, [
      { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
      { time: 0.14, rotations: { ...neckPose(10), jaw: [12, 0, 0] } },
      { time: 0.24, rotations: { ...neckPose(6), jaw: [40, 0, 0] } },
      { time: 0.34, rotations: { ...neckPose(-14), jaw: [-2, 0, 0], spine: [4, 0, 0] } },
      { time: 0.6, rotations: { ...NEUTRAL }, interpolation: 'linear' },
    ]),
  );
  clips.push(
    oneShot('claw_swipe', 0.9, [
      { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
      { time: 0.2, rotations: { ...NEUTRAL, spine: [0, 14, 0], chest: [0, 10, 0], front_leg_left: [-34, 0, -18] }, positions: { spine: [0, 0.6, -0.6] } },
      { time: 0.4, rotations: { ...NEUTRAL, spine: [0, -18, 0], chest: [0, -12, 0], front_leg_left: [42, 0, 24], front_shin_left: [-30, 0, 0], head: [0, -14, 0] }, positions: { spine: [0, 0.2, 1.4] }, interpolation: 'linear' },
      { time: 0.9, rotations: { ...NEUTRAL }, positions: { spine: [0, 0, 0] }, interpolation: 'linear' },
    ]),
  );
  clips.push(
    oneShot('tail_whip', 0.9, [
      { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
      { time: 0.25, rotations: { tail_01: [0, 18, 0], tail_02: [0, 16, 0], tail_03: [0, 14, 0], tail_04: [0, 12, 0], tail_05: [0, 10, 0], spine: [0, 6, 0] } },
      { time: 0.5, rotations: { tail_01: [0, -34, 0], tail_02: [0, -30, 0], tail_03: [0, -26, 0], tail_04: [0, -22, 0], tail_05: [0, -18, 0], spine: [0, -10, 0], head: [0, -10, 0] }, interpolation: 'linear' },
      { time: 0.9, rotations: { ...NEUTRAL }, interpolation: 'linear' },
    ]),
  );
  clips.push(
    oneShot('hurt', 0.55, [
      { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
      { time: 0.08, rotations: { ...NEUTRAL, spine: [-14, 7, 0], ...neckPose(16, 10), head: [10, 8, 0], jaw: [20, 0, 0], wing_left_01: [0, 0, 20], wing_right_01: [0, 0, -20] }, positions: { spine: [0, 0.4, -1.6] }, interpolation: 'linear' },
      { time: 0.24, rotations: { ...NEUTRAL, spine: [7, -3, 0], ...neckPose(-6, -3), jaw: [5, 0, 0] }, positions: { spine: [0, -0.2, 0.6] } },
      { time: 0.55, rotations: { ...NEUTRAL }, positions: { spine: [0, 0, 0] }, interpolation: 'linear' },
    ]),
  );
  clips.push(
    clip({
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
    }),
  );

  return clips;
}

/* ------------------------------------------------------------------- build -- */

export function buildDragon(options = {}) {
  const atlas = buildAtlas();
  const model = new Model({
    name: 'dragon',
    resolution: [64, 64],
    identifier: 'geometry.dragon',
    uvPolicy: {
      rules: islandRules(atlas, [
        // The iris only on the outward face of the eye cube, and `exact` rather than `prefix`
        // so the surrounding socket cube (which also starts with `left_eye`) does not claim it.
        { island: 'iris', exact: 'left_eye', face: 'east' },
        { island: 'iris', exact: 'right_eye', face: 'west' },
        { island: 'socket', prefix: 'left_eye' },
        { island: 'socket', prefix: 'right_eye' },
        { island: 'horn', prefix: 'left_horn' },
        { island: 'horn', prefix: 'right_horn' },
        { island: 'horn', prefix: 'left_jaw_spike' },
        { island: 'horn', prefix: 'right_jaw_spike' },
        { island: 'claw', prefix: 'left_front_claw' },
        { island: 'claw', prefix: 'right_front_claw' },
        { island: 'claw', prefix: 'left_hind_claw' },
        { island: 'claw', prefix: 'right_hind_claw' },
        { island: 'membrane', prefix: 'left_wing_membrane' },
        { island: 'membrane', prefix: 'right_wing_membrane' },
        { island: 'ridge', prefix: 'ridge' },
        { island: 'ridge', prefix: 'neck_ridge' },
        { island: 'ridge', prefix: 'tail_ridge' },
        { island: 'ridge', prefix: 'tail_spade' },
        { island: 'teeth', prefix: 'tooth' },
        { island: 'belly', prefix: 'belly' },
        { island: 'belly', exact: 'neck_cube_01', face: 'down' },
        { island: 'belly', exact: 'neck_cube_02', face: 'down' },
        { island: 'belly', exact: 'chest_block', face: 'down' },
        { island: 'belly', exact: 'hip_block', face: 'down' },
        { island: 'mouth', exact: 'lower_jaw', face: 'up' },
        { island: 'mouth', exact: 'snout', face: 'down' },
        { island: 'mouth', exact: 'nose_tip', face: 'down' },
        { island: 'belly', exact: 'lower_jaw', face: 'down' },
        { island: 'belly', prefix: 'left_wing_hand' },
        { island: 'belly', prefix: 'right_wing_hand' },
        { island: 'belly', prefix: 'left_wing_tip' },
        { island: 'belly', prefix: 'right_wing_tip' },
        { island: 'mouth', exact: 'tongue' },
      ]),
      fallback: skinFieldPolicy({ region: [16, 0, 64, 64], heightReference: 24, litFromAbove: true }),
    },
  });

  for (const [name, pivot, parent] of GROUPS) model.bone(name, pivot, parent);
  for (const spec of CUBES) model.cube(spec);
  model.addTexture(atlas.toTexture('dragon_scale', { useAsDefault: true }));
  for (const entry of buildClips()) model.addClip(entry);

  model.assignUv();
  const hygiene = geometricHygiene(model, options.hygiene === false ? { mode: 'report' } : { mode: 'hide' });
  const seams =
    options.soften === false
      ? { pairs: 0, blended: 0, pixels: 0, softness: 0, strength: 0, sharedJoins: 0 }
      : softenSeams(model, { style: options.style ?? 'balanced' });

  return { model, atlas, hygiene, seams };
}

/* --------------------------------------------------------------------- cli -- */

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

  const { model, hygiene, seams } = buildDragon();
  model.assignUv();

  console.log(formatCoincidence(hygiene.report));
  console.log(`  → ${hygiene.resolved.length} face(s) adjusted to stop z-fighting`);
  console.log(`  → ${seams.pixels} texture pixel(s) bridged across ${seams.blended} seam(s)`);
  if (seams.sharedJoins > 0) console.log(`  → ${seams.sharedJoins} material(s) left alone (shared atlas islands)`);

  const report = validate(model, { warnOnEmptyBones: true });
  console.log(formatReport(report));
  if (!report.ok) process.exitCode = 1;

  console.log(`→ ${writeBbmodel(model, path.join(outDir, 'dragon.bbmodel'))}`);
  const java = writeJavaModel(model, path.join(outDir, 'java'));
  console.log(`→ ${java.modelPath}`);
  if (java.texturePath) console.log(`→ ${java.texturePath}`);

  const sheet = contactSheet(model, { width: 220, height: 220, outline: true });
  console.log(`→ ${writeBinary(path.join(outDir, 'dragon_preview.png'), sheet.toPng())}`);

  console.log(model.summary());
  console.log(formatMetrics(metrics(model)));
}

if (import.meta.url === `file://${path.resolve(process.argv[1] ?? '').replace(/\\/g, '/')}` || process.argv[1]?.endsWith('dragon.mjs')) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export default buildDragon;
