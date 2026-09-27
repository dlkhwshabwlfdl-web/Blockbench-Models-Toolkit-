---
name: minecraft-animation
description: Author animations for a Minecraft model — keyframes, interpolation, rotation and position channels, looping walk/run cycles, breathing idles, tail and neck chain waves, head turns, and one-shot actions like attack, bite, roar, jump, hurt, death. Use when a model needs animations, when adding a walk or idle cycle, when a clip pops or looks robotic, or when the user asks for a model "with animations" without naming them.
---

# Animations

A clip is a name, a loop mode, a length in seconds, and a list of keyframes. A keyframe targets
**one bone, one channel, one time**.

```js
import { clip, pose, kf, locomotion, defaultMotionRig } from '…/dist/index.js';

model.addClip(clip({ name: 'walk', length: 1, loop: 'loop', keys: [/* … */] }));
```

Channels are `'rotation'` (degrees), `'position'` (model units) and `'scale'` (multiplier).
Loop modes are `'loop'`, `'once'` and `'hold'`. `framesPerSecond` defaults to 20.

`model.addClip` drops keys aimed at bones the model lacks and records a warning — so a generator
written for a conventional rig never breaks an unusual model.

## Two ways to author

### 1. Curve sampling — for cycles

`cycle()` samples a normalised 0→1 cycle and emits keys. It includes **both** endpoints, so a
loop closes exactly at `t = 0` and `t = 1`.

```js
import { cycle, sin, bump, pulse } from '…/dist/index.js';

cycle('tail_03', 'rotation', 3, 9, (t) => [0, 8 * Math.sin(2 * Math.PI * t), 0]);
cycle('chest',   'scale',    3, 6, (t) => 1 + 0.04 * Math.sin(2 * Math.PI * t));
```

`fn` may return a scalar (broadcast across X/Y/Z) or a `Vec3`, and may return `null` to skip a
sample.

Helpers: `sin(phase, frequency)`, `cos`, `saw`, `triangle`, `bump(center, width)`,
`pulse(center, width)`, `ease(from, to)`, `rampUp(power)`, `decay(rate)`.

### 2. Pose snapshots — for one-shot actions

```js
const keys = pose([
  { time: 0,    rotations: { body: [0, 0, 0], lower_jaw: [0, 0, 0] }, interpolation: 'linear' },
  { time: 0.24, rotations: { neck_01: [-18, 0, 0], lower_jaw: [40, 0, 0] }, positions: { body: [0, 0.5, 1.2] } },
  { time: 0.7,  rotations: { body: [4, 0, 0], neck_01: [4, 0, 0] } },
]);
```

The shape of the action is readable in the data instead of hidden in maths. Use `'linear'` on
the first and last entry of a `'once'` clip so it does not ease out of the neutral pose.

## Generators — start here

```js
import { defaultMotionRig, locomotion, tailWave, breathe, headTurn, idleSway } from '…/dist/index.js';

const rig = defaultMotionRig(7);   // body, chest, head, neck_01/02, left/right leg+shin+foot+toes,
                                   // left/right arm+lower_arm, tail_01..07

model.addClip(clip({ name: 'walk',   length: 1,    keys: locomotion({ rig, length: 1, stride: 22, knee: 30, bob: 0.7, lean: 2,  tailLift: 2, armSwing: 14, headDrop: -1, samples: 8 }) }));
model.addClip(clip({ name: 'run',    length: 0.72, keys: locomotion({ rig, length: 0.72, stride: 36, knee: 48, bob: 1.2, lean: 7,  tailLift: 6, armSwing: 28, headDrop: -3, samples: 8 }) }));
model.addClip(clip({ name: 'idle',   length: 4,    keys: idleSway({ rig, length: 4, samples: 8 }) }));
model.addClip(clip({ name: 'breathe',length: 3,    keys: breathe({ rig, length: 3, samples: 6 }) }));
model.addClip(clip({ name: 'tail_sway', length: 3, keys: tailWave({ rig, length: 3, samples: 9, sway: 6, growth: 2.6 }) }));
model.addClip(clip({ name: 'look_left', length: 0.9, keys: headTurn({ rig, direction: 1 }) }));
```

Override the naming for a model that does not follow the convention:

```js
const rig = { ...defaultMotionRig(3), body: 'torso', head: 'skull',
              legs: [{ leg: 'l_thigh', shin: 'l_shin', phase: 0 }, { leg: 'r_thigh', shin: 'r_shin', phase: 0.5 }],
              arms: [] };
```

### `locomotion` — the walking generator

The four parameters that matter: `stride` (thigh swing), `knee` (peak flex), `bob` (vertical
bounce) and `lean` (forward pitch). What makes a cube leg stop reading as a wind-up toy is that
the knee flexes while the leg swings, the foot counter-rotates to stay near the ground, and the
toes grip on the push-off — the generator derives all three from one phase, so you only tune
these numbers. Rough profiles:

| Clip | length | stride | knee | bob | lean | tailLift | armSwing | headDrop |
|------|--------|--------|------|-----|------|----------|----------|----------|
| walk | 1.0 | 22 | 30 | 0.7 | 2 | 2 | 14 | −1 |
| run | 0.72 | 36 | 48 | 1.2 | 7 | 6 | 28 | −3 |
| sprint | 0.55 | 44 | 56 | 1.5 | 12 | 9 | 34 | −5 |

### `tailWave`, `breathe`, `idleSway`, `headTurn`

All take `{ rig, length, samples? }` plus their own tuning. `tailWave` propagates a wave down the
chain with a per-segment lag (`lag`, `frequency`, `sway`, `growth`, `lift`). `idleSway` produces a
seamless calm idle; `breathe` is chest expansion plus a small body sink; `headTurn` takes a
`direction` of `+1` (model's left) or `-1`.

### `chain` — raw propagating motion

```js
import { chain } from '…/dist/index.js';

chain(['tail_01', 'tail_02', 'tail_03'], 0.9, 10, (index, t, lag) => {
  const whip = 42 * Math.exp(-(((t - lag - 0.48) / 0.11) ** 2));
  return [3 + index * 0.7, whip, 0];
}, { lag: 0.045 });
```

## What makes an animation look right

1. **A loop must close.** Sample `t = 0` and `t = 1` with the same value; `cycle()` does this for
   you. If you hand-roll keys, check the endpoints.
2. **Offset the phases.** Legs at `phase` 0 and 0.5. Tail segments each lag the one before them.
   Everything moving together is the single clearest sign of a bad animation.
3. **Counter-rotate.** A foot that does not counter-rotate slides. Arms swing against the legs.
4. **Lead the extremes.** An action's biggest pose comes slightly *before* its midpoint, not at it.
5. **Animate most of the rig.** `metrics()` reports `animatedBoneShare`; below 40% reads as a
   half-finished rig.
6. **Keep the length honest.** Do not pad a 0.5 s attack to 2 s; the dead time is visible.

## Inspecting clips

```js
model.clips.map((c) => `${c.name} ${c.loop} ${c.length}s ${c.keys.length} keys`);
model.clips[0].keys.filter((k) => k.bone === 'head');
```

`validate(model)` errors on an empty clip, a non-positive length, an unknown bone and an invalid
interpolation, and warns about keys outside `0..length`.

## Reference

`reference.md` documents every keyframe builder, curve helper and generator option.
