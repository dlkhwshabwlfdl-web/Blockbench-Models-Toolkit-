#!/usr/bin/env node
/**
 * Fire Dragon — a large boss creature, quadruped, half-folded wings, built with rotation and
 * bevels from the first line.
 *
 * Two things drive every decision here.
 *
 * **Joins.** Adjacent parts deliberately *overlap* rather than abut. Two boxes that merely touch
 * share a plane, which is the coincidence case the rasteriser cannot resolve consistently — and
 * once a part rotates (a jaw, a wing, a tail segment) a touching join opens into a visible gap.
 * Every joint below is built with 1–3 units of interpenetration, so the silhouette stays closed
 * through the whole animation range. `geometricHygiene` then removes the now-buried duplicate
 * faces.
 *
 * **Fire.** The palette is one ten-step ramp from deep maroon to yellow-orange. Each material
 * region samples a *sub-range* of it — outer scales the cold end, lit ridges the middle, belly
 * and inner wing the warm end, a few hot-spot faces the top — so every surface is shaded in the
 * same family and nothing reads as a noise texture. Band width comes from the ramp length, not
 * from dithering.
 *
 *   node examples/firedragon/firedragon.mjs --out ./out
 */
import path from 'node:path';
import {
  Atlas,
  Model,
  auditSeal,
  bevelEdges,
  clip,
  contactSheet,
  cycle,
  deriveShade,
  eye as eyeBrush,
  findBuriedFaces,
  formatOcclusion,
  formatCoincidence,
  formatMetrics,
  formatReport,
  formatSeal,
  geometricHygiene,
  idleSway,
  islandRules,
  locomotion,
  metrics,
  pose,
  skinFieldPolicy,
  softenSeams,
  tailWave,
  validate,
  writeBbmodel,
  writeBinary,
  writeJavaModel,
} from '../../dist/index.js';

/* ------------------------------------------------------------------ bones -- */

// +X is the model's left, +Y is up with the feet at y = 0, and the model faces +Z.
const GROUPS = [
  ['root', [0, 0, 0], null],
  ['hips', [0, 24, -14], 'root'],
  ['spine', [0, 24, -2], 'hips'],
  ['chest', [0, 26, 10], 'spine'],
  ['neck_01', [0, 30, 18], 'chest'],
  ['neck_02', [0, 33, 24], 'neck_01'],
  ['neck_03', [0, 36, 30], 'neck_02'],
  ['head', [0, 38, 36], 'neck_03'],
  ['jaw', [0, 34.5, 38], 'head'],
  ['eyes', [0, 41, 39], 'head'],

  // Horns: two segments each, swept back and out from the skull. Both pivots sit *inside* the
  // mesh — a hinge at the surface tears the base off the skull the moment the bone rotates.
  ['horn_left_01', [3.2, 42.4, 37.4], 'head'],
  ['horn_left_02', [4.6, 46.5, 33.8], 'horn_left_01'],
  ['horn_right_01', [-3.2, 42.4, 37.4], 'head'],
  ['horn_right_02', [-4.6, 46.5, 33.8], 'horn_right_01'],

  // Wing. These pivots are the *joints the boxes actually share* — see the wing section — because
  // a hinge anywhere else means an animated wing tears itself apart at the seams.
  ['wing_left_01', [8, 30, 10], 'chest'],
  ['wing_left_02', [15.5, 38.5, 1], 'wing_left_01'],
  ['wing_left_03', [20, 45, -10], 'wing_left_02'],
  ['wing_left_04', [21, 40, -19], 'wing_left_03'],
  ['wing_right_01', [-8, 30, 10], 'chest'],
  ['wing_right_02', [-15.5, 38.5, 1], 'wing_right_01'],
  ['wing_right_03', [-20, 45, -10], 'wing_right_02'],
  ['wing_right_04', [-21, 40, -19], 'wing_right_03'],  ...[ 
    ['tail_01', -19], ['tail_02', -27], ['tail_03', -33.75], ['tail_04', -40.25],
    ['tail_05', -46.25], ['tail_06', -51.75], ['tail_07', -56.75], ['tail_08', -61.25],
  ].map(([name, z], index, all) => [name, [0, 24, z], index === 0 ? 'hips' : all[index - 1][0]]),

  ['front_leg_left', [9, 28, 11], 'chest'],
  ['front_shin_left', [9, 18, 11.5], 'front_leg_left'],
  ['front_foot_left', [9, 7, 10], 'front_shin_left'],
  ['front_toes_left', [9, 2.5, 14], 'front_foot_left'],
  ['front_leg_right', [-9, 28, 11], 'chest'],
  ['front_shin_right', [-9, 18, 11.5], 'front_leg_right'],
  ['front_foot_right', [-9, 7, 10], 'front_shin_right'],
  ['front_toes_right', [-9, 2.5, 14], 'front_foot_right'],
  ['hind_leg_left', [9, 26, -12], 'hips'],
  ['hind_shin_left', [9, 16, -13], 'hind_leg_left'],
  ['hind_foot_left', [9, 6, -12], 'hind_shin_left'],
  ['hind_toes_left', [9, 2.5, -6], 'hind_foot_left'],
  ['hind_leg_right', [-9, 26, -12], 'hips'],
  ['hind_shin_right', [-9, 16, -13], 'hind_leg_right'],
  ['hind_foot_right', [-9, 6, -12], 'hind_shin_right'],
  ['hind_toes_right', [-9, 2.5, -6], 'hind_foot_right'],
];

const NECK = ['neck_01', 'neck_02', 'neck_03'];
const TAIL = ['tail_01', 'tail_02', 'tail_03', 'tail_04', 'tail_05', 'tail_06', 'tail_07', 'tail_08'];
const WING_LEFT = ['wing_left_01', 'wing_left_02', 'wing_left_03', 'wing_left_04'];
const WING_RIGHT = ['wing_right_01', 'wing_right_02', 'wing_right_03', 'wing_right_04'];

/* ------------------------------------------------------------------ cubes -- */

const CUBES = [];
const cube = (name, from, to, bone, transform) =>
  CUBES.push({ name, from, to, bone, ...(transform ?? {}) });

/** Swap the `left` token wherever it appears: `left_horn_01` and `wing_left_03` both flip. */
const flipSide = (name) => name.replace(/(^|_)left(_|$)/g, '$1right$2');

/**
 * Mirror a part across X = 0 — geometry, bone name **and rotation signs**.
 *
 * Mirroring flips the sense of a rotation about Y and Z and leaves X alone, and it mirrors the
 * rotation origin too. `mirrorPair()` copies the angles verbatim, which is fine for a symmetric
 * box and wrong for anything angled: a half-folded left wing leans outward on −Y, and copying
 * that to the right wing folds it inward, through the body.
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

/** Register a left part and its mirror in one call. */
function pair(spec) {
  CUBES.push(spec, mirrorX(spec));
}

/* -- torso ------------------------------------------------------------------ */
//
// Each block overlaps its neighbour by 2 units so the join closes and stays closed when the
// spine flexes.

cube('hips_block', [-8, 20, -20], [8, 34, -6], 'hips');
cube('spine_block', [-9, 19, -8], [9, 35, 6], 'spine');
cube('chest_block', [-10, 20, 4], [10, 38, 18], 'chest');
// The paler underside, tucked under the three blocks and protruding 3 units below them.
cube('belly_front', [-6.6, 17, 2], [6.6, 22, 17], 'spine');
cube('belly_rear', [-6.8, 17, -14], [6.8, 22, 3], 'hips');

// Shoulder and haunch masses. Both interpenetrate the torso by 3 units, so widening the chest
// never opens a seam.
pair({ name: 'left_shoulder_mass', from: [8, 27, 5], to: [13, 37, 18], bone: 'chest', rotation: [0, 0, -6], origin: [9, 29, 7] });
pair({ name: 'left_haunch_mass', from: [5.8, 23, -19], to: [12.4, 33, -7], bone: 'hips', rotation: [0, 0, -4], origin: [7, 25, -15] });

// Dorsal spines, swept back about their own rear edge. Each overlaps the block below it.
// Each spine starts ~3 units *below* the top of the block it sits on. They used to start level
// with it, which left them welded by half a unit or, on the chest, by nothing at all — a row of
// fins balanced on the back rather than rooted in it.
const RIDGE = [
  { name: 'spine_ridge_1', from: [-2.5, 30.5, -19], to: [2.5, 37, -14], bone: 'hips' },
  { name: 'spine_ridge_2', from: [-2.6, 31.5, -13], to: [2.6, 38.5, -8], bone: 'hips' },
  { name: 'spine_ridge_3', from: [-2.6, 31.5, -6.5], to: [2.6, 39, -1], bone: 'spine' },
  { name: 'spine_ridge_4', from: [-2.5, 32, 0], to: [2.5, 40, 5.5], bone: 'spine' },
  { name: 'spine_ridge_5', from: [-2.3, 34, 7], to: [2.3, 42.5, 12], bone: 'chest' },
  { name: 'spine_ridge_6', from: [-2, 34.5, 13], to: [2, 43, 17.5], bone: 'chest' },
];
RIDGE.forEach((spec, index) => {
  cube(spec.name, spec.from, spec.to, spec.bone, {
    rotation: [-30 - index * 3, 0, 0],
    origin: [0, spec.from[1], spec.from[2] + 1.5],
  });
});

/* -- neck ------------------------------------------------------------------- */
//
// Three thick segments that overlap each other by 2 units in z and 3 in y, so the neck can coil
// without ever showing a gap between links.

cube('neck_cube_01', [-6, 26, 16], [6, 36, 23], 'neck_01');
cube('neck_cube_02', [-5.2, 29, 21], [5.2, 39, 28], 'neck_02');
cube('neck_cube_03', [-4.4, 32, 26], [4.4, 42, 33], 'neck_03');
// A single crest of plates up the midline of the neck — one blade per segment, swept back.
// Paired spines down both sides read as a row of beads from behind; a crest reads as a ridge.
[0, 1, 2].forEach((index) => {
  cube(
    `neck_crest_${index}`,
    [-1.5, 34 + index * 3, 16.5 + index * 5],
    [1.5, 38.4 + index * 3, 22.5 + index * 5],
    NECK[index],
    { rotation: [-40, 0, 0], origin: [0, 35 + index * 3, 17.5 + index * 5] },
  );
});

/* -- head ------------------------------------------------------------------- */

cube('skull', [-5.5, 34, 31], [5.5, 44, 42], 'head');
// A heavy brow over the eyes, pivoted at its back so the front drops and shades them.
cube('brow', [-5.2, 40, 34.5], [5.2, 44, 43], 'head', { rotation: [9, 0, 0], origin: [0, 41, 35] });
// Snout starts at z 39 rather than 41: against the skull's back face at z 42 that is 3 units of
// overlap instead of 1, and the muzzle is where a 1-unit join is most visible because the head is
// the part everything looks at.
cube('snout', [-4.2, 35, 39], [4.2, 42, 50], 'head');
// Muzzle drops at the tip; the buried back end of the box stays put.
cube('nose_tip', [-3.4, 35.6, 46.5], [3.4, 41, 54.5], 'head', { rotation: [8, 0, 0], origin: [0, 38, 46.5] });
// Reaches x 3.9, past the nose tip's 3.4, so it breaks the surface. Tucked inside the snout it was
// a nostril nobody could see, which the gate reported as a hidden cube.
pair({ name: 'left_nostril', from: [2, 38.6, 50], to: [3.9, 40.2, 52], bone: 'head' });
// Cheek plates give the head a jawline instead of flat sides. They start at z 41, *behind* the
// eye: a plate reaching forward to z 38 runs its outer surface to x 5.9 and swallows a eye at
// x 5.25 whole — the eye is then present, textured, and completely invisible.
pair({ name: 'left_cheek_plate', from: [4, 35.5, 41], to: [5.9, 41, 48], bone: 'head', rotation: [0, -9, 0], origin: [5, 38, 41] });
pair({ name: 'left_ear_frill', from: [4.4, 40.5, 33.5], to: [6.1, 45.5, 38.5], bone: 'head', rotation: [-30, 0, -22], origin: [4.8, 41, 34.5] });
// A nose horn and a pair of cheek horns, so the head has three lines of silhouette instead of one.
cube('nose_horn', [-1.6, 39.5, 46.5], [1.6, 46.6, 50.5], 'head', { rotation: [-26, 0, 0], origin: [0, 42, 47] });
// The cheek horn reaches x 6.0 and no further. The eye's outward face is at x 6.5, and an eye is
// only as visible as the widest thing beside it: at x 6.8 this horn hid the whole eye while
// leaving the model structurally perfect and the quality score at 93.
pair({ name: 'left_cheek_horn', from: [3.8, 37.5, 44.5], to: [6, 42, 49], bone: 'head', rotation: [-50, 0, -14], origin: [4.2, 38, 45] });
pair({ name: 'left_jaw_horn', from: [2.4, 31.8, 44], to: [5.2, 36, 48.5], bone: 'jaw', rotation: [-46, 0, -12], origin: [2.8, 32.3, 44.5] });

// Lower jaw. It runs from y 31 to 37, so it interpenetrates the skull (34..44) by 3 units and
// stays sealed through the full 45° of the roar.
// The jaw has to be *two* boxes, and the reason is the mouth line.
//
// It used to be one box spanning y 31..37, which reached above the upper teeth — so the upper row
// was inside the lower jaw and invisible from every angle, with the mouth closed or open. Splitting
// it into a hinge block that rises into the skull (y 31.5..37, giving the weld something to bite on)
// and a jaw proper that stops at y 33.6 leaves a 1.8-unit mouth line for the teeth to sit in.
cube('jaw_hinge', [-3.8, 31.5, 33], [3.8, 37, 40], 'jaw');
cube('lower_jaw', [-4, 30.5, 36], [4, 33.6, 51], 'jaw');
cube('jaw_chin', [-3.2, 30.5, 47], [3.2, 33.8, 53], 'jaw');
cube('tongue', [-2.5, 31.4, 37], [2.5, 33.2, 47], 'jaw');
// Jaw spines along the underside of the jaw, proud enough to read from the side.
pair({ name: 'left_jaw_spine_1', from: [2.8, 30.6, 39], to: [4.4, 33.2, 43], bone: 'jaw', rotation: [-20, 0, -14], origin: [3.2, 31.2, 39] });
pair({ name: 'left_jaw_spine_2', from: [2.5, 30.6, 45], to: [4, 33.2, 48.6], bone: 'jaw', rotation: [-24, 0, -12], origin: [2.9, 31.2, 45] });

// Horns: two thick segments each, swept up and back.
// Each horn segment is two boxes sharing one rotation about one origin, so the segment moves as a
// rigid body. The segments overlap their neighbours by 3–4 units in y — the previous version
// overlapped by 0.75 once both ends had rotated, and half a unit is a gap you can see through.
const HORN_1 = [-18, 0, -11];
const HORN_1_ORIGIN = [3.2, 42.4, 37.4];
const HORN_2 = [-30, 0, -10];
const HORN_2_ORIGIN = [4.6, 46.5, 33.8];
pair({ name: 'left_horn_1a', from: [2.4, 40.8, 34.4], to: [5, 46.4, 40.4], bone: 'horn_left_01', rotation: HORN_1, origin: HORN_1_ORIGIN });
pair({ name: 'left_horn_1b', from: [3.1, 43.2, 31.4], to: [5.9, 49.4, 37.2], bone: 'horn_left_01', rotation: HORN_1, origin: HORN_1_ORIGIN });
pair({ name: 'left_horn_2a', from: [3.9, 45.2, 28.2], to: [6.7, 51, 34.4], bone: 'horn_left_02', rotation: HORN_2, origin: HORN_2_ORIGIN });
pair({ name: 'left_horn_2b', from: [4.9, 48, 24.8], to: [7.4, 52.8, 30.8], bone: 'horn_left_02', rotation: HORN_2, origin: HORN_2_ORIGIN });
// Starts at x 4 rather than 4.4: against a skull edge at 5.5 that is a 1.5-unit weld instead of
// half a unit, and it still emerges 1.1 units proud so it can be seen.
pair({ name: 'left_head_spike', from: [4, 40.5, 32.5], to: [6.6, 43.2, 36.5], bone: 'head', rotation: [-40, 0, -14], origin: [4.4, 41, 33] });

// A dark rim, then the eye proud of it. The rim reaches x 6.0 against a skull edge at 5.5, and
// the eye reaches 6.5 — two visible steps out from the head, each wide enough to read at the
// render sizes this model is actually viewed at.
pair({ name: 'left_eye_socket', from: [3.8, 37.6, 37.2], to: [6.2, 42.4, 43.4], bone: 'head', rotation: [6, 0, 5], origin: [5.2, 40, 37.8] });
// The eye reaches x 6.7, past the socket (6.2), the cheek plate (5.9) and the skull (5.5), so it is
// the outermost thing on the side of the head and nothing can cover it. Its back sits deep inside
// the socket, which is what keeps the weld above the gate's threshold even though the eye is
// deliberately proud of the surface.
pair({ name: 'left_eye', from: [4.2, 39, 38.8], to: [6.7, 41.8, 42.4], bone: 'head', rotation: [6, 0, 5], origin: [5.4, 40.4, 39] });

// Teeth: a long upper row along the lip and a shorter lower row. Each tooth runs 1.4–1.8 units up
// into the bone that carries it and pokes its tip past the far side, so it is welded and visible at
// the same time.
for (const side of [1, -1]) {
  const tag = side > 0 ? 'left' : 'right';
  [42.5, 45, 47.5, 49.5].forEach((z, index) => {
    const x1 = side * 2.6;
    const x2 = side * 3.9;
    const tip = 33.8 + index * 0.22;
    cube(`tooth_upper_${tag}_${index}`, [Math.min(x1, x2), tip, z - 0.85], [Math.max(x1, x2), 36.6, z + 0.85], 'head');
  });
  [43.5, 46, 48].forEach((z, index) => {
    const x1 = side * 2;
    const x2 = side * 3.1;
    // Every lower tip clears the jaw's top face at y 33.6. At 33.7 the third one sat 0.1 above it
    // and was invisible, which is exactly the kind of half-unit miss the gate is for.
    const tip = 34.4 - index * 0.2;
    cube(`tooth_lower_${tag}_${index}`, [Math.min(x1, x2), 31.6, z - 0.75], [Math.max(x1, x2), tip, z + 0.75], 'jaw');
  });
}

/* -- wings ------------------------------------------------------------------ */
//
// Half-folded: the arm rises out and back to a raised wrist, and the fingers fan backward and
// down from there. Every panel is a thin plate and every strut is a thicker box laid *over* the
// panels, so the struts read as bones on a membrane rather than as more slabs.
//
// The chain overlaps at each joint by 2–3 units, which is what keeps the wing closed as it
// unfolds — a joint that only touches opens into a slit the moment it rotates.

// A half-folded wing is a *tall thin blade lying along the flank*, not a paddle held out
// sideways: the arm sweeps back down the ribs, the forearm doubles up to a peak clear of the
// spine, and the fingers hang folded behind it. Every plate here is 3–4 units thick in x and
// 12–20 in z, so from the side the wing reads as a blade against the body and from the front as
// a pair of fins above the shoulders.
//
// Each plate is also rotated a fraction of its strut's angle, about the strut's own root. A
// panel that shares the strut's rotation exactly swings out with it and opens a slit at the
// joint; one that does not rotate at all stays behind and gets left exposed.

// 01 humerus — the shoulder mass, buried in the chest and the shoulder bulge.
// The four joints the wing is built around. Every box below is placed relative to these, and the
// bones above hinge on them, so the *rotation origin of a box is the joint it shares*.
//
// That is the whole fix. Previously each plate carried its own origin near its own middle, so a
// 20° difference in rotation between two plates swung them past each other: the gate reported the
// hand and its three fingers at 0.00 — not a thin joint, a disjoint pair, five times over on a
// wing that read as a paddle.
const S_SHOULDER = [8, 30, 10];
const S_ELBOW = [15.5, 38.5, 1];
const S_WRIST = [20, 45, -10];
const S_FINGERS = [21, 40, -19];

// 01 humerus — the upper arm mass, buried in the chest and the shoulder bulge at one end.
//
// One box, not two. There was a `left_wing_root` here as well, and the gate reported it as a cube
// with no visible face in any direction: the humerus had grown large enough to contain it whole.
// A part that cannot be seen is not padding, it is geometry and a texture budget spent on nothing.
pair({ name: 'left_wing_humerus', from: [7, 26, -3], to: [17.5, 41, 12], bone: 'wing_left_01', rotation: [0, -14, 12], origin: S_SHOULDER });
// 02 forearm — the leading edge running up and back to the peak. Its box starts well behind the
// elbow, so the share with the humerus straddles the hinge rather than hanging off the far end.
pair({ name: 'left_wing_forearm', from: [10, 31, -14], to: [22, 49, 8], bone: 'wing_left_02', rotation: [0, -22, 6], origin: S_ELBOW });
// 03 hand — the wrist, folded back over the hips.
pair({ name: 'left_wing_hand', from: [15, 36, -26], to: [23, 50, -2], bone: 'wing_left_03', rotation: [0, -32, 4], origin: S_WRIST });
// 04 fingers — three struts fanning back and down from the wrist, splaying outward as they go.
pair({ name: 'left_wing_finger_1', from: [16, 32, -36], to: [23, 47, -16], bone: 'wing_left_04', rotation: [0, -40, 2], origin: S_FINGERS });
pair({ name: 'left_wing_finger_2', from: [14, 25, -40], to: [21, 42, -20], bone: 'wing_left_04', rotation: [0, -46, 0], origin: S_FINGERS });
pair({ name: 'left_wing_finger_3', from: [12, 22, -42], to: [19, 40, -20], bone: 'wing_left_04', rotation: [0, -50, 0], origin: S_FINGERS });

// Membrane: thin plates inside the fan. Each sits on the *same bone as the struts it spans*, so
// the joint it forms is static — it never has to survive relative rotation, only to overlap in the
// rest pose, which the generous extents below guarantee.
pair({ name: 'left_wing_membrane_mid', from: [16.5, 33, -30], to: [19.5, 49, -4], bone: 'wing_left_03', rotation: [0, -30, 5], origin: S_WRIST });
pair({ name: 'left_wing_membrane_tip', from: [14.5, 24, -44], to: [17, 42, -22], bone: 'wing_left_04', rotation: [0, -46, 1], origin: S_FINGERS });

/* -- tail ------------------------------------------------------------------- */
//
// Eight segments sharing one bone each, tapering from a root as thick as the hips to a point.
// Adjacent segments overlap by 2 units on z and stay inside each other's y range.

// Successive segments overlap by 3.5 units on z. They used to overlap by 1, which is why the
// tail read as eight separate blocks: 1 unit of overlap is 0.5 units of material past the join
// plane, and a joint that shallow opens the moment the segment swings.
const TAIL_SEGMENTS = [
  [-7.5, 20, -29, 7.5, 33, -16],
  [-6.8, 20.5, -35.5, 6.8, 31.5, -25],
  [-6, 21, -42, 6, 30, -32],
  [-5.2, 21.5, -48, 5.2, 28.5, -38.5],
  [-4.3, 22, -53.5, 4.3, 27, -44.5],
  // The last three thin out gently. At 25.8 → 24.8 → 24.2 the tip was 0.8 tall, and a 0.8-tall box
  // shares only 0.8 of material with its neighbour however far the two overlap in z: the joint is
  // as thin as the thinner part. A taper has to stay thick enough to hold.
  [-3.4, 22.4, -58.5, 3.4, 26.6, -50],
  [-2.5, 22.8, -63, 2.5, 25.6, -55],
  [-1.6, 23.2, -67, 1.6, 24.8, -59.5],
];
TAIL_SEGMENTS.forEach(([x1, y1, z1, x2, y2, z2], index) => {
  cube(`tail_cube_${index + 1}`, [x1, y1, z1], [x2, y2, z2], TAIL[index]);
});
// The spine row continues down the tail, flattening as it goes.
TAIL_SEGMENTS.forEach(([x1, , z1, x2, , z2], index) => {
  if (index > 5) return;
  const top = TAIL_SEGMENTS[index][4];
  cube(`tail_spine_${index + 1}`, [x1 * 0.26, top - 2.5, z1], [x2 * 0.26, top + 1.6, z2], TAIL[index], {
    rotation: [-26 + index * 3, 0, 0],
    origin: [0, top - 2.5, z1 + 1],
  });
});
// Side fins down the whole tail, swept back. They shrink with the segments, so the tail keeps a
// fin line all the way out instead of growing smooth past the hips.
[0, 1, 2, 3, 4].forEach((index) => {
  const [x1, y1, z1, x2, y2, z2] = TAIL_SEGMENTS[index];
  const taper = 1 - index * 0.12;
  pair({
    name: `left_tail_fin_${index}`,
    from: [x2 - 1, y1 + 3, z1],
    to: [x2 + 3 * taper, y2 - 3, z2],
    bone: TAIL[index],
    rotation: [-24, 0, -16],
    origin: [x2 - 0.5, y1 + 4, z1 + 1],
  });
});
// Barbs on the last three segments, angled out from the sides of the tip.
[5, 6, 7].forEach((index) => {
  const [x1, y1, z1, x2, y2, z2] = TAIL_SEGMENTS[index];
  pair({
    name: `left_tail_barb_${index}`,
    from: [x2 - 0.6, y1 + 2.4, z1 + 0.5],
    to: [x2 + 1.8, y2 - 1.6, z2 - 0.4],
    bone: TAIL[index],
    rotation: [-16, 0, -30],
    origin: [x2 - 0.4, y1 + 3, z1 + 1],
  });
});
cube('tail_spade_1', [-3, 21.5, -73], [3, 26.5, -79], 'tail_08', { rotation: [-10, 0, 0], origin: [0, 23, -70] });
cube('tail_spade_2', [-1.6, 22.5, -78], [1.6, 25, -83], 'tail_08', { rotation: [-10, 0, 0], origin: [0, 23, -70] });

/* -- legs ------------------------------------------------------------------- */

for (const side of [1, -1]) {
  const tag = side > 0 ? 'left' : 'right';
  const box = (x1, x2) => [Math.min(side * x1, side * x2), Math.max(side * x1, side * x2)];

  // front leg: heavy thigh, then a shin that leans back, then a foot and three toes
  const [fa1, fa2] = box(6.6, 12);
  cube(`front_leg_${tag}_thigh`, [fa1, 17, 5], [fa2, 31, 18], `front_leg_${tag}`, { rotation: [6, 0, -4], origin: [side * 9, 28, 11] });
  const [fb1, fb2] = box(7, 11.4);
  cube(`front_shin_${tag}_cube`, [fb1, 7, 8], [fb2, 19.5, 15.5], `front_shin_${tag}`, { rotation: [-16, 0, 2], origin: [side * 9, 18, 11.5] });
  const [fc1, fc2] = box(6.6, 11.8);
  cube(`front_foot_${tag}_cube`, [fc1, 0, 5.5], [fc2, 8.5, 16], `front_foot_${tag}`, { rotation: [10, 0, 0], origin: [side * 9, 7, 8] });
  [[6, 8.4], [8.6, 10.6], [10.8, 12.6]].forEach(([x1, x2], index) => {
    const [t1, t2] = box(x1, x2);
    cube(`front_toe_${tag}_${index}`, [t1, 0, 12], [t2, 4.2, 22 - Math.abs(index - 1) * 1.6], `front_toes_${tag}`, {
      rotation: [-8, 0, 0],
      origin: [side * ((x1 + x2) / 2), 2, 13],
    });
    cube(`front_claw_${tag}_${index}`, [t1 + 0.4, 0, 20.4 - Math.abs(index - 1) * 1.6], [t2 - 0.4, 2.4, 25.6 - Math.abs(index - 1) * 1.8], `front_toes_${tag}`, {
      rotation: [-22, 0, 0],
      origin: [side * ((x1 + x2) / 2), 1.2, 21],
    });
  });

  // hind leg: heavier still, kicking backward at the hock
  const [ha1, ha2] = box(6.6, 12.6);
  cube(`hind_leg_${tag}_thigh`, [ha1, 15, -20], [ha2, 29, -5], `hind_leg_${tag}`, { rotation: [10, 0, -4], origin: [side * 9.5, 26, -12] });
  const [hb1, hb2] = box(7, 11.6);
  cube(`hind_shin_${tag}_cube`, [hb1, 5.5, -17], [hb2, 18, -8.5], `hind_shin_${tag}`, { rotation: [-20, 0, 2], origin: [side * 9, 16, -12] });
  const [hc1, hc2] = box(6.6, 12);
  cube(`hind_foot_${tag}_cube`, [hc1, 0, -18], [hc2, 7.5, -7], `hind_foot_${tag}`, { rotation: [12, 0, 0], origin: [side * 9, 6, -15] });
  [[6, 8.4], [8.6, 10.6], [10.8, 12.6]].forEach(([x1, x2], index) => {
    const [t1, t2] = box(x1, x2);
    // Toes run back to z −12 so they share 5 units with the foot. At −8 they shared one, and the
    // 12° pitch on the foot was enough to open all three joints.
    cube(`hind_toe_${tag}_${index}`, [t1, 0, -12], [t2, 4, 0 - Math.abs(index - 1) * 1.6], `hind_toes_${tag}`, {
      rotation: [8, 0, 0],
      origin: [side * ((x1 + x2) / 2), 2, -10],
    });
    cube(`hind_claw_${tag}_${index}`, [t1 + 0.4, 0, -1.6 - Math.abs(index - 1) * 1.6], [t2 - 0.4, 2.4, 3.6 - Math.abs(index - 1) * 1.8], `hind_toes_${tag}`, {
      rotation: [18, 0, 0],
      origin: [side * ((x1 + x2) / 2), 1.2, -1],
    });
  });
}

/* -- detail ----------------------------------------------------------------- */
//
// The second pass over the parts already built: scutes on the throat, spikes on the shoulders and
// haunches, heat vents on the chest, a thumb claw on each wing, knuckles on the feet.
//
// Every piece *declares the cube it is welded to*, and the gate audits that joint. That is the
// difference between this and the previous version, where the parts were simply placed and the
// overlap was my arithmetic: a detail part that floats loose, or sits 0.6 units from its host
// instead of 1.3, now fails the build instead of turning up in the render three iterations later.
//
// Detail is also a separate pass, not part of the base. `--detail=0` builds the creature without
// any of it, which is how the base gets tested on its own.

/** Parts added by the detail pass, each with the host cube it must interpenetrate. */
const DETAIL = [];

/** Register a detail cube on a named host. */
function detail(name, host, from, to, bone, transform) {
  DETAIL.push({ host, spec: { name, from, to, bone, ...(transform ?? {}) } });
}

/** Register a detail cube and its mirror. */
function detailPair(name, host, from, to, bone, transform) {
  const spec = { name, from, to, bone, ...(transform ?? {}) };
  DETAIL.push({ host, spec }, { host: flipSide(host), spec: mirrorX(spec) });
}

// Throat scutes, overlapping plates under each neck segment. Each sits 2.6 units up into its host
// neck cube — the earlier version cleared only 1.4, which the gate flags as an open joint.
detail('throat_plate_1', 'neck_cube_01', [-4.8, 25.4, 16.6], [4.8, 28.6, 22.8], 'neck_01', { rotation: [4, 0, 0], origin: [0, 25.4, 16.6] });
detail('throat_plate_2', 'neck_cube_02', [-4.2, 28.4, 21.6], [4.2, 31.6, 27.8], 'neck_02', { rotation: [4, 0, 0], origin: [0, 28.4, 21.6] });
detail('throat_plate_3', 'neck_cube_03', [-3.6, 31.4, 26.6], [3.6, 34.6, 32.8], 'neck_03', { rotation: [4, 0, 0], origin: [0, 31.4, 26.6] });
detail('throat_plate_4', 'neck_cube_03', [-3.1, 33.4, 29], [3.1, 36.4, 37], 'neck_03', { rotation: [4, 0, 0], origin: [0, 33.4, 29] });

// Shoulder and haunch spikes, swept back over the muscle masses.
// One shoulder spike per side, set behind the wing root rather than under it. Two spikes at the top
// of the shoulder looked right in the spec and were invisible in every render: the wing's humerus
// is a box that owns that whole region, so anything placed there is inside it. Detail has to go
// where the body leaves room, and the gate is what tells you where that is.
detailPair('left_shoulder_spike_0', 'left_shoulder_mass', [9, 33, 14.5], [12, 39.5, 19], 'chest', { rotation: [-40, 0, -16], origin: [9.8, 34, 15] });
[0, 1].forEach((index) => {
  detailPair(`left_haunch_spike_${index}`, 'left_haunch_mass', [8.2 + index, 32.4 - index * 0.5, -12 - index * 5], [11 - index * 0.4, 36.4 - index * 0.5, -7 - index * 5], 'hips', { rotation: [-30 - index * 6, 0, -14], origin: [8.9, 33 - index * 0.5, -11.5 - index * 5] });
});

// Chest heat vents: the hot faces, on the plates under the throat where the glow would show.
[0, 1].forEach((index) => {
  detailPair(`left_chest_vent_${index}`, 'chest_block', [1.8 + index * 4.2, 25.4 - index * 1.2, 15.4], [5.8 + index * 4.2, 30.6 - index * 1.2, 19.4 - index * 0.6], 'chest', { rotation: [0, -5 - index * 4, 0], origin: [2.4 + index * 4.2, 26, 15.6] });
});

// Wing thumb claw at the wrist, the one bit of the wing that is a weapon rather than a surface.
// Welded to the hand and sharing its rotation origin, so the thumb and the hand that carries it
// move as one piece instead of drifting at the wrist.
// The thumb reaches x 26, past the hand (23) and the forearm (22), so it is the outermost thing
// on the wing. Both pieces share the wrist origin: a thumb and its claw that hinge on different
// points came out at 0.00 — two boxes in the same place at rest that separate the first time the
// wing moves.
detailPair('left_wing_thumb', 'left_wing_hand', [20.5, 42, -6], [26, 49.5, 4], 'wing_left_03', { rotation: [0, -30, 14], origin: S_WRIST });
detailPair('left_wing_thumb_claw', 'left_wing_thumb', [23, 47, -2], [27.5, 53, 8], 'wing_left_03', { rotation: [0, -36, 16], origin: S_WRIST });

// Knuckles on all four feet.
for (const side of [1, -1]) {
  const tag = side > 0 ? 'left' : 'right';
  const box = (x1, x2) => [Math.min(side * x1, side * x2), Math.max(side * x1, side * x2)];
  const [ka1, ka2] = box(7.4, 11.6);
  detail(`front_knuckle_${tag}`, `front_foot_${tag}_cube`, [ka1, 5.4, 6.2], [ka2, 9.4, 13.6], `front_foot_${tag}`, { rotation: [10, 0, 0], origin: [side * 9, 7, 8] });
  const [kb1, kb2] = box(7.4, 11.8);
  detail(`hind_knuckle_${tag}`, `hind_foot_${tag}_cube`, [kb1, 4.6, -16.4], [kb2, 8.6, -8.2], `hind_foot_${tag}`, { rotation: [12, 0, 0], origin: [side * 9, 6, -15] });
}

/* -- bevels ----------------------------------------------------------------- */
//
// Eight chamfered edges, not every edge: enough to kill the flat-slab look on the chest, hips,
// shoulders and haunches without turning the model into a rounded blob. Each strip shares its
// end planes with its parent, so hygiene runs immediately afterwards.

function addBevels(name, from, to, bone, edges, chamfer, inset) {
  for (const spec of bevelEdges({ name, from, to, bone, edges, chamfer, inset })) {
    cube(spec.name, spec.from, spec.to, spec.bone, {
      ...(spec.rotation ? { rotation: spec.rotation } : {}),
      ...(spec.origin ? { origin: spec.origin } : {}),
    });
  }
}

addBevels('chest', [-10, 20, 4], [10, 38, 18], 'chest', ['top-left', 'top-right'], 4.6, 0.45);
addBevels('chest_low', [-10, 20, 4], [10, 38, 18], 'chest', ['bottom-left', 'bottom-right'], 3.4, 0.4);
addBevels('hips', [-8, 20, -20], [8, 34, -6], 'hips', ['top-left', 'top-right', 'bottom-left', 'bottom-right'], 3.8, 0.42);
addBevels('spine', [-9, 19, -8], [9, 35, 6], 'spine', ['top-left', 'top-right'], 3.6, 0.45);
// The limbs and the tail root carry chamfers too — a bevel on the torso only makes the legs read
// as the flat parts.
//
// `sided()` exists because these boxes are written once and mirrored by sign, and a box whose
// `from.x` is greater than its `to.x` is not a box. Sorting the *coordinate triple* to fix that is
// what was here before: `[6.6, 17, 5].sort()` is `[5, 6.6, 17]`, which renames the axes and put the
// leg chamfers in a scatter of stray cubes around the model.
const sided = (side, x1, x2, y1, z1, y2, z2) => ({
  from: [Math.min(side * x1, side * x2), y1, z1],
  to: [Math.max(side * x1, side * x2), y2, z2],
});
for (const side of [1, -1]) {
  const tag = side > 0 ? 'left' : 'right';
  // Chamfer the *lower* edges of the thighs. Their upper edges are at y 31, well inside the
  // shoulder mass and the spine block, and the gate reported every one of those strips as a cube
  // with no visible face: eight chamfers that did nothing but add geometry to the file.
  const front = sided(side, 6.6, 12, 17, 5, 31, 18);
  addBevels(`front_thigh_${tag}`, front.from, front.to, `front_leg_${tag}`, ['bottom-left', 'bottom-right'], 2.6, 0.4);
  const hind = sided(side, 6.6, 12.6, 15, -20, 29, -5);
  addBevels(`hind_thigh_${tag}`, hind.from, hind.to, `hind_leg_${tag}`, ['bottom-left', 'bottom-right'], 2.8, 0.4);
  // Only the outward edge on the muscle masses — the inward one is inside the torso.
  const shoulder = sided(side, 8, 13, 27, 5, 37, 18);
  addBevels(`shoulder_${tag}`, shoulder.from, shoulder.to, 'chest', [side > 0 ? 'top-left' : 'top-right'], 2.4, 0.42);
  const haunch = sided(side, 5.8, 12.4, 23, -19, 33, -7);
  addBevels(`haunch_${tag}`, haunch.from, haunch.to, 'hips', [side > 0 ? 'top-left' : 'top-right'], 2.5, 0.42);
}
addBevels('tail_root', [-7.5, 20, -29], [7.5, 33, -16], 'tail_01', ['top-left', 'top-right', 'bottom-left', 'bottom-right'], 3.2, 0.4);

/* ----------------------------------------------------------------- texture -- */
//
// One ten-step ramp, deep maroon to yellow-orange. Every material samples a window of it, which
// is what keeps a four-material creature in one colour family — and the band width comes from
// the ramp length rather than from dithering, so a face usually lands on one band or two.

const FIRE = [
  [66, 16, 20],
  [92, 22, 22],
  [122, 28, 24],
  [150, 38, 26],
  [176, 50, 28],
  [198, 68, 30],
  [216, 94, 34],
  [230, 122, 40],
  [240, 152, 54],
  [248, 186, 82],
];
const HOT = [250, 214, 116];

/** A sub-window of the master ramp, for one material. */
const rampSlice = (from, to) => {
  const out = [];
  const step = from <= to ? 1 : -1;
  for (let i = from; step > 0 ? i <= to : i >= to; i += step) out.push(FIRE[i]);
  return out;
};

const ISLANDS = {
  horn: [0, 0, 8, 8],
  claw: [8, 0, 16, 8],
  spike: [16, 0, 24, 8],
  socket: [24, 0, 32, 8],
  // Sized to the eye's outward face (3.6 wide by 2.8 tall), not to a square: an island rect *is*
  // the face's UV window, so a square island on a 1.3:1 face stretches the pupil into a bar.
  iris: [0, 8, 8, 14],
  belly: [0, 16, 32, 48],
  membrane: [0, 48, 32, 84],
  hot: [0, 84, 32, 100],
  mouth: [0, 100, 8, 108],
  teeth: [8, 100, 16, 108],
  tongue: [16, 100, 24, 108],
};

/**
 * Paint a rect with an explicit list of colours as equal-height bands.
 *
 * `bands()` derives its own ramp from one base colour, which is fine for a single material and
 * wrong for a creature whose whole point is that the materials are *related*: the belly has to
 * be exactly two steps warmer than the flank, not approximately. Handing in the steps keeps that
 * relationship exact and keeps the band count equal to the ramp length.
 */
function rampPaint(canvas, rect, colors, axis = 'vertical') {
  const [x1, y1, x2, y2] = rect;
  const vertical = axis === 'vertical';
  const span = vertical ? y2 - y1 : x2 - x1;
  if (span <= 0 || colors.length === 0) return;
  for (let i = 0; i < span; i += 1) {
    const t = colors.length === 1 ? 0 : Math.round((i / (span - 1)) * (colors.length - 1));
    const [r, g, b] = colors[Math.min(colors.length - 1, Math.max(0, t))];
    if (vertical) canvas.rect(x1, y1 + i, x2, y1 + i + 1, [r, g, b, 255]);
    else canvas.rect(x1 + i, y1, x1 + i + 1, y2, [r, g, b, 255]);
  }
}

function buildAtlas() {
  const atlas = new Atlas(128, 128);

  // The body field: the full ten-step ramp over 128 rows, so each band is ~13px. A body face
  // 10–14px tall therefore crosses one band boundary at most and carries a base plus one shade.
  atlas.define('scale', [32, 0, 128, 128]);
  rampPaint(atlas.canvas, atlas.get('scale'), rampSlice(0, 7));

  for (const [name, rect] of Object.entries(ISLANDS)) {
    atlas.define(name, rect);
  }

  // Underside and inner wing: the warm half of the same ramp.
  rampPaint(atlas.canvas, ISLANDS.belly, rampSlice(5, 8), 'vertical');
  rampPaint(atlas.canvas, ISLANDS.membrane, rampSlice(6, 9), 'vertical');
  // The hottest faces on the creature: chest vents, the jaw interior, the tail spade.
  rampPaint(atlas.canvas, ISLANDS.hot, [...rampSlice(8, 9), HOT, HOT, ...rampSlice(9, 8)], 'vertical');
  // Horn, claw and spike: near-black brown with a warm highlight band so they are not flat.
  rampPaint(atlas.canvas, ISLANDS.horn, [[26, 20, 16], [44, 32, 22], [72, 52, 32], [104, 74, 42], [44, 32, 22]]);
  rampPaint(atlas.canvas, ISLANDS.claw, [[18, 14, 12], [34, 25, 18], [58, 42, 26], [86, 62, 36], [30, 22, 16]]);
  rampPaint(atlas.canvas, ISLANDS.spike, [[24, 18, 15], [40, 29, 20], [66, 48, 30], [96, 68, 38], [36, 27, 19]]);
  rampPaint(atlas.canvas, ISLANDS.socket, [[28, 11, 13], [48, 17, 17], [74, 24, 20], [48, 17, 17]]);
  rampPaint(atlas.canvas, ISLANDS.mouth, [[58, 14, 18], [86, 20, 20], [112, 30, 24], [86, 20, 20]]);
  rampPaint(atlas.canvas, ISLANDS.tongue, [[150, 46, 40], [178, 66, 46], [198, 92, 52], [178, 66, 46]]);
  rampPaint(atlas.canvas, ISLANDS.teeth, [[226, 214, 180], [242, 234, 206], [252, 246, 226]]);

  // Eyes: bright yellow sclera with an orange iris and a dark pupil.
  eyeBrush(atlas.canvas, ISLANDS.iris, {
    sclera: [246, 214, 88],
    iris: [228, 120, 30],
    pupil: [26, 12, 8],
    brow: [70, 26, 20],
    gaze: 'center',
  });

  // A deliberate scale row: every sixteenth row of the body field shifts one step warmer. It is
  // a fixed pattern rather than noise, which is the difference between texture and dirt.
  for (let y = 14; y < 128; y += 16) {
    for (let x = 32; x < 128; x += 1) {
      const [r, g, b] = atlas.canvas.get(x, y);
      atlas.canvas.set(x, y, [...deriveShade([r, g, b], { lightness: 0.05 }), 255]);
    }
  }

  return atlas;
}

/* --------------------------------------------------------------- animations -- */

const rig = {
  body: 'spine',
  chest: 'chest',
  head: 'head',
  neck: NECK,
  tail: TAIL,
  legs: [
    // Diagonal gait: front-left with hind-right.
    { leg: 'front_leg_left', shin: 'front_shin_left', foot: 'front_foot_left', toes: 'front_toes_left', phase: 0 },
    { leg: 'front_leg_right', shin: 'front_shin_right', foot: 'front_foot_right', toes: 'front_toes_right', phase: 0.5 },
    { leg: 'hind_leg_right', shin: 'hind_shin_right', foot: 'hind_foot_right', toes: 'hind_toes_right', phase: 0 },
    { leg: 'hind_leg_left', shin: 'hind_shin_left', foot: 'hind_foot_left', toes: 'hind_toes_left', phase: 0.5 },
  ],
  arms: [
    { arm: 'wing_left_01', lower: 'wing_left_02', phase: 0 },
    { arm: 'wing_right_01', lower: 'wing_right_02', phase: 0 },
  ],
};

const FOLDED = {
  wing_left_01: [0, 0, 0], wing_left_02: [0, 0, 0], wing_left_03: [0, 0, 0], wing_left_04: [0, 0, 0],
  wing_right_01: [0, 0, 0], wing_right_02: [0, 0, 0], wing_right_03: [0, 0, 0], wing_right_04: [0, 0, 0],
};

/** Wings swung wide: shoulders up, forearms and hands spread, fingers fanned. */
const WING_OPEN = {
  wing_left_01: [0, 0, 34],
  wing_left_02: [0, -46, 10],
  wing_left_03: [0, -26, 4],
  wing_left_04: [0, -20, 0],
  wing_right_01: [0, 0, -34],
  wing_right_02: [0, 46, -10],
  wing_right_03: [0, 26, -4],
  wing_right_04: [0, 20, 0],
};
/** Half-open, held out from the body — gliding and landing. */
const WING_HALF = {
  wing_left_01: [0, 0, 16], wing_left_02: [0, -22, 5], wing_left_03: [0, -12, 2], wing_left_04: [0, -9, 0],
  wing_right_01: [0, 0, -16], wing_right_02: [0, 22, -5], wing_right_03: [0, 12, -2], wing_right_04: [0, 9, 0],
};

const NEUTRAL = { hips: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], head: [0, 0, 0], jaw: [0, 0, 0], ...FOLDED };
const neckPose = (x, y = 0) => ({ neck_01: [x, y, 0], neck_02: [x * 0.7, y * 0.7, 0], neck_03: [x * 0.5, y * 0.5, 0] });

/**
 * A wing beat, authored by hand.
 *
 * `MotionRig` has body/chest/head/neck/tail/legs/arms and no wing slot, so there is no generator
 * for this. The beat is deliberately asymmetric — a fast downstroke and a slow recovery is what
 * makes a wing look like it is pushing air rather than waving.
 */
function wingBeat({ length, samples = 10, lift = 44, drop = -22, lag = 0.07 }) {
  const keys = [];
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? 1 : -1;
    const bones = side === 'left' ? WING_LEFT : WING_RIGHT;
    const beat = (t, offset) => {
      const phase = (t - offset + 1) % 1;
      const up = phase < 0.32 ? phase / 0.32 : phase < 0.58 ? 1 - (phase - 0.32) / 0.26 : 0;
      return drop + (lift - drop) * up;
    };
    keys.push(...cycle(bones[0], 'rotation', length, samples, (t) => [0, 0, sign * (20 + beat(t, 0))]));
    keys.push(...cycle(bones[1], 'rotation', length, samples, (t) => [0, -sign * 40, sign * (8 + beat(t, lag) * 0.5)]));
    keys.push(...cycle(bones[2], 'rotation', length, samples, (t) => [0, -sign * 22, sign * beat(t, lag * 2) * 0.6]));
    keys.push(...cycle(bones[3], 'rotation', length, samples, (t) => [0, -sign * 16, sign * beat(t, lag * 3) * 0.5]));
  }
  return keys;
}

const oneShot = (name, length, entries) => clip({ name, loop: 'once', length, keys: pose(entries) });

function buildClips() {
  const clips = [];

  clips.push(clip({ name: 'idle', length: 4.4, keys: idleSway({ rig, length: 4.4, samples: 10, sway: 1.8, sink: 0.55, headScan: 5 }) }));
  clips.push(clip({ name: 'breathe', length: 3.6, keys: idleSway({ rig, length: 3.6, samples: 8, sway: 0.9, sink: 0.8, headScan: 2 }) }));
  clips.push(clip({ name: 'tail_sway', length: 3.4, keys: tailWave({ rig, length: 3.4, samples: 11, sway: 8, growth: 3.4, lag: 0.09 }) }));
  clips.push(
    clip({
      name: 'walk',
      length: 1.8,
      keys: locomotion({ rig, length: 1.8, stride: 18, knee: 24, bob: 0.5, lean: 1, tailLift: 1.5, armSwing: 3, headDrop: -1, samples: 10, kneeBase: 3 }),
    }),
  );
  clips.push(
    clip({
      name: 'run',
      length: 1,
      keys: locomotion({ rig, length: 1, stride: 30, knee: 40, bob: 1.1, lean: 5, tailLift: 4, armSwing: 6, headDrop: -2, samples: 10, kneeBase: 3 }),
    }),
  );
  clips.push(clip({ name: 'prowl', length: 3, keys: locomotion({ rig, length: 3, stride: 11, knee: 16, bob: 0.28, lean: -2, tailLift: 0.5, armSwing: 2, headDrop: 3, samples: 12, kneeBase: 2 }) }));

  const glance = (name, length, direction) =>
    clip({
      name,
      length,
      keys: [
        ...idleSway({ rig, length, samples: 6, sway: 0.5, sink: 0.2, headScan: 0 }),
        // Every neck bone needs a key at both ends, or the channel holds one value and the head
        // never comes back from the turn.
        ...pose([
          { time: 0, rotations: { ...neckPose(0), head: [0, 0, 0], jaw: [0, 0, 0] } },
          { time: length * 0.5, rotations: { ...neckPose(1, 26 * direction), head: [-2, 20 * direction, 5 * direction] } },
          { time: length, rotations: { ...neckPose(0), head: [0, 0, 0], jaw: [0, 0, 0] } },
        ]),
      ],
    });
  clips.push(glance('look_left', 1.2, 1));
  clips.push(glance('look_right', 1.2, -1));

  /* -- wings ---------------------------------------------------------------- */
  clips.push(
    oneShot('wing_unfurl', 1.3, [
      { time: 0, rotations: { ...NEUTRAL } },
      { time: 0.3, rotations: { ...WING_HALF } },
      { time: 0.65, rotations: { ...WING_OPEN, spine: [-4, 0, 0] } },
      { time: 1.3, rotations: { ...WING_OPEN, spine: [-2, 0, 0] } },
    ]),
  );
  clips.push(
    oneShot('wing_fold', 1.2, [
      { time: 0, rotations: { ...WING_OPEN } },
      { time: 0.45, rotations: { ...WING_HALF } },
      { time: 1.2, rotations: { ...NEUTRAL } },
    ]),
  );
  clips.push(clip({ name: 'flap', length: 1.1, keys: wingBeat({ length: 1.1, samples: 14 }) }));
  clips.push(
    clip({
      name: 'glide',
      length: 4.5,
      keys: [
        ...wingBeat({ length: 4.5, samples: 10, lift: 10, drop: -4, lag: 0.1 }),
        ...pose([
          { time: 0, rotations: { ...WING_HALF, spine: [0, 0, 0] } },
          { time: 2.25, rotations: { ...WING_HALF, spine: [2, 0, 0] } },
          { time: 4.5, rotations: { ...WING_HALF, spine: [0, 0, 0] } },
        ]),
        ...tailWave({ rig, length: 4.5, samples: 10, sway: 4, growth: 2.6, lag: 0.12, frequency: 0.5 }),
      ],
    }),
  );
  clips.push(
    oneShot('takeoff', 2.4, [
      { time: 0, rotations: { ...NEUTRAL } },
      { time: 0.32, rotations: { ...NEUTRAL, spine: [8, 0, 0], front_leg_left: [22, 0, 0], front_leg_right: [22, 0, 0], hind_leg_left: [20, 0, 0], hind_leg_right: [20, 0, 0], front_shin_left: [30, 0, 0], front_shin_right: [30, 0, 0], hind_shin_left: [28, 0, 0], hind_shin_right: [28, 0, 0] }, positions: { spine: [0, -2.6, 0] } },
      { time: 0.8, rotations: { ...WING_OPEN, spine: [-12, 0, 0] }, positions: { spine: [0, 1.4, 0] } },
      { time: 1.25, rotations: { ...WING_OPEN, wing_left_01: [0, 0, -8], wing_right_01: [0, 0, 8], spine: [-18, 0, 0], hind_leg_left: [-24, 0, 0], hind_leg_right: [-24, 0, 0] }, positions: { spine: [0, 6, 0] } },
      { time: 1.65, rotations: { ...WING_OPEN, wing_left_01: [0, 0, 40], wing_right_01: [0, 0, -40], spine: [-14, 0, 0], hind_leg_left: [-16, 0, 0], hind_leg_right: [-16, 0, 0] }, positions: { spine: [0, 9, 0] } },
      { time: 2.4, rotations: { ...WING_OPEN, spine: [-10, 0, 0] }, positions: { spine: [0, 10, 0] } },
    ]),
  );
  clips.push(
    oneShot('land', 1.6, [
      { time: 0, rotations: { ...WING_OPEN }, positions: { spine: [0, 7, 0] } },
      { time: 0.48, rotations: { ...WING_OPEN, wing_left_01: [0, 0, -12], wing_right_01: [0, 0, 12], spine: [6, 0, 0], front_leg_left: [36, 0, 0], front_leg_right: [36, 0, 0], hind_leg_left: [32, 0, 0], hind_leg_right: [32, 0, 0] }, positions: { spine: [0, -1, 0] } },
      { time: 0.85, rotations: { ...WING_HALF, spine: [9, 0, 0], front_shin_left: [26, 0, 0], front_shin_right: [26, 0, 0], hind_shin_left: [24, 0, 0], hind_shin_right: [24, 0, 0] }, positions: { spine: [0, -2.4, 0] } },
      { time: 1.6, rotations: { ...NEUTRAL }, positions: { spine: [0, 0, 0] } },
    ]),
  );

  /* -- fire breath and combat ---------------------------------------------- */
  clips.push(
    oneShot('fire_breath', 2.6, [
      { time: 0, rotations: { ...NEUTRAL } },
      { time: 0.4, rotations: { ...NEUTRAL, ...WING_HALF, spine: [-5, 0, 0], ...neckPose(12), jaw: [14, 0, 0] }, positions: { spine: [0, -0.8, -0.6] } },
      { time: 0.85, rotations: { ...WING_OPEN, spine: [-10, 0, 0], ...neckPose(-14), head: [-4, 0, 0], jaw: [40, 0, 0] }, positions: { spine: [0, 1.6, -1] } },
      { time: 1.7, rotations: { ...WING_OPEN, spine: [-11, 0, 0], ...neckPose(-15), head: [-5, 1, 0], jaw: [42, 0, 0] }, positions: { spine: [0, 1.8, -1] } },
      // A small recoil as the breath cuts off.
      { time: 2.1, rotations: { ...WING_OPEN, spine: [-4, 0, 0], ...neckPose(-6), jaw: [10, 0, 0] }, positions: { spine: [0, 0.5, -0.2] } },
      { time: 2.6, rotations: { ...NEUTRAL }, positions: { spine: [0, 0, 0] } },
    ]),
  );
  clips.push(
    oneShot('roar', 2, [
      { time: 0, rotations: { ...NEUTRAL } },
      { time: 0.38, rotations: { ...WING_HALF, spine: [-3, 0, 0], ...neckPose(14), jaw: [8, 0, 0] }, positions: { spine: [0, -0.6, -0.4] } },
      { time: 0.75, rotations: { ...WING_OPEN, spine: [-9, 0, 0], ...neckPose(-18), head: [-5, 0, 0], jaw: [48, 0, 0] }, positions: { spine: [0, 1.6, -0.8] } },
      { time: 1.4, rotations: { ...WING_OPEN, spine: [-9, 0, 0], ...neckPose(-19), head: [-5, 0, 0], jaw: [45, 0, 0] }, positions: { spine: [0, 1.6, -0.8] } },
      { time: 1.65, rotations: { ...WING_HALF, spine: [-3, 0, 0], ...neckPose(-6), jaw: [10, 0, 0] }, positions: { spine: [0, 0.4, 0] } },
      { time: 2, rotations: { ...NEUTRAL }, positions: { spine: [0, 0, 0] } },
    ]),
  );
  clips.push(
    oneShot('bite', 0.7, [
      { time: 0, rotations: { ...NEUTRAL } },
      { time: 0.16, rotations: { ...NEUTRAL, ...neckPose(10), jaw: [14, 0, 0] } },
      { time: 0.27, rotations: { ...NEUTRAL, ...neckPose(6), jaw: [44, 0, 0] } },
      { time: 0.38, rotations: { ...NEUTRAL, ...neckPose(-14), jaw: [-1, 0, 0], spine: [4, 0, 0] } },
      { time: 0.7, rotations: { ...NEUTRAL } },
    ]),
  );
  clips.push(
    oneShot('claw_swipe', 1, [
      { time: 0, rotations: { ...NEUTRAL } },
      { time: 0.22, rotations: { ...NEUTRAL, ...WING_HALF, spine: [0, 12, 0], chest: [0, 9, 0], front_leg_left: [-32, 0, -18], front_shin_left: [28, 0, 0] }, positions: { spine: [0, 0.6, -0.6] } },
      { time: 0.45, rotations: { ...NEUTRAL, ...WING_OPEN, spine: [0, -16, 0], chest: [0, -11, 0], front_leg_left: [40, 0, 22], front_shin_left: [-26, 0, 0], head: [0, -12, 0] }, positions: { spine: [0, 0.2, 1.4] } },
      { time: 1, rotations: { ...NEUTRAL }, positions: { spine: [0, 0, 0] } },
    ]),
  );
  clips.push(
    oneShot('tail_whip', 1, [
      { time: 0, rotations: { ...NEUTRAL } },
      { time: 0.28, rotations: { ...NEUTRAL, tail_01: [0, 16, 0], tail_02: [0, 15, 0], tail_03: [0, 14, 0], tail_04: [0, 13, 0], tail_05: [0, 12, 0], tail_06: [0, 11, 0], tail_07: [0, 10, 0], tail_08: [0, 9, 0], spine: [0, 5, 0] } },
      { time: 0.55, rotations: { ...NEUTRAL, tail_01: [0, -32, 0], tail_02: [0, -30, 0], tail_03: [0, -28, 0], tail_04: [0, -26, 0], tail_05: [0, -23, 0], tail_06: [0, -20, 0], tail_07: [0, -17, 0], tail_08: [0, -14, 0], spine: [0, -9, 0], head: [0, -9, 0] } },
      { time: 1, rotations: { ...NEUTRAL } },
    ]),
  );
  clips.push(
    oneShot('hurt', 0.6, [
      { time: 0, rotations: { ...NEUTRAL } },
      { time: 0.09, rotations: { ...NEUTRAL, ...WING_HALF, spine: [-13, 6, 0], ...neckPose(15, 9), head: [9, 7, 0], jaw: [20, 0, 0] }, positions: { spine: [0, 0.4, -1.6] } },
      { time: 0.26, rotations: { ...NEUTRAL, spine: [6, -3, 0], ...neckPose(-5, -3), jaw: [4, 0, 0] }, positions: { spine: [0, -0.2, 0.6] } },
      { time: 0.6, rotations: { ...NEUTRAL }, positions: { spine: [0, 0, 0] } },
    ]),
  );
  clips.push(
    clip({
      name: 'sleep',
      length: 6.5,
      keys: [
        ...pose([
          { time: 0, rotations: { ...NEUTRAL, spine: [6, 0, 0], ...neckPose(7) }, positions: { spine: [0, -1.8, 0] } },
          { time: 3.2, rotations: { ...NEUTRAL, spine: [8, 0, 0], ...neckPose(9), head: [6, 0, 0] }, positions: { spine: [0, -2.3, 0] } },
          { time: 6.5, rotations: { ...NEUTRAL, spine: [6, 0, 0], ...neckPose(7) }, positions: { spine: [0, -1.8, 0] } },
        ]),
        ...tailWave({ rig, length: 6.5, samples: 9, sway: 2.5, growth: 1.8, lag: 0.15, frequency: 0.34 }),
      ],
    }),
  );

  return clips;
}

/* ------------------------------------------------------------------ joints -- */
//
// What the gate audits. Each entry is an ordered run of cubes sharing a limb — put them in the
// order the parts run along it, because only *consecutive* pairs are checked and those are the
// pairs that move against each other.
//
// This list is the part I was doing in my head. Two centre chains cover the spine and the tail,
// LEFT_CHAINS covers one side, and the right side is the same list with every `left` token
// flipped — which is also how the cubes were mirrored, so the two cannot drift apart.

const CENTRE_CHAINS = [
  ['hips_block', 'spine_block', 'chest_block'],
  ['hips_block', 'belly_rear'],
  ['spine_block', 'belly_front'],
  ['hips_block', 'tail_cube_1', 'tail_cube_2', 'tail_cube_3', 'tail_cube_4'],
  ['tail_cube_4', 'tail_cube_5', 'tail_cube_6', 'tail_cube_7', 'tail_cube_8'],
  // The dorsal ridge is six separate spines* sitting on the back, not a chain: consecutive
  // spines are a unit apart and were never meant to touch. Each is welded to the block beneath it.
  ['hips_block', 'spine_ridge_1'],
  ['hips_block', 'spine_ridge_2'],
  ['spine_block', 'spine_ridge_3'],
  ['spine_block', 'spine_ridge_4'],
  ['chest_block', 'spine_ridge_5'],
  ['chest_block', 'spine_ridge_6'],
  ['chest_block', 'neck_cube_01', 'neck_cube_02', 'neck_cube_03'],
  ['skull', 'snout', 'nose_tip'],
  ['nose_tip', 'nose_horn'],
  ['nose_tip', 'left_nostril'],

];

const LEFT_CHAINS = [
  ['chest_block', 'left_shoulder_mass'],
  ['left_shoulder_mass', 'left_wing_humerus', 'left_wing_forearm'],
  ['left_wing_forearm', 'left_wing_hand'],
  ['left_wing_hand', 'left_wing_membrane_mid'],
  ['left_wing_hand', 'left_wing_finger_1', 'left_wing_finger_2', 'left_wing_finger_3'],
  ['left_wing_finger_3', 'left_wing_membrane_tip'],
  ['skull', 'left_horn_1a', 'left_horn_1b', 'left_horn_2a', 'left_horn_2b'],
  ['skull', 'left_ear_frill'],
  ['skull', 'left_head_spike'],
  ['skull', 'left_cheek_plate'],
  ['left_cheek_plate', 'left_cheek_horn'],
  ['skull', 'jaw_hinge', 'lower_jaw', 'jaw_chin'],
  ['lower_jaw', 'left_jaw_horn'],
  ['lower_jaw', 'left_jaw_spine_1'],
  ['lower_jaw', 'left_jaw_spine_2'],
  ['lower_jaw', 'tongue'],
  ['skull', 'left_head_spike'],
  ...[42.5, 45, 47.5, 49.5].map((_, index) => ['snout', `tooth_upper_left_${index}`]),
  ...[43.5, 46, 48].map((_, index) => ['lower_jaw', `tooth_lower_left_${index}`]),
  ['skull', 'left_eye_socket', 'left_eye'],
  ['hips_block', 'left_haunch_mass'],
  ['tail_cube_1', 'left_tail_fin_0'],
  ['chest_block', 'front_leg_left_thigh', 'front_shin_left_cube', 'front_foot_left_cube'],
  ['left_haunch_mass', 'hind_leg_left_thigh', 'hind_shin_left_cube', 'hind_foot_left_cube'],
  ...[0, 1, 2].flatMap((index) => [
    ['front_foot_left_cube', `front_toe_left_${index}`, `front_claw_left_${index}`],
    ['hind_foot_left_cube', `hind_toe_left_${index}`, `hind_claw_left_${index}`],
  ]),
];

const BASE_JOINTS = [
  ...CENTRE_CHAINS,
  ...LEFT_CHAINS,
  ...LEFT_CHAINS.map((chain) => chain.map(flipSide)),
];

/**
 * The gate. A build either passes this or exits non-zero.
 *
 * Three questions, all of them the kind that a quality score cannot answer:
 *
 * 1. does every audited joint actually interpenetrate, by at least `minJointDepth`;
 * 2. does every detail part weld to the host it named;
 * 3. can every part that exists to be seen actually be seen.
 *
 * The third is the one that catches "the eye is there but the cheek reaches past it", which is
 * what this model shipped with twice.
 */
function runGate(model, options = {}) {
  const minJointDepth = options.minJointDepth ?? 1;
  const includeDetail = options.detail > 0;
  const chains = [
    ...BASE_JOINTS,
    ...(includeDetail ? DETAIL.map((entry) => [entry.host, entry.spec.name]) : []),
  ];
  const joints = auditSeal(model, chains, { minDepth: minJointDepth });

  const occlusion = findBuriedFaces(model);

  // Parts that exist to be looked at. Anything in this list with no visible face is a defect:
  // the eyes, because the whole point of an eye is that you can see it, and every detail part,
  // because a detail nobody can see is just a cube in the budget.
  //
  // `hiddenCubes` is what makes this checkable. Counting buried *faces* instead would flag every
  // joint interior in the model and be ignored within a day.
  const mustBeVisible = new Set([
    'left_eye',
    'right_eye',
    ...(includeDetail ? DETAIL.map((entry) => entry.spec.name) : []),
  ]);
  const invisible = occlusion.hiddenCubes
    .filter((entry) => mustBeVisible.has(entry.cube))
    .map((entry) => `${entry.cube} (behind ${entry.blockedBy})`);

  return { joints, occlusion, invisible, ok: joints.ok && invisible.length === 0 };
}

function formatGate(result) {
  const lines = [formatSeal(result.joints), formatOcclusion(result.occlusion)];
  if (result.invisible.length > 0) {
    for (const entry of result.invisible.slice(0, 8)) {
      lines.push(`  FAIL ${entry} — present, textured, and impossible to see`);
    }
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------- build -- */

export function buildFireDragon(options = {}) {
  const atlas = buildAtlas();
  const model = new Model({
    name: 'fire_dragon',
    resolution: [128, 128],
    identifier: 'geometry.fire_dragon',
    uvPolicy: {
      rules: islandRules(atlas, [
        // Eye: iris on the outward face only — `exact` so the surrounding socket cube, which
        // also starts with `left_eye`, does not claim it.
        { island: 'iris', exact: 'left_eye', face: 'east' },
        { island: 'iris', exact: 'right_eye', face: 'west' },
        { island: 'socket', prefix: 'left_eye' },
        { island: 'socket', prefix: 'right_eye' },
        { island: 'horn', prefix: 'left_horn' },
        { island: 'horn', prefix: 'right_horn' },
        { island: 'horn', prefix: 'nose_horn' },
        { island: 'horn', prefix: 'left_cheek_horn' },
        { island: 'horn', prefix: 'right_cheek_horn' },
        { island: 'horn', prefix: 'left_jaw_horn' },
        { island: 'horn', prefix: 'right_jaw_horn' },
        { island: 'spike', prefix: 'left_head_spike' },
        { island: 'spike', prefix: 'right_head_spike' },
        { island: 'spike', prefix: 'left_ear_frill' },
        { island: 'spike', prefix: 'right_ear_frill' },
        { island: 'spike', prefix: 'left_shoulder_spike' },
        { island: 'spike', prefix: 'right_shoulder_spike' },
        { island: 'spike', prefix: 'left_haunch_spike' },
        { island: 'spike', prefix: 'right_haunch_spike' },
        { island: 'spike', prefix: 'left_tail_barb' },
        { island: 'spike', prefix: 'right_tail_barb' },
        { island: 'spike', prefix: 'front_knuckle' },
        { island: 'spike', prefix: 'hind_knuckle' },
        { island: 'spike', prefix: 'left_wing_thumb_claw' },
        { island: 'spike', prefix: 'right_wing_thumb_claw' },
        { island: 'hot', prefix: 'left_chest_vent' },
        { island: 'hot', prefix: 'right_chest_vent' },
        { island: 'belly', prefix: 'throat_plate' },
        { island: 'membrane', prefix: 'left_wing_thumb', face: 'west' },
        { island: 'membrane', prefix: 'right_wing_thumb', face: 'east' },
        { island: 'spike', prefix: 'spine_ridge' },
        { island: 'spike', prefix: 'neck_crest' },
        { island: 'spike', prefix: 'left_jaw_spine' },
        { island: 'spike', prefix: 'right_jaw_spine' },
        { island: 'spike', prefix: 'tail_spine' },
        { island: 'spike', prefix: 'left_tail_fin' },
        { island: 'spike', prefix: 'right_tail_fin' },
        { island: 'hot', prefix: 'tail_spade' },
        { island: 'claw', prefix: 'front_claw' },
        { island: 'claw', prefix: 'hind_claw' },
        // Wing membrane, per face. The outer surface of every panel is skin, so from above and
        // from the side the wing reads as part of the body; only the surface facing the flank and
        // the underside are the warm material. Painting the whole panel warm turns the wings into
        // two glowing sails that out-shout the creature.
        { island: 'membrane', prefix: 'left_wing_membrane', face: 'west' },
        { island: 'membrane', prefix: 'left_wing_membrane', face: 'down' },
        { island: 'membrane', prefix: 'right_wing_membrane', face: 'east' },
        { island: 'membrane', prefix: 'right_wing_membrane', face: 'down' },
        { island: 'membrane', prefix: 'left_wing_finger', face: 'west' },
        { island: 'membrane', prefix: 'left_wing_finger', face: 'down' },
        { island: 'membrane', prefix: 'right_wing_finger', face: 'east' },
        { island: 'membrane', prefix: 'right_wing_finger', face: 'down' },
        { island: 'teeth', prefix: 'tooth' },
        { island: 'tongue', exact: 'tongue' },
        { island: 'mouth', exact: 'lower_jaw', face: 'up' },
        { island: 'mouth', exact: 'jaw_chin', face: 'up' },
        { island: 'mouth', exact: 'snout', face: 'down' },
        { island: 'mouth', exact: 'nose_tip', face: 'down' },
        { island: 'belly', exact: 'lower_jaw', face: 'down' },
        { island: 'belly', exact: 'jaw_chin', face: 'down' },
        { island: 'belly', prefix: 'belly' },
        { island: 'belly', exact: 'chest_block', face: 'down' },
        { island: 'belly', exact: 'hips_block', face: 'down' },
        { island: 'belly', prefix: 'neck_cube', face: 'down' },
        // The underside of every tail segment, so the tail is orange underneath all the way out.
        { island: 'belly', prefix: 'tail_cube', face: 'down' },

      ]),
      fallback: skinFieldPolicy({ region: [32, 0, 128, 128], heightReference: 40, litFromAbove: true }),
    },
  });

  const detailLevel = options.detail ?? 1;

  for (const [name, pivot, parent] of GROUPS) model.bone(name, pivot, parent);
  for (const spec of CUBES) model.cube(spec);
  if (detailLevel > 0) for (const entry of DETAIL) model.cube(entry.spec);
  model.addTexture(atlas.toTexture('fire_dragon_skin', { useAsDefault: true }));
  for (const entry of buildClips()) model.addClip(entry);

  model.assignUv();
  const hygiene = geometricHygiene(model, options.hygiene === false ? { mode: 'report' } : { mode: 'hide' });
  const seams =
    options.soften === false
      ? { pairs: 0, blended: 0, pixels: 0, softness: 0, strength: 0, sharedJoins: 0 }
      : softenSeams(model, { style: options.style ?? 'balanced' });
  const gate = runGate(model, { detail: detailLevel, minJointDepth: options.minJointDepth });

  return { model, atlas, hygiene, seams, gate };
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

  const detailLevel = flags.has('detail') ? Number(flags.get('detail')) : 1;
  const { model, hygiene, seams, gate } = buildFireDragon({ detail: detailLevel });
  model.assignUv();

  console.log(`detail level ${detailLevel}`);
  console.log(formatCoincidence(hygiene.report));
  console.log(`  → ${hygiene.resolved.length} face(s) closed up or retracted`);
  console.log(`  → ${seams.pixels} texture pixel(s) bridged across ${seams.blended} seam(s)`);
  if (seams.sharedJoins > 0) console.log(`  → ${seams.sharedJoins} material(s) left to deriveShade (shared islands)`);

  const report = validate(model, { warnOnEmptyBones: true });
  console.log(formatReport(report));
  console.log(formatGate(gate));
  if (!report.ok || !gate.ok) process.exitCode = 1;

  console.log(`→ ${writeBbmodel(model, path.join(outDir, 'fire_dragon.bbmodel'))}`);
  const java = writeJavaModel(model, path.join(outDir, 'java'));
  console.log(`→ ${java.modelPath}`);
  if (java.texturePath) console.log(`→ ${java.texturePath}`);

  const sheet = contactSheet(model, { width: 260, height: 260, outline: true });
  console.log(`→ ${writeBinary(path.join(outDir, 'fire_dragon_preview.png'), sheet.toPng())}`);

  console.log(model.summary());
  console.log(formatMetrics(metrics(model)));
}

if (import.meta.url === `file://${path.resolve(process.argv[1] ?? '').replace(/\\/g, '/')}` || process.argv[1]?.endsWith('firedragon.mjs')) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export default buildFireDragon;
