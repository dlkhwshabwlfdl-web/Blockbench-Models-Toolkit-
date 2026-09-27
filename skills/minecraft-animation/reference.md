# Animation reference

## Types

```ts
type Interpolation = 'linear' | 'catmullrom' | 'bezier' | 'step';
type LoopMode = 'loop' | 'once' | 'hold';
type AnimationChannel = 'rotation' | 'position' | 'scale';

interface Keyframe { bone: string; channel: AnimationChannel; time: number; value: Vec3; interpolation: Interpolation }
interface Clip { name: string; loop: LoopMode; length: number; framesPerSecond: number; blendWeight: string; keys: Keyframe[] }
```

## Clips

```ts
clip({ name, keys, length, loop?, framesPerSecond?, blendWeight? }) → Clip
clipAuto({ name, keys, loop?, length? }) → Clip      // length inferred from the largest key time
```

`clip` sorts keys by bone → channel (rotation, position, scale) → time, and de-duplicates exact
duplicates. `Model.addClip` filters out keys for missing bones and pushes a warning onto
`model.warnings`.

## Keyframe builders

| Call | Notes |
|------|-------|
| `kf(bone, channel, time, value, interpolation?)` | general |
| `rot(bone, time, value, interpolation?)` / `rot3(bone, time, x, y, z, interpolation?)` | rotation |
| `pos(bone, time, value, interpolation?)` / `pos3(bone, time, x, y, z, interpolation?)` | position |
| `scale(bone, time, value, interpolation?)` / `scaleUniform(bone, time, n, interpolation?)` | scale |

Utilities: `sortKeys`, `dedupeKeys`, `mergeKeys(...groups)`, `keyCountByBone`, `animatedBones`,
`maxTime`.

Times and values are rounded to 3 decimals, matching Blockbench.

## `pose(entries, interpolation?)`

```ts
interface PoseEntry {
  time: number;
  rotations?: Record<string, Vec3>;
  positions?: Record<string, Vec3>;
  interpolation?: Interpolation;
}
```

## Curve sampling

```ts
cycle(bone, channel, length, samples, fn, interpolation?) → Keyframe[]
```
`fn(t)` for `t` in `[0, 1]`, sampled `samples + 1` times (endpoints included). Returns a scalar
(broadcast) or a `Vec3`; `null` skips the sample.

```ts
cycleBones(bones, channel, length, samples, fn) → Keyframe[]   // fn(bone, index, t)
chain(bones, length, samples, fn, { lag?, interpolation? }) → Keyframe[]
                                                                // fn(index, t, lag, bone) → Vec3
```

Curve helpers: `sin(phase, frequency)`, `cos(phase, frequency)`, `saw(phase)`,
`triangle(phase, frequency)`, `bump(center, width)`, `pulse(center, width)`, `ease(from, to)`,
`rampUp(power)`, `decay(rate)`, `vec(f)`, `frac`, `wrap01`, `TAU`.

## Motion generators

### `defaultMotionRig(tailLength = 7)`

```ts
{
  body: 'body', chest: 'chest', head: 'head',
  neck: ['neck_01', 'neck_02'],
  tail: ['tail_01', …, 'tail_0N'],
  legs: [
    { leg: 'left_leg',  shin: 'left_shin',  foot: 'left_foot',  toes: 'left_toes',  phase: 0   },
    { leg: 'right_leg', shin: 'right_shin', foot: 'right_foot', toes: 'right_toes', phase: 0.5 },
  ],
  arms: [
    { arm: 'left_arm',  lower: 'left_lower_arm',  phase: 0   },
    { arm: 'right_arm', lower: 'right_lower_arm', phase: 0.5 },
  ],
}
```

Every field is optional in the type — a generator only touches bones the rig names.

### `locomotion({ rig, length, stride, knee, bob, lean, tailLift, armSwing, headDrop, samples?, kneeBase? })`

Phases the legs half a cycle apart, derives knee flex, foot counter-rotation and toe grip from
the same phase, adds a body bob at twice the stride frequency with a roll sway once per cycle,
swings the arms against the legs, and drives the tail with a per-segment lag.

### `tailWave({ rig, length, samples?, sway?, growth?, lift?, lag?, frequency? })`

Travelling wave down `rig.tail`. Defaults: `sway 6`, `growth 2.6`, `lift 1`, `lag 0.11`, `frequency 1`.

### `breathe({ rig, length, samples?, amount?, sink? })`

Chest `scale` plus rotation, neck and head follow, body sinks. Defaults: `amount 0.04`, `sink 0.3`.

### `headTurn({ rig, direction, length?, samples?, amount? })`

Neck chain and head share the yaw, body follows slightly, the tail counter-sways.
Defaults: `length 0.9`, `amount 20`.

### `idleSway({ rig, length, samples?, sway?, sink?, headScan? })`

Seamless calm idle: weight shifts through the legs, head scans, tail drifts.
Defaults: `sway 1.6`, `sink 0.35`, `headScan 4`.
