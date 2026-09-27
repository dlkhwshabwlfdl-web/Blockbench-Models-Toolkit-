# Export reference

## `.bbmodel`

```ts
toBbmodel(model, options?) → BbmodelDocument
serializeBbmodel(model, options?) → string
writeBbmodel(model, file, options?) → string      // returns the path written
```

`BbmodelOptions`: `{ identifier?, formatVersion?, modelFormat?, name?, omitAnimations? }`.
Defaults: `format_version '5.0'`, `model_format 'free'`.

Document shape (only the parts that must be exact):

```jsonc
{
  "meta": { "format_version": "5.0", "model_format": "free", "box_uv": false },
  "name": "…",
  "model_identifier": "geometry.…",
  "visible_box": [1, 1, 0],
  "resolution": { "width": 64, "height": 64 },
  "elements": [{
    "name": "torso", "box_uv": false, "render_order": "default", "locked": false,
    "export": true, "scope": 0, "allow_mirror_modeling": true,
    "from": [-7, 17, -9], "to": [7, 29, 3], "autouv": 0, "color": 0,
    "origin": [0, 23, -3],
    "faces": { "north": { "uv": [39, 35, 53, 47], "texture": 0 }, "…": {} },
    "type": "cube", "uuid": "…"
  }],
  "groups": [{ "name": "root", "uuid": "…", "origin": [0, 0, 0], "rotation": [0, 0, 0],
               "children": [], "visibility": true, "…": "…" }],
  "outliner": [{ "uuid": "<root group uuid>", "isOpen": true,
                 "children": [{ "uuid": "<child group uuid>", "isOpen": true, "children": ["<element uuid>"] }] }],
  "textures": [{ "name": "trex_skin", "width": 64, "height": 64,
                 "source": "data:image/png;base64,…", "…": "…" }],
  "animations": [{
    "uuid": "…", "name": "walk", "loop": "loop", "length": 1, "snapping": 20,
    "animators": {
      "<bone uuid>": { "name": "left_leg", "type": "bone", "rotation_global": false,
                       "quaternion_interpolation": false,
                       "keyframes": [{ "channel": "rotation",
                                       "data_points": [{ "x": 0, "y": 0, "z": 0 }],
                                       "uuid": "…", "time": 0, "color": -1,
                                       "interpolation": "catmullrom" }] }
    }
  }]
}
```

Two things that are easy to get wrong: **outliner children are element uuid strings or group
objects**, and **animators are keyed by the bone's uuid, not its name**.

UUIDs come from `UuidSpace`, derived from `hash(modelName:identifier)` plus the key, so a rebuild is
byte-identical.

## Java

```ts
toJavaModel(model, options?) → { model, warnings }
writeJavaModel(model, outDir, options?) → { modelPath, texturePath?, mcmetaPath?, warnings }
javaTransform(model, options?) → (point: Vec3) => Vec3
toMcmeta(frametime, frames, interpolate?) → { animation: { frametime, interpolate, frames } }
DEFAULT_JAVA_DISPLAY
```

| Option | Default | Meaning |
|--------|---------|---------|
| `fitHeight` | `16` | height in Java units; `null` keeps raw units |
| `flipY` | `true` | Java's Y points down |
| `display` | `DEFAULT_JAVA_DISPLAY` | `false` omits the block |
| `credit` | generated note | |
| `textures` | `{ '0': <name>, particle: <name> }` | texture variable map |
| `center` | `8` | horizontal centre |
| `writeTexture` | `true` | also write `<stem>.png` |
| `writeMcmeta` | `false` | also write `<stem>.png.mcmeta` |

Transform: `x' = (x − midX)·s + 8`, `y' = 16 − (y − minY)·s`, `z' = (z − midZ)·s + 8`, with
`s = fitHeight / (maxY − minY)`, then corners are sorted into `from ≤ to`.

**One-axis rotations only.** A cube rotating on two or three axes gets a warning and the rotation
is dropped.

## Plugin packs

```ts
writeOraxen(model, outDir, options?) → { modelPath, texturePath, configPath?, warnings }
writeItemsAdder(model, outDir, options?) → { modelPath, texturePath, configPath?, warnings }
```

Oraxen (`outDir` = `plugins/Oraxen`):
`pack/models/<stem>.json`, `pack/textures/<stem>.png`, `items/<id>.yml`.

ItemsAdder (`outDir` = `plugins/ItemsAdder`):
`data/items_packs/<ns>/models/<stem>.json`, `…/textures/<stem>.png`, `…/configs/<stem>.yml`.

Options: `{ itemId?, namespace?, displayName?, material?, writeConfig?, …JavaOptions }`.
Both derive the model's texture reference and the config's texture list from one namespace, so they
cannot disagree. Layouts are conventional defaults; adjust `outDir` to the user's plugin folder.

## `toYaml(value)`

A minimal YAML emitter for configs: nested maps, arrays of scalars, quoting where required. No
external dependency.

## Filesystem helpers

`ensureDir(dir)`, `writeText(file, text)`, `writeJson(file, value)` (2-space indent + newline),
`writeBinary(file, bytes)`, `fileStem(name)`. All create parent directories.

## CLI

```
aimodel build <spec.json|spec.mjs> --out <dir> [options]
aimodel render <spec> --out <dir> [--views front,iso] [--size 256]
aimodel validate <spec> [--strict] [--json]
aimodel metrics  <spec> [--json]
```

Options: `--out`, `--bbmodel [file]`, `--java`, `--oraxen`, `--itemsadder`, `--preview`,
`--metrics`, `--size`, `--json`, `--strict`, `--no-sheet`.

With no format flag, `build` writes a `.bbmodel`. It runs `validate()` first and **exits 1** on
errors, so it works as a build step.

Input resolution: a `.json` file is parsed as a spec; a `.mjs`/`.js` module's default export may be
a `Model`, a spec object, or a function returning either.

## Programmatic use of `resolveSpec`

```ts
resolveSpec(spec: JsonSpec) → { model, atlas, materials, warnings }
```

Spec fields: `name`, `resolution`, `identifier`, `palette` (name → hex), `materials`
(`{ palette, steps?, contrast?, axis?, inverted?, grain?, size?, bevel? }`), `bones`
(`{ name, pivot, parent?, color? }`), `cubes` (`{ name?, from, to, bone, material?, faces?, inflate? }`),
`animations` (tagged by `kind`: `locomotion`, `tailWave`, `breathe`, `headTurn`, `idleSway`, `poses`),
`motionRig` (override the generator bone names).

Each material gets an auto-allocated atlas island painted with a band ramp from the palette, and
every cube face assigned to it samples that island. Unknown materials and out-of-order parents
throw; unknown palette colours produce a warning.

See `docs/SPEC.md` for the full annotated example.
