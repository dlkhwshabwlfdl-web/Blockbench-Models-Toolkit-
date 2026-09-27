# The JSON spec

A model can be described entirely as data, with no TypeScript at all. `resolveSpec(spec)` turns a
JSON object into a live `Model`: it declares the bones, creates the cubes, allocates and paints an
atlas island per material, points every face at the right island, and builds the animations.

```js
import { resolveSpec, validate, metrics, writeBbmodel } from '@trex/aimodel';

const spec = JSON.parse(fs.readFileSync('crate.json', 'utf8'));
const { model, warnings } = resolveSpec(spec);
for (const warning of warnings) console.warn(warning);

model.assignUv();
if (!validate(model).ok) process.exit(1);
writeBbmodel(model, 'out/crate.bbmodel');
```

The CLI does exactly this:

```bash
node dist/cli.js build examples/crate.json --out out/crate --bbmodel --preview --metrics
```

---

## Schema

### Top level

| Field | Type | Notes |
|-------|------|-------|
| `name` | `string` | required; drives the file stem and the deterministic uuids |
| `resolution` | `[width, height]` | texture size, default `[64, 64]` |
| `identifier` | `string` | `model_identifier` for Bedrock-style targets |
| `palette` | `Record<string, string>` | named colours, `#rrggbb` |
| `materials` | `Record<string, MaterialSpec>` | defaults to one material per palette entry |
| `bones` | `BoneSpec[]` | required; declare parents before children |
| `cubes` | `CubeSpec[]` | required |
| `animations` | `AnimationSpec[]` | optional |
| `motionRig` | `Partial<MotionRig>` | override the bone names the generators drive |

### Bone naming

The motion generators drive bones **by name**, so a spec has to name its bones after the rig
for `locomotion`, `tailWave`, `breathe`, `headTurn` and `idleSway` to produce anything. That
naming is read off the `bones` array automatically — you do not have to declare it:

| Rig field | Read from | Example |
|-----------|-----------|---------|
| `body` | `body`, else `chest` / `spine` / `hips` / `torso` / `core` | `body` |
| `chest` | `chest`, else `spine` / `hips` / … | `chest` |
| `neck` | a `neck_01`, `neck_02`, … chain, ordered by index | `neck_01`, `neck_02` |
| `head` | `head`, else the last neck bone | `head` |
| `tail` | a `tail_01`, `tail_02`, … chain, ordered by index | `tail_01`, `tail_02` |
| `legs` / `arms` | `<side>_<part>` or `<group>_<part>_<side>` | `left_shin`, `front_leg_left` |

`<side>` is `left`/`right` (or `l`/`r`), and `<part>` is `leg`/`shin`/`foot`/`toes` or
`arm`/`lower` (`shin`, `knee`, `forearm`, `hand` and `claw` are also read). Both orders work,
so `left_leg`, `front_leg_left` and `wing_left_01`-style names all resolve; bones that belong
to no limb — `jaw`, `eyes`, `horn_left_01` — are simply left alone. Limb phases alternate by
group *and* side, which puts a four-legged rig on a diagonal gait rather than a bound one.

When a limb declares the same part twice (`left_arm`, `left_lower_arm`, `left_claws`) the
proximal bone wins, because a limb is declared proximal-to-distal.

`motionRig` still wins where it is given, so a model with unusual bones — a lantern whose
flame should breathe — can say so directly:

```json
"motionRig": { "chest": "flame" }
```

If a generator finds nothing to drive it emits no keyframes. That is reported as a warning
naming the animation, never as a silent success.

### `MaterialSpec`

| Field | Default | Meaning |
|-------|---------|---------|
| `palette` | the material's own name | which palette colour to shade from |
| `steps` | `3` | discrete bands across the island (`1` = flat) |
| `contrast` | `0.34` | how far apart the darkest and lightest band are |
| `axis` | `'vertical'` | band direction |
| `inverted` | `false` | flip the light end |
| `grain` | `0` | faint mottling amplitude; keep ≤ 6 |
| `size` | `16` | island size in pixels |
| `bevel` | `false` | draw a light/dark rim |

Each material claims an atlas island (shelf-packed, in declaration order) painted with
`bands()`, and every cube face assigned to that material samples the whole island. The result is a
clean vertical two-or-three-tone shade per material, which is what Minecraft art wants.

### `BoneSpec`

```json
{ "name": "tail_01", "pivot": [0, 22, -9], "parent": "body", "color": 3 }
```

### `CubeSpec`

```json
{ "name": "tooth_upper_left_0", "from": [2.8, 29, 32.3], "to": [4, 31, 33.7],
  "bone": "upper_jaw", "material": "teeth", "inflate": 0,
  "faces": { "north": [0, 0, 4, 4] } }
```

`faces` is optional and overrides the material for specific faces.

### `AnimationSpec`

Tagged by `kind`. Every generator kind takes the generator's own options plus `name`:

```json
{ "kind": "locomotion", "name": "walk", "length": 1,
  "stride": 22, "knee": 30, "bob": 0.7, "lean": 2,
  "tailLift": 2, "armSwing": 14, "headDrop": -1, "samples": 8 }
```

| `kind` | Extra fields |
|--------|--------------|
| `locomotion` | `stride, knee, bob, lean, tailLift, armSwing, headDrop, samples?, kneeBase?` |
| `tailWave` | `sway?, growth?, lift?, lag?, frequency?, samples?` |
| `breathe` | `amount?, sink?, samples?` |
| `headTurn` | `direction` (+1 left, −1 right), `amount?, samples?, length?` |
| `idleSway` | `sway?, sink?, headScan?, samples?` |
| `poses` | `poses: PoseEntry[]`, `loop?`, `keyframes?` |

```json
{ "kind": "poses", "name": "open", "length": 0.6, "loop": "once",
  "poses": [
    { "time": 0,    "rotations": { "lid": [0, 0, 0] },   "interpolation": "linear" },
    { "time": 0.18, "rotations": { "lid": [18, 0, 0] } },
    { "time": 0.6,  "rotations": { "lid": [-96, 0, 0] }, "positions": { "root": [0, 0.2, 0] } }
  ] }
```

---

## Worked example

`examples/crate.json` in full — a lidded crate with wood and metal materials and three animations:

```json
{
  "name": "crate",
  "resolution": [32, 32],
  "palette": { "wood": "#8a5a2b", "metal": "#9aa4ad" },
  "materials": {
    "wood":  { "palette": "wood",  "steps": 3, "contrast": 0.36, "axis": "vertical" },
    "metal": { "palette": "metal", "steps": 3, "contrast": 0.42, "axis": "horizontal", "size": 8 }
  },
  "bones": [
    { "name": "root", "pivot": [0, 0, 0] },
    { "name": "lid",  "pivot": [0, 16, -8], "parent": "root" }
  ],
  "cubes": [
    { "name": "floor",      "from": [-8, 0, -8],  "to": [8, 1, 8],     "bone": "root", "material": "wood" },
    { "name": "wall_north", "from": [-8, 1, -8],  "to": [8, 16, -6],   "bone": "root", "material": "wood" },
    { "name": "wall_south", "from": [-8, 1, 6],   "to": [8, 16, 8],    "bone": "root", "material": "wood" },
    { "name": "wall_east",  "from": [6, 1, -6],   "to": [8, 16, 6],    "bone": "root", "material": "wood" },
    { "name": "wall_west",  "from": [-8, 1, -6],  "to": [-6, 16, 6],   "bone": "root", "material": "wood" },
    { "name": "band_east",  "from": [6, 3, -9],   "to": [8.4, 13, 9],  "bone": "root", "material": "metal" },
    { "name": "band_west",  "from": [-8.4, 3, -9],"to": [-6, 13, 9],   "bone": "root", "material": "metal" },
    { "name": "lid_plate",  "from": [-8.5, 16, -8.5], "to": [8.5, 18, 8.5], "bone": "lid", "material": "wood" },
    { "name": "lid_latch",  "from": [-1.5, 15, 8],    "to": [1.5, 17.5, 9], "bone": "lid", "material": "metal" }
  ],
  "animations": [
    { "kind": "poses", "name": "open", "length": 0.6, "loop": "once",
      "poses": [
        { "time": 0,    "rotations": { "lid": [0, 0, 0] },   "interpolation": "linear" },
        { "time": 0.18, "rotations": { "lid": [18, 0, 0] } },
        { "time": 0.6,  "rotations": { "lid": [-96, 0, 0] } }
      ] }
  ]
}
```

Building it produces 93/100 (S): palette 6, colours/face exactly 3, uv use 100%, fully animated rig.

---

## Errors and warnings

**Throws:**

- a cube naming a material that does not exist
- a bone whose `parent` is declared later in the array
- `bones` / `cubes` missing or empty in a way that cannot produce a model
- `from`/`to` giving a zero-size box

**Warns (collected on the returned `warnings`, and surfaced by `validate()`):**

- a material referencing a palette colour that does not exist (that island is left unpainted)
- duplicate bone names (skipped)
- more than one root bone
- an unrecognised animation `kind`
- a motion generator that produced no keyframes, because the spec declares none of the bones
  it drives

The CLI prints these on a **successful** build too, not just on failure.

## When to use the JSON spec vs a script

Use the JSON spec when the model is boxy and material-based: props, furniture, crates, simple
items, block models, and anything an agent should be able to emit in one shot.

Write a script when you need anything the spec does not expose: custom UV predicates, brows and
eyes and teeth placed by formula, tapered chains, mirrored limbs at arbitrary offsets, per-face
island rules, or animation curves beyond the built-in generators. `examples/trex/trex.mjs` is the
reference for that path, and the `minecraft-model-builder` skill covers both.
