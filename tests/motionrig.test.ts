import { describe, expect, it } from 'vitest';

import { defaultMotionRig, inferMotionRig } from '../src/anim/motion.js';
import { resolveSpec, type JsonSpec } from '../src/spec.js';

const biped = [
  { name: 'root', parent: null },
  { name: 'body', parent: 'root' },
  { name: 'chest', parent: 'body' },
  { name: 'neck_01', parent: 'chest' },
  { name: 'neck_02', parent: 'neck_01' },
  { name: 'head', parent: 'neck_02' },
  { name: 'upper_jaw', parent: 'head' },
  { name: 'eyes', parent: 'head' },
  { name: 'left_arm', parent: 'chest' },
  { name: 'left_lower_arm', parent: 'left_arm' },
  { name: 'left_claws', parent: 'left_lower_arm' },
  { name: 'right_arm', parent: 'chest' },
  { name: 'right_lower_arm', parent: 'right_arm' },
  { name: 'left_leg', parent: 'body' },
  { name: 'left_shin', parent: 'left_leg' },
  { name: 'left_foot', parent: 'left_shin' },
  { name: 'left_toes', parent: 'left_foot' },
  { name: 'right_leg', parent: 'body' },
  { name: 'right_shin', parent: 'right_leg' },
  { name: 'right_foot', parent: 'right_shin' },
  { name: 'right_toes', parent: 'right_foot' },
  ...Array.from({ length: 7 }, (_, i) => ({ name: `tail_0${i + 1}`, parent: i === 0 ? 'body' : `tail_0${i}` })),
];

describe('inferMotionRig', () => {
  it('reproduces the shipped biped rig exactly', () => {
    expect(inferMotionRig(biped)).toEqual(defaultMotionRig());
  });

  it('reads the side-last order the quadruped examples use', () => {
    const rig = inferMotionRig([
      { name: 'front_leg_left' },
      { name: 'front_shin_left' },
      { name: 'front_foot_left' },
      { name: 'front_leg_right' },
      { name: 'front_shin_right' },
      { name: 'hind_leg_left' },
      { name: 'hind_shin_left' },
      { name: 'hind_leg_right' },
    ]);
    expect(rig.legs?.map((leg) => leg.leg)).toEqual([
      'front_leg_left',
      'front_leg_right',
      'hind_leg_left',
      'hind_leg_right',
    ]);
    expect(rig.legs?.[0].shin).toBe('front_shin_left');
    expect(rig.legs?.[0].foot).toBe('front_foot_left');
  });

  it('counter-phases the diagonal gait on a four-legged rig', () => {
    const rig = inferMotionRig([{ name: 'front_leg_left' }, { name: 'front_leg_right' }, { name: 'hind_leg_left' }, { name: 'hind_leg_right' }]);
    // front-left and hind-right move together; the other pair is half a cycle away.
    expect(rig.legs?.map((leg) => leg.phase)).toEqual([0, 0.5, 0.5, 0]);
  });

  it('prefers the proximal bone when a limb declares the same role twice', () => {
    const rig = inferMotionRig([{ name: 'left_arm' }, { name: 'left_lower_arm' }, { name: 'left_claws' }]);
    expect(rig.arms?.[0]).toEqual({ arm: 'left_arm', lower: 'left_lower_arm', phase: 0 });
  });

  it('orders a neck and tail chain by index, not declaration order', () => {
    const rig = inferMotionRig([{ name: 'tail_03' }, { name: 'tail_01' }, { name: 'tail_02' }, { name: 'neck_02' }, { name: 'neck_01' }]);
    expect(rig.tail).toEqual(['tail_01', 'tail_02', 'tail_03']);
    expect(rig.neck).toEqual(['neck_01', 'neck_02']);
  });

  it('falls back to the last neck bone when no bone is called head', () => {
    expect(inferMotionRig([{ name: 'neck_01' }, { name: 'neck_02' }]).head).toBe('neck_02');
  });

  it('ignores bones that are not part of a limb', () => {
    const rig = inferMotionRig([{ name: 'wing_left_01' }, { name: 'horn_right_01' }, { name: 'jaw' }]);
    expect(rig).toEqual({});
  });
});

describe('resolveSpec motion rig', () => {
  const base: JsonSpec = {
    name: 'probe',
    resolution: [16, 16],
    palette: { wood: '#8a5a2b' },
    bones: [{ name: 'root', pivot: [0, 0, 0] }],
    cubes: [{ name: 'block', from: [-4, 0, -4], to: [4, 4, 4], bone: 'root' }],
  };

  it('animates a spec whose bones are named its own way', () => {
    const { model } = resolveSpec({
      ...base,
      bones: [
        { name: 'root', pivot: [0, 0, 0] },
        { name: 'body', pivot: [0, 2, 0], parent: 'root' },
        { name: 'head', pivot: [0, 4, 0], parent: 'body' },
      ],
      animations: [{ kind: 'breathe', name: 'idle', length: 2 }],
    });
    expect(model.clips.map((c) => c.name)).toEqual(['idle']);
    expect(model.clips[0].keys.length).toBeGreaterThan(0);
  });

  it('warns instead of dropping an animation that produced no keyframes', () => {
    const { model, warnings } = resolveSpec({
      ...base,
      animations: [{ kind: 'headTurn', name: 'look', direction: 1, length: 1 }],
    });
    expect(model.clips).toHaveLength(0);
    expect(warnings.join('\n')).toMatch(/"look" \(headTurn\) produced no keyframes/);
  });

  it('lets an explicit motionRig override the inferred one', () => {
    const { model } = resolveSpec({
      ...base,
      bones: [
        { name: 'root', pivot: [0, 0, 0] },
        { name: 'flame', pivot: [0, 2, 0], parent: 'root' },
      ],
      motionRig: { chest: 'flame' },
      animations: [{ kind: 'breathe', name: 'flicker', length: 2 }],
    });
    expect(model.clips.map((c) => c.name)).toEqual(['flicker']);
    expect(model.clips[0].keys.every((key) => key.bone === 'flame')).toBe(true);
  });
});
