# Rig and geometry reference

## `model.bone(name, pivot, parent = null, extra?)`

`extra`: `{ rotation?: Vec3, color?: number, visibility?: boolean }`.

Throws on duplicate names, a missing parent, or self-parenting.

## `model.cube(options)`

| Field | Type | Notes |
|-------|------|-------|
| `name` | `string` | defaults to the bone name; must be unique across the model |
| `from`, `to` | `Vec3` | min/max corners; normalised automatically |
| `bone` | `string` | must exist |
| `faces` | `Partial<Record<FaceName, UvRect>>` | explicit windows; the rest come from the UV policy |
| `origin` | `Vec3` | element rotation origin; defaults to the cube centre |
| `rotation` | `Vec3` | element-local euler, degrees |
| `inflate` | `number` | grows every side |
| `color` | `number` | Blockbench marker colour index |
| `mirrorUv` | `boolean` | mirror the UV on this element |
| `texture` | `number` | texture index the faces sample |

`FaceName` is one of `north south east west up down`. `UvRect` is `[x1, y1, x2, y2]` in
texture pixels.

## Model helpers

| Call | Returns |
|------|---------|
| `model.rig` | the `Rig` |
| `model.cubes` / `model.cubesOf(bone)` | cubes (all / by bone) |
| `model.findCube(name)` / `model.boneOf(cube)` | lookup |
| `model.bounds()` | `{ min, max }` including inflate |
| `model.size()` | `Vec3` per-axis extent |
| `model.translateBone(bone, delta)` | moves a subtree, returns the cube count |
| `model.reassign(fromBone, toBone)` | re-homes cubes, returns the count |
| `model.summary()` | one-line description |

## Rig

| Call | Returns |
|------|---------|
| `rig.add(name, { pivot, parent?, rotation?, color?, visibility? })` | the new `Bone` |
| `rig.ensure(name, options)` | the existing bone, or a new one |
| `rig.get(name)` / `rig.has(name)` | lookup / predicate |
| `rig.all()` / `rig.names` / `rig.size` | all bones |
| `rig.childrenOf(name)` | direct children |
| `rig.root()` | the root bone, if the rig has one |
| `rig.ordered()` | every bone, parents before children |
| `rig.ancestry(name)` | root → … → name |
| `rig.subtree(name)` | name plus descendants |
| `rig.depth(name)` | distance from the root |

## Shape builders

### `series(count, fn)`
```js
series(5, (i) => (i === 2 ? null : { name: `s_${i}`, from: [0, i, 0], to: [2, i + 1, 2], bone: 'body' }));
```
Flattens nested arrays and skips `null`.

### `mirrorPair(options)`
`{ from, to, bone, name, mirroredBone?, mirroredName? }` → `[left, right]`. Mirrors across X.

### `spikes(options)`
`{ count, start: Vec3, step: Vec3, size: Vec3, bone, prefix, taper?, bothSides? }` → `CubeOptions[]`.
`bothSides` emits `<prefix>_left_<i>` and `<prefix>_right_<i>` mirrored about X = 0.

### `boneChain(model, options)`
`{ names, pivots, parent?, color? }` → `string[]`. Declares a straight chain and returns the names.

### `segmentedBoxes(options)`
`{ bone, start, count, size, taper?, step, prefix }` → `CubeOptions[]`. A tapering run of boxes;
names are `<prefix>_1..N`.

### `plate(options)`
`{ name, from, to, bone, thicknessAxis?, thickness? }` → one thin `CubeOptions`, centred on the
chosen axis.

### `mirrorCube(cube, name, bone, faces?)`
Low-level mirror of an existing cube, flipping `mirrorUv`.

## Face geometry helpers

| Call | Returns |
|------|---------|
| `cubeSize(cube)` / `cubeCenter(cube)` | `Vec3` |
| `faceFrame(cube, face)` | `{ base, uAxis, vAxis, width, height, center }` |
| `faceCorners(cube, face)` | `[Vec3, Vec3, Vec3, Vec3]` matching the UV rect's (u1,v1)→(u2,v2) corners |

These are the shared contract between the UV policy and the renderer; if a custom face
layout is ever needed, keep both using the same frame.
