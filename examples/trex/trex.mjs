#!/usr/bin/env node
/**
 * T-Rex — a full worked example of the toolkit.
 *
 * Everything here is plain data and plain API calls: a bone table, a cube table, an atlas
 * with named material islands, a UV policy that sends special parts at the right island,
 * and 25 animations built from the motion generators plus pose snapshots.
 *
 * Run it through the CLI or directly:
 *   node examples/trex/trex.mjs --out ./out
 *   node ../../dist/cli.js build examples/trex/trex.mjs --out ./out --bbmodel --preview --metrics
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
  defaultMotionRig,
  deriveShade,
  findCoincidentFaces,
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

/* ------------------------------------------------------------------ bones -- */

// Coordinate frame: model faces +Z, Y is up, feet at y = 0, the model's left is +X.
const GROUPS = [
  ['root', [0, 0, 0], null],
  ['body', [0, 22, -4], 'root'],
  ['chest', [0, 24, 4], 'body'],
  ['neck_01', [0, 27, 12], 'chest'],
  ['neck_02', [0, 30, 17], 'neck_01'],
  ['head', [0, 32, 20], 'neck_02'],
  ['upper_jaw', [0, 33, 30], 'head'],
  ['lower_jaw', [0, 30.5, 27.5], 'head'],
  ['eyes', [0, 35, 31], 'head'],
  ['left_arm', [6.5, 25, 7], 'chest'],
  ['left_lower_arm', [7, 22, 7.5], 'left_arm'],
  ['left_claws', [7, 20, 7.5], 'left_lower_arm'],
  ['right_arm', [-6.5, 25, 7], 'chest'],
  ['right_lower_arm', [-7, 22, 7.5], 'right_arm'],
  ['right_claws', [-7, 20, 7.5], 'right_lower_arm'],
  ['left_leg', [6, 19, -2], 'body'],
  ['left_shin', [6, 9.5, -1], 'left_leg'],
  ['left_foot', [6, 4, 0], 'left_shin'],
  ['left_toes', [6, 3, 7], 'left_foot'],
  ['right_leg', [-6, 19, -2], 'body'],
  ['right_shin', [-6, 9.5, -1], 'right_leg'],
  ['right_foot', [-6, 4, 0], 'right_shin'],
  ['right_toes', [-6, 3, 7], 'right_foot'],
  ...Array.from({ length: 7 }, (_, i) => [`tail_0${i + 1}`, [0, 22, -9 - i * 8], i === 0 ? 'body' : `tail_0${i}`]),
];

const TAIL_BONES = ['tail_01', 'tail_02', 'tail_03', 'tail_04', 'tail_05', 'tail_06', 'tail_07'];

/* ------------------------------------------------------------------ cubes -- */

const CUBES = [];
/**
 * `transform` carries `rotation`/`origin`. Blockbench allows element rotation on every cube —
 * a voxel model simply never uses it. Rotating a box is what turns a stack of blocks into
 * sloped snouts, swept-back scutes and angled claws, and the buried end of a rotated slab is
 * invisible, so a slope costs nothing but an angle.
 */
const cube = (name, from, to, bone, transform) =>
  CUBES.push({ name, from, to, bone, ...(transform ?? {}) });

// torso and back ridge
cube('torso', [-7, 17, -9], [7, 29, 3], 'body');
cube('pelvis', [-6.4, 18, -14], [6.4, 27, -8], 'body');
cube('belly_01', [-5.6, 16.5, -8], [5.6, 19, 2], 'body');
cube('belly_02', [-5, 16.5, 2], [5, 19, 11], 'chest');
cube('chest_block', [-6, 18, 3], [6, 30, 13], 'chest');
// Dorsal scutes: swept back about their own rear-bottom edge, so the spine ridge leans into
// the tail instead of standing up like four separate blocks.
cube('ridge_01', [-1.6, 29, -7], [1.6, 31.5, -3], 'body', { rotation: [-26, 0, 0], origin: [0, 29, -6] });
cube('ridge_02', [-1.6, 29, -2], [1.6, 31.5, 2], 'body', { rotation: [-26, 0, 0], origin: [0, 29, -1] });
cube('ridge_03', [-1.6, 30, 4], [1.6, 32.5, 8], 'chest', { rotation: [-26, 0, 0], origin: [0, 30, 5] });
cube('ridge_04', [-1.4, 30, 9], [1.4, 32.5, 12], 'chest', { rotation: [-22, 0, 0], origin: [0, 30, 10] });
// Shoulder plates flare outward from the ribcage.
cube('shoulder_left', [5.4, 22, 4], [8.2, 27, 10], 'chest', { rotation: [0, 0, -9], origin: [5.4, 24.5, 7] });
cube('shoulder_right', [-8.2, 22, 4], [-5.4, 27, 10], 'chest', { rotation: [0, 0, 9], origin: [-5.4, 24.5, 7] });
cube('neck_ring', [-3.6, 26, 12], [3.6, 30, 16], 'neck_01');

// neck and head
cube('neck_cube_01', [-4.5, 24, 11], [4.5, 31, 17], 'neck_01');
cube('neck_cube_02', [-4, 26, 16], [4, 34, 22], 'neck_02');
cube('skull', [-5, 29, 20], [5, 38, 30], 'head');
// The brow is a slab pivoted at its back, tilted down at the front — an overhang over the
// eyes rather than a second box sitting on the skull.
cube('brow', [-4.6, 34, 27], [4.6, 37.5, 33], 'head', { rotation: [11, 0, 0], origin: [0, 35, 27] });
cube('brow_horn_left', [3.4, 36, 28], [4.8, 38.4, 31], 'head', { rotation: [-8, 0, -14], origin: [4.1, 36, 28] });
cube('brow_horn_right', [-4.8, 36, 28], [-3.4, 38.4, 31], 'head', { rotation: [-8, 0, 14], origin: [-4.1, 36, 28] });
// Cheeks flare outward from the jaw hinge.
cube('cheek_left', [4.2, 31, 27], [5.4, 34.4, 32], 'head', { rotation: [0, -13, 0], origin: [4.8, 32.5, 27] });
cube('cheek_right', [-5.4, 31, 27], [-4.2, 34.4, 32], 'head', { rotation: [0, 13, 0], origin: [-4.8, 32.5, 27] });
cube('nostril_left', [1.6, 35, 42], [2.8, 36.6, 43.6], 'upper_jaw');
cube('nostril_right', [-2.8, 35, 42], [-1.6, 36.6, 43.6], 'upper_jaw');
cube('snout', [-4, 31, 30], [4, 37, 42], 'upper_jaw');
// Muzzle droops toward the nose: pivoted at the back of the snout so the tip dips and the
// buried end stays put.
cube('nose_tip', [-3, 32, 40], [3, 37.5, 44], 'upper_jaw', { rotation: [7, 0, 0], origin: [0, 34, 40] });
// The jaw closes onto a slightly upturned tip, so the two halves meet instead of interpenetrating.
cube('lower_jaw_cube', [-3, 26.5, 27], [3, 30.5, 39], 'lower_jaw', { rotation: [3, 0, 0], origin: [0, 28.5, 39] });
cube('tongue', [-2, 29.6, 30], [2, 30.9, 38], 'lower_jaw', { rotation: [3, 0, 0], origin: [0, 28.5, 39] });
// Eyes sit in the skull at an angle, following the brow line.
cube('eye_left', [4.2, 33.6, 28], [5.6, 36.6, 30.6], 'eyes', { rotation: [8, 0, 6], origin: [4.9, 35, 29.3] });
cube('eye_right', [-5.6, 33.6, 28], [-4.2, 36.6, 30.6], 'eyes', { rotation: [8, 0, -6], origin: [-4.9, 35, 29.3] });

// teeth
for (const side of [1, -1]) {
  const tag = side > 0 ? 'left' : 'right';
  [33, 36, 39].forEach((z, index) => {
    const x1 = side * 2.8;
    const x2 = side * 4.0;
    cube(`tooth_upper_${tag}_${index}`, [Math.min(x1, x2), 29, z - 0.7], [Math.max(x1, x2), 31, z + 0.7], 'upper_jaw');
  });
  [34.5, 37.5].forEach((z, index) => {
    const x1 = side * 1.9;
    const x2 = side * 2.9;
    cube(`tooth_lower_${tag}_${index}`, [Math.min(x1, x2), 30.5, z - 0.6], [Math.max(x1, x2), 31.9, z + 0.6], 'lower_jaw');
  });
}
cube('tooth_upper_front_left', [1, 29, 40.4], [2.2, 31, 41.6], 'upper_jaw');
cube('tooth_upper_front_right', [-2.2, 29, 40.4], [-1, 31, 41.6], 'upper_jaw');
cube('tooth_lower_front_left', [0.6, 30.5, 38.2], [1.7, 31.9, 39.2], 'lower_jaw');
cube('tooth_lower_front_right', [-1.7, 30.5, 38.2], [-0.6, 31.9, 39.2], 'lower_jaw');

// arms
for (const side of [1, -1]) {
  const tag = side > 0 ? 'left' : 'right';
  const box = (x1, x2) => [Math.min(side * x1, side * x2), Math.max(side * x1, side * x2)];
  const [a1, a2] = box(6.2, 8.2);
  cube(`${tag}_upper_arm`, [a1, 23, 6.6], [a2, 25.6, 9.4], `${tag}_arm`);
  const [b1, b2] = box(6.4, 8.0);
  cube(`${tag}_lower_arm`, [b1, 20.6, 6.9], [b2, 23, 9.2], `${tag}_lower_arm`);
  const [c1, c2] = box(6.4, 7.3);
  const [d1, d2] = box(7.3, 8.0);
  cube(`${tag}_claw_1`, [c1, 19, 7.2], [c2, 20.6, 8.8], `${tag}_claws`);
  cube(`${tag}_claw_2`, [d1, 19, 7.2], [d2, 20.6, 8.8], `${tag}_claws`);
}

// legs
for (const side of [1, -1]) {
  const tag = side > 0 ? 'left' : 'right';
  const box = (x1, x2) => [Math.min(side * x1, side * x2), Math.max(side * x1, side * x2)];
  const [t1, t2] = box(3.4, 8.8);
  const [s1, s2] = box(4.6, 7.9);
  const [f1, f2] = box(4.4, 8.4);
  cube(`${tag}_thigh`, [t1, 9, -7], [t2, 19.6, 3], `${tag}_leg`);
  cube(`${tag}_knee`, [s1, 8.4, -2.6], [s2, 11, 2.6], `${tag}_leg`);
  cube(`${tag}_shin_cube`, [s1, 3.6, -2.4], [s2, 9.6, 2.6], `${tag}_shin`);
  cube(`${tag}_foot`, [f1, 0.4, -1.4], [f2, 4, 6.8], `${tag}_foot`);
  const toe = (i, x1, x2, z2) => {
    const [a, b] = box(x1, x2);
    cube(`${tag}_toe_${i}`, [a, 0, 6.4], [b, 2.8, z2], `${tag}_toes`);
  };
  toe(1, 4.5, 5.7, 9.6);
  toe(2, 5.8, 7.0, 10.2);
  toe(3, 7.1, 8.3, 9.6);
  const [g1, g2] = box(4.5, 5.6);
  // Claws lift off the ground as they point forward, pivoted at the base of each toe.
  cube(`${tag}_toe_claw_1`, [g1, 0, 9.6], [g2, 1.4, 11], `${tag}_toes`, { rotation: [-15, 0, 0], origin: [0, 0, 9.6] });
  const [h1, h2] = box(5.9, 6.9);
  cube(`${tag}_toe_claw_2`, [h1, 0, 10.2], [h2, 1.4, 11.6], `${tag}_toes`, { rotation: [-17, 0, 0], origin: [0, 0, 10.2] });
  const [k1, k2] = box(7.1, 8.2);
  cube(`${tag}_toe_claw_3`, [k1, 0, 9.6], [k2, 1.4, 11], `${tag}_toes`, { rotation: [-15, 0, 0], origin: [0, 0, 9.6] });
}

// tail: seven tapering segments plus a dorsal ridge
const TAIL = [
  [-5.4, 18, -17, 5.4, 27, -9],
  [-4.9, 18.5, -25, 4.9, 26, -17],
  [-4.3, 19, -33, 4.3, 25, -25],
  [-3.6, 19.5, -41, 3.6, 24.5, -33],
  [-2.9, 20, -49, 2.9, 24, -41],
  [-2.1, 20.5, -56, 2.1, 23.5, -49],
  [-1.3, 21, -62, 1.3, 23, -56],
];
TAIL.forEach(([x1, y1, z1, x2, y2, z2], index) => {
  cube(`tail_cube_${index + 1}`, [x1, y1, z1], [x2, y2, z2], `tail_0${index + 1}`);
});
TAIL.slice(0, 5).forEach(([x1, , z1, x2, , z2], index) => {
  const height = 25.2 - index * 0.9;
  // Same sweep as the dorsal scutes, and it lessens toward the tip so the tail reads as
  // flattening out rather than getting progressively spikier.
  cube(`tail_ridge_${index + 1}`, [x1 * 0.3, height, z1], [x2 * 0.3, height + 1.8, z2], `tail_0${index + 1}`, {
    rotation: [-24 + index * 2, 0, 0],
    origin: [0, height, z1 + 1],
  });
});

// A 45° strip sunk into its parent reads as a rounded edge: the torso's back breaks before it
// meets the scutes and the belly is chamfered instead of ending in a flat slab — which is what
// makes the underside look carved from below.
const BEVELS = [
  bevelEdges({ name: 'torso', from: [-7, 17, -9], to: [7, 29, 3], bone: 'body', edges: ['top-left', 'top-right'], chamfer: 3.4, inset: 0.45 }),
  bevelEdges({ name: 'chest_block', from: [-6, 18, 3], to: [6, 30, 13], bone: 'chest', edges: ['top-left', 'top-right'], chamfer: 3, inset: 0.45 }),
  bevelEdges({ name: 'belly_01', from: [-5.6, 16.5, -8], to: [5.6, 19, 2], bone: 'body', edges: ['bottom-left', 'bottom-right'], chamfer: 2.6, inset: 0.35 }),
  bevelEdges({ name: 'belly_02', from: [-5, 16.5, 2], to: [5, 19, 11], bone: 'chest', edges: ['bottom-left', 'bottom-right'], chamfer: 2.4, inset: 0.35 }),
  bevelEdges({ name: 'pelvis', from: [-6.4, 18, -14], to: [6.4, 27, -8], bone: 'body', edges: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], chamfer: 2.6, inset: 0.4 }),
  bevelEdges({ name: 'left_thigh', from: [3.4, 9, -7], to: [8.8, 19.6, 3], bone: 'left_leg', edges: ['front-left', 'front-right'], chamfer: 2.8, inset: 0.45 }),
  bevelEdges({ name: 'right_thigh', from: [-8.8, 9, -7], to: [-3.4, 19.6, 3], bone: 'right_leg', edges: ['front-left', 'front-right'], chamfer: 2.8, inset: 0.45 }),
];
CUBES.push(...BEVELS.flat());

/* ----------------------------------------------------------------- texture -- */

// Only the islands the UV rules actually point at are painted — an unused island would
// add colours to the palette that no face ever samples.
const PALETTE = {
  teeth: [0, 0, 4, 4],
  claw: [4, 0, 8, 4],
  eye_black: [8, 0, 12, 4],
  eye_right: [12, 0, 16, 4],
  mouth: [0, 4, 4, 8],
  tongue: [4, 4, 8, 8],
  eye_left: [8, 4, 12, 8],
  nostril: [12, 4, 16, 8],
  belly: [0, 8, 4, 12],
  scute: [4, 8, 8, 12],
};

// The skin tone every green material is derived from.
const SKIN_BASE = [176, 199, 117];

// Body greens are *derived* from the skin rather than picked separately, then pulled onto a
// shared hue. Choosing the belly independently is how a light olive back ends up meeting a
// swamp-green underside at the ribcage: two plausible colours that were never related. Here
// the belly is the same pigment darker, and the hue pass only has to tidy up the remainder —
// lightness and saturation are left untouched, so the underside still reads as shaded.
const [SKIN, BELLY, SCUTE, NOSTRIL] = harmonize(
  [
    SKIN_BASE,
    deriveShade(SKIN_BASE, { lightness: -0.16, saturation: 0.95, hueShift: 6 }),
    deriveShade(SKIN_BASE, { lightness: -0.07, saturation: 1.2, hueShift: 4 }),
    deriveShade(SKIN_BASE, { lightness: -0.3, saturation: 1.15 }),
  ],
  { strength: 0.4 },
);

const ISLAND_COLOR = {
  teeth: '#f4efd8',
  claw: '#2e2b26',
  eye_black: '#0d0d0d',
  eye_left: '#e8a33d',
  eye_right: '#e8a33d',
  mouth: '#7e3040',
  tongue: '#c46a78',
  nostril: rgbToHex(NOSTRIL),
  belly: rgbToHex(BELLY),
  scute: rgbToHex(SCUTE),
};

// The under-parts carry less contrast than the back, so the chamfered belly does not end up
// with a dark edge band that reads as dirt.
const ISLAND_CONTRAST = { belly: 0.2, scute: 0.34, nostril: 0.26 };

function buildAtlas() {
  const atlas = new Atlas(64, 64);
  // The skin field: a tall region every generic face samples, light at the top.
  atlas.define('skin', [16, 0, 64, 64]);
  // Six wide, clearly separated bands: a face window is small enough that it usually
  // crosses one boundary, giving the base + one shade the metric looks for.
  bands(atlas.canvas, atlas.get('skin'), SKIN, {
    steps: 8,
    contrast: 0.5,
    axis: 'vertical',
  });

  for (const [name, rect] of Object.entries(PALETTE)) {
    atlas.define(name, rect);
    const color = ISLAND_COLOR[name];
    bands(atlas.canvas, rect, hexRgb(color), {
      steps: name.startsWith('eye') ? 1 : 4,
      contrast: ISLAND_CONTRAST[name] ?? 0.3,
      axis: 'vertical',
    });
  }
  // eyes get a pupil
  for (const [name, mirror] of [['eye_left', false], ['eye_right', true]]) {
    const [x1, y1, x2, y2] = PALETTE[name];
    const cx = Math.round((x1 + x2) / 2) + (mirror ? -1 : 0);
    const cy = Math.round((y1 + y2) / 2);
    for (let y = cy - 1; y <= cy; y += 1) {
      for (let x = cx - 1; x <= cx; x += 1) atlas.canvas.set(x, y, [13, 13, 13, 255]);
    }
    for (let x = x1; x < x2; x += 1) atlas.canvas.set(x, y1, [92, 66, 24, 255]);
  }
  return atlas;
}

function hexRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/* -------------------------------------------------------------- animations -- */

const rig = defaultMotionRig(7);
const NEUTRAL = {
  body: [0, 0, 0],
  chest: [0, 0, 0],
  head: [0, 0, 0],
  lower_jaw: [0, 0, 0],
  left_arm: [0, 0, 0],
  right_arm: [0, 0, 0],
  left_lower_arm: [-16, 0, 0],
  right_lower_arm: [-16, 0, 0],
  left_leg: [0, 0, 0],
  right_leg: [0, 0, 0],
  left_shin: [4, 0, 0],
  right_shin: [4, 0, 0],
};

const neck = (x, y = 0) => ({ neck_01: [x, y, 0], neck_02: [x * 0.7, y * 0.7, 0] });

function oneShot(name, length, entries) {
  return clip({ name, loop: 'once', length, keys: pose(entries) });
}

function buildClips() {
  const clips = [];
  clips.push(clip({ name: 'idle', length: 4, keys: idleSway({ rig, length: 4, samples: 8 }) }));
  clips.push(clip({ name: 'breathe', length: 3, keys: breathe({ rig, length: 3, samples: 6 }) }));
  clips.push(clip({ name: 'tail_sway', length: 3, keys: tailWave({ rig, length: 3, samples: 9, sway: 6, growth: 2.6 }) }));
  clips.push(
    clip({
      name: 'walk',
      length: 1,
      keys: locomotion({ rig, length: 1, stride: 22, knee: 30, bob: 0.7, lean: 2, tailLift: 2, armSwing: 14, headDrop: -1, samples: 8 }),
    }),
  );
  clips.push(
    clip({
      name: 'run',
      length: 0.72,
      keys: locomotion({ rig, length: 0.72, stride: 36, knee: 48, bob: 1.2, lean: 7, tailLift: 6, armSwing: 28, headDrop: -3, samples: 8 }),
    }),
  );
  clips.push(
    clip({
      name: 'sprint',
      length: 0.55,
      keys: locomotion({ rig, length: 0.55, stride: 44, knee: 56, bob: 1.5, lean: 12, tailLift: 9, armSwing: 34, headDrop: -5, samples: 8 }),
    }),
  );
  clips.push(clip({ name: 'angry_idle', length: 2.6, keys: idleSway({ rig, length: 2.6, samples: 10, sway: 3.4, sink: 0.8, headScan: 2 }) }));
  clips.push(clip({ name: 'look', length: 2.4, keys: idleSway({ rig, length: 2.4, samples: 8, sway: 2, headScan: 8 }) }));
  clips.push(clip({ name: 'look_left', length: 0.9, keys: headTurn({ rig, direction: 1, length: 0.9 }) }));
  clips.push(clip({ name: 'look_right', length: 0.9, keys: headTurn({ rig, direction: -1, length: 0.9 }) }));
  clips.push(clip({ name: 'tail_whip', length: 0.9, keys: tailWave({ rig, length: 0.9, samples: 10, sway: 40, growth: 4, lag: 0.045, frequency: 2 }) }));

  clips.push(
    oneShot('attack', 0.95, [
      { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
      { time: 0.18, rotations: { ...neck(16), body: [-10, 0, 0], lower_jaw: [8, 0, 0], left_leg: [-8, 0, 0], right_leg: [6, 0, 0] }, positions: { body: [0, -1, -1] } },
      { time: 0.34, rotations: { ...neck(-18), body: [12, 0, 0], lower_jaw: [16, 0, 0], left_leg: [-14, 0, 0], right_leg: [12, 0, 0] }, positions: { body: [0, 0.4, 1.4] } },
      { time: 0.46, rotations: { ...neck(-20), body: [15, 0, 0], lower_jaw: [40, 0, 0] }, positions: { body: [0, 0, 1.8] }, interpolation: 'linear' },
      { time: 0.52, rotations: { lower_jaw: [0, 0, 0], ...neck(-16) }, interpolation: 'linear' },
      { time: 0.95, rotations: { ...NEUTRAL }, positions: { body: [0, 0, 0] }, interpolation: 'linear' },
    ]),
  );
  clips.push(
    oneShot('bite', 0.62, [
      { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
      { time: 0.15, rotations: { ...neck(10), body: [-5, 0, 0] } },
      { time: 0.24, rotations: { lower_jaw: [34, 0, 0], ...neck(8) } },
      { time: 0.36, rotations: { ...neck(-16), body: [8, 0, 0], lower_jaw: [40, 0, 0] } },
      { time: 0.44, rotations: { lower_jaw: [0, 0, 0] }, interpolation: 'linear' },
      { time: 0.62, rotations: { ...NEUTRAL }, interpolation: 'linear' },
    ]),
  );
  clips.push(
    oneShot('roar', 1.7, [
      { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
      { time: 0.4, rotations: { body: [-5, 0, 0], ...neck(-14), lower_jaw: [10, 0, 0] }, positions: { body: [0, 0.6, -0.4] } },
      { time: 0.7, rotations: { body: [-7, 0, 0], ...neck(-19), lower_jaw: [42, 0, 0] }, positions: { body: [0, 1, -0.6] } },
      { time: 1.15, rotations: { ...neck(-19), lower_jaw: [41, 0, 0] } },
      { time: 1.45, rotations: { body: [-2, 0, 0], ...neck(-8), lower_jaw: [8, 0, 0] }, positions: { body: [0, 0.3, 0] } },
      { time: 1.7, rotations: { ...NEUTRAL }, positions: { body: [0, 0, 0] }, interpolation: 'linear' },
    ]),
  );
  clips.push(
    oneShot('roar_aggressive', 2, [
      { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
      { time: 0.25, rotations: { body: [-9, 0, 0], ...neck(12), lower_jaw: [6, 0, 0] }, positions: { body: [0, -1.4, -1.4] } },
      { time: 0.5, rotations: { body: [10, 0, 0], ...neck(-24), lower_jaw: [48, 0, 0] }, positions: { body: [0, 1.6, 2] } },
      { time: 1.3, rotations: { lower_jaw: [4, 0, 0] }, interpolation: 'linear' },
      { time: 1.55, rotations: { body: [6, 0, 0], ...neck(-14), lower_jaw: [22, 0, 0] }, positions: { body: [0, 0.6, 1] } },
      { time: 2, rotations: { ...NEUTRAL }, positions: { body: [0, 0, 0] }, interpolation: 'linear' },
    ]),
  );
  clips.push(
    oneShot('hurt', 0.5, [
      { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
      { time: 0.07, rotations: { body: [-16, 6, 0], ...neck(14, 6), head: [12, 8, 0], lower_jaw: [14, 0, 0] }, positions: { body: [0, 0.6, -2.2] }, interpolation: 'linear' },
      { time: 0.2, rotations: { body: [6, -2, 0], ...neck(-6, -2), lower_jaw: [4, 0, 0] }, positions: { body: [0, -0.2, 0.6] } },
      { time: 0.5, rotations: { ...NEUTRAL }, positions: { body: [0, 0, 0] }, interpolation: 'linear' },
    ]),
  );
  clips.push(
    oneShot('jump', 1.15, [
      { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
      { time: 0.18, rotations: { left_leg: [-30, 0, 0], right_leg: [-28, 0, 0], left_shin: [56, 0, 0], right_shin: [54, 0, 0], left_foot: [-22, 0, 0], right_foot: [-22, 0, 0], left_arm: [30, 0, 0], right_arm: [30, 0, 0], ...neck(8) }, positions: { body: [0, -3.6, -0.6] }, interpolation: 'linear' },
      { time: 0.3, rotations: { left_leg: [26, 0, 0], right_leg: [28, 0, 0], left_arm: [-46, 0, 0], right_arm: [-46, 0, 0], ...neck(-8) }, positions: { body: [0, 4.4, 0] } },
      { time: 0.5, rotations: { left_leg: [-18, 0, 0], right_leg: [-10, 0, 0], left_arm: [-58, 0, 0], right_arm: [-54, 0, 0] }, positions: { body: [0, 6, 0] } },
      { time: 1.02, rotations: { body: [8, 0, 0], left_leg: [-16, 0, 0], right_leg: [-14, 0, 0], left_shin: [40, 0, 0], right_shin: [38, 0, 0] }, positions: { body: [0, -3, 0] }, interpolation: 'linear' },
      { time: 1.15, rotations: { ...NEUTRAL }, positions: { body: [0, 0, 0] }, interpolation: 'linear' },
    ]),
  );
  clips.push(
    oneShot('fall', 1, [
      { time: 0, rotations: { body: [3, 0, 0], ...neck(-6), left_leg: [-14, 0, 0], right_leg: [-7, 0, 0], left_arm: [-24, 0, 0], right_arm: [-20, 0, 0] }, positions: { body: [0, 4.2, 0] } },
      { time: 0.5, rotations: { body: [4, 0, 0], ...neck(-6, 4), left_arm: [-30, 0, 0], right_arm: [-14, 0, 0] }, positions: { body: [0, 4.9, 0] } },
      { time: 1, rotations: { body: [3, 0, 0], ...neck(-6), left_arm: [-24, 0, 0], right_arm: [-20, 0, 0] }, positions: { body: [0, 4.2, 0] } },
    ]),
  );
  clips.push(
    oneShot('land', 0.7, [
      { time: 0, rotations: { body: [2, 0, 0], ...neck(-4), left_leg: [-8, 0, 0], right_leg: [-6, 0, 0] }, positions: { body: [0, 2, 0] }, interpolation: 'linear' },
      { time: 0.12, rotations: { body: [11, 0, 0], ...neck(10), lower_jaw: [12, 0, 0], left_leg: [-24, 0, 0], right_leg: [-22, 0, 0], left_shin: [46, 0, 0], right_shin: [44, 0, 0] }, positions: { body: [0, -3.2, 0] }, interpolation: 'linear' },
      { time: 0.3, rotations: { body: [-3, 0, 0], ...neck(-4), lower_jaw: [3, 0, 0] }, positions: { body: [0, 0.5, 0] } },
      { time: 0.7, rotations: { ...NEUTRAL }, positions: { body: [0, 0, 0] }, interpolation: 'linear' },
    ]),
  );
  clips.push(
    oneShot('death', 3.4, [
      { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
      { time: 0.45, rotations: { body: [-7, 9, 0], ...neck(10, 6), lower_jaw: [10, 0, 0] }, positions: { body: [0, 0.4, -1] } },
      { time: 1.7, rotations: { body: [12, 26, 22], ...neck(30, 10), lower_jaw: [24, 0, 0], left_leg: [34, 0, 0], right_leg: [44, 0, 0] }, positions: { body: [0, -6, -2] } },
      { time: 2.3, rotations: { body: [15, 33, 30], ...neck(38, 10), lower_jaw: [27, 0, 0], left_shin: [72, 0, 0], right_shin: [68, 0, 0] }, positions: { body: [0, -9, -2.4] }, interpolation: 'linear' },
      { time: 3.4, rotations: { body: [14, 34, 31], ...neck(40, 10), lower_jaw: [23, 0, 0] }, positions: { body: [0, -9.8, -2.5] }, interpolation: 'linear' },
    ]),
  );
  clips.push(
    oneShot('eating', 1.8, [
      { time: 0, rotations: { body: [4, 0, 0], ...neck(24), head: [10, 0, 0], lower_jaw: [4, 0, 0] }, interpolation: 'linear' },
      { time: 0.3, rotations: { ...neck(30, 4), head: [13, 3, 0], lower_jaw: [10, 0, 0] }, positions: { body: [0, -0.6, 0.6] } },
      { time: 0.5, rotations: { lower_jaw: [34, 0, 0], head: [14, 4, 0] }, interpolation: 'linear' },
      { time: 0.7, rotations: { lower_jaw: [2, 0, 0], head: [12, -3, 0] }, interpolation: 'linear' },
      { time: 1.0, rotations: { lower_jaw: [30, 0, 0], head: [13, 5, 0] }, interpolation: 'linear' },
      { time: 1.45, rotations: { ...neck(26, 6), head: [11, 6, 0], lower_jaw: [8, 0, 0] } },
      { time: 1.8, rotations: { body: [4, 0, 0], ...neck(24), head: [10, 0, 0], lower_jaw: [4, 0, 0] }, interpolation: 'linear' },
    ]),
  );
  clips.push(
    oneShot('sniff', 1, [
      { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
      { time: 0.2, rotations: { ...neck(-14), body: [-3, 0, 0] }, positions: { body: [0, 0.4, 0] } },
      { time: 0.34, rotations: { lower_jaw: [10, 0, 0], head: [-10, 4, 0] }, interpolation: 'linear' },
      { time: 0.5, rotations: { lower_jaw: [13, 0, 0], head: [-10, -3, 0] }, interpolation: 'linear' },
      { time: 0.75, rotations: { ...neck(-12, -12), head: [-8, -14, 0] } },
      { time: 1, rotations: { ...NEUTRAL }, interpolation: 'linear' },
    ]),
  );
  clips.push(
    oneShot('threaten', 1.5, [
      { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
      { time: 0.3, rotations: { body: [-8, 0, 0], ...neck(-21), lower_jaw: [18, 0, 0], left_arm: [-26, 0, 0], right_arm: [-26, 0, 0] }, positions: { body: [0, 1.8, -1] } },
      { time: 0.45, rotations: { ...neck(-23), lower_jaw: [46, 0, 0] } },
      { time: 1.12, rotations: { body: [10, 0, 0], ...neck(16), lower_jaw: [6, 0, 0] }, positions: { body: [0, -0.5, 1.6] }, interpolation: 'linear' },
      { time: 1.5, rotations: { ...NEUTRAL }, positions: { body: [0, 0, 0] }, interpolation: 'linear' },
    ]),
  );
  const makeTurn = (name, s) =>
    oneShot(name, 1.3, [
      { time: 0, rotations: { ...NEUTRAL }, interpolation: 'linear' },
      { time: 0.55, rotations: { body: [0, 30 * s, 0], head: [-3, 18 * s, 0], left_leg: [12 * s, 0, 0], right_leg: [-18 * s, 0, 0] }, positions: { body: [0, 0.4, 0] } },
      { time: 1.1, rotations: { body: [0, 40 * s, 0], head: [0, 4 * s, 0] } },
      { time: 1.3, rotations: { body: [0, 40 * s, 0] }, interpolation: 'linear' },
    ]);
  clips.push(makeTurn('turn_left', 1));
  clips.push(makeTurn('turn_right', -1));
  return clips;
}

/* -------------------------------------------------------------------- run -- */

/**
 * @param {{ style?: 'sharp'|'balanced'|'soft', soften?: boolean, hygiene?: boolean }} [options]
 *   `style` drives how hard the surface passes push: `sharp` leaves every join crisply voxel,
 *   `soft` bridges wider bands. Both the geometry cleanup and the seam pass can be turned off
 *   to compare a build against itself.
 */
export function buildTrex(options = {}) {
  const atlas = buildAtlas();
  const model = new Model({
    name: 'trex',
    resolution: [64, 64],
    identifier: 'geometry.trex',
    uvPolicy: {
      rules: islandRules(atlas, [
        { island: 'eye_left', exact: 'eye_left', face: 'east' },
        { island: 'eye_right', exact: 'eye_right', face: 'west' },
        { island: 'teeth', prefix: 'tooth_' },
        { island: 'claw', prefix: 'toe_claw' },
        { island: 'claw', suffix: '_claw_1' },
        { island: 'claw', suffix: '_claw_2' },
        { island: 'claw', prefix: 'toe_' },
        { island: 'tongue', exact: 'tongue' },
        { island: 'nostril', prefix: 'nostril' },
        { island: 'belly', prefix: 'belly' },
        { island: 'scute', prefix: 'ridge_' },
        { island: 'scute', prefix: 'tail_ridge' },
        { island: 'mouth', exact: 'lower_jaw_cube', face: 'up' },
        { island: 'mouth', exact: 'snout', face: 'down' },
        { island: 'mouth', exact: 'nose_tip', face: 'down' },
        { island: 'belly', exact: 'lower_jaw_cube', face: 'down' },
        { island: 'belly', exact: 'torso', face: 'down' },
        { island: 'belly', exact: 'chest_block', face: 'down' },
        { island: 'belly', prefix: 'neck_cube', face: 'down' },
        { island: 'eye_black', prefix: 'eye_' },
      ]),
      fallback: skinFieldPolicy({ region: [16, 0, 64, 64], heightReference: 38, litFromAbove: true }),
    },
  });

  for (const [name, pivot, parent] of GROUPS) model.bone(name, pivot, parent);
  for (const spec of CUBES) model.cube(spec);
  model.addTexture(atlas.toTexture('trex_skin', { useAsDefault: true }));
  for (const entry of buildClips()) model.addClip(entry);

  // UVs first: hygiene hides faces, and a hidden face still needs its window assigned so the
  // exporter writes a complete element.
  model.assignUv();

  // Every bevel and every scute sits flush against its parent, which is exactly the situation
  // that makes the waist shimmer as the model turns: two faces on one plane, the renderer
  // picking a different winner per pixel. This hides whichever of them is fully covered.
  const hygiene = options.hygiene === false
    ? { report: { pairs: [], duplicates: [] }, resolved: [] }
    : geometricHygiene(model, { mode: 'hide' });

  // Then bridge the colour joins that remain across cube boundaries. Only joins between
  // *different* materials are touched, so the banding inside the skin ramp survives.
  const seams = options.soften === false
    ? { pairs: 0, blended: 0, pixels: 0, softness: 0, strength: 0 }
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

  const { model, hygiene, seams } = buildTrex();
  model.assignUv();

  console.log(formatCoincidence(hygiene.report));
  console.log(`  → ${hygiene.resolved.length} face(s) hidden to stop z-fighting`);
  console.log(`  → ${seams.pixels} texture pixel(s) bridged across ${seams.blended} seam(s)`);
  if (seams.sharedJoins > 0) {
    console.log(`  → ${seams.sharedJoins} material(s) left alone (joins on shared atlas islands)`);
  }
  const remaining = findCoincidentFaces(model);
  console.log(`  → ${remaining.pairs.length} coincident pair(s) remain after hygiene`);

  const report = validate(model, { warnOnEmptyBones: true });
  console.log(formatReport(report));
  if (!report.ok) process.exitCode = 1;

  const bbmodel = writeBbmodel(model, path.join(outDir, 'trex.bbmodel'));
  console.log(`→ ${bbmodel}`);
  const java = writeJavaModel(model, path.join(outDir, 'java'));
  console.log(`→ ${java.modelPath}`);
  if (java.texturePath) console.log(`→ ${java.texturePath}`);

  const sheet = contactSheet(model, { width: 220, height: 220, outline: true });
  console.log(`→ ${writeBinary(path.join(outDir, 'trex_preview.png'), sheet.toPng())}`);

  console.log(formatMetrics(metrics(model)));
}

if (import.meta.url === `file://${path.resolve(process.argv[1] ?? '').replace(/\\/g, '/')}` || process.argv[1]?.endsWith('trex.mjs')) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export default buildTrex;
