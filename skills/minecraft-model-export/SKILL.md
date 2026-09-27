---
name: minecraft-model-export
description: Export a built Minecraft model to the right format — native .bbmodel (openable in Blockbench and re-exportable anywhere), Java Block/Item model JSON with an .mcmeta for animated textures, or an Oraxen / ItemsAdder resource-pack layout, and run the aimodel CLI on a JSON spec. Use when the user asks to export, save, package or install a model for a server plugin, resource pack, or wants a .bbmodel file, and when deciding which format suits their use case.
---

# Exporting

A `Model` is format-agnostic. Pick the exporter the user's target needs.

| Target | Exporter | What you get |
|--------|----------|--------------|
| Blockbench / anything | `writeBbmodel` | `.bbmodel` — opens in Blockbench, exportable to every format from there |
| Java resource pack, vanilla item/block models | `writeJavaModel` | `<name>.json` + `<name>.png` (+ `.mcmeta` if animated) |
| Oraxen | `writeOraxen` | `pack/models/…json`, `pack/textures/…png`, `items/…yml` |
| ItemsAdder | `writeItemsAdder` | `data/items_packs/<ns>/models/…json`, `…/textures/…png`, `…/configs/…yml` |

**Important limitation:** Java, Oraxen and ItemsAdder formats carry geometry, UV and texture, but
**not skeletal animation** — Java has no rig. The rig and all clips live in the `.bbmodel`. If the
user needs animation consumed directly by a plugin, the `.bbmodel` is the artefact to keep, and a
Bedrock `.geo.json` + `.animation.json` adapter is the natural next exporter.

## .bbmodel

```js
import { writeBbmodel, serializeBbmodel } from '…/dist/index.js';

writeBbmodel(model, 'out/trex.bbmodel');
const text = serializeBbmodel(model);               // string, no disk write
```

Options: `{ identifier?, formatVersion?, modelFormat?, name?, omitAnimations? }`.
`omitAnimations: true` produces a geometry-only snapshot.

The writer respects Blockbench's exact schema:

- `meta` = `{ format_version: '5.0', model_format: 'free', box_uv: false }`
- `elements` — cubes with `from`/`to`, `origin`, per-face `{ uv, texture }`, `type: 'cube'`, `uuid`
- `groups` — bones with `origin` (pivot) and `rotation`
- `outliner` — the hierarchy; groups as objects, elements referenced by **uuid string**
- `textures[0].source` — a `data:image/png;base64,…` URI
- `animations` — animators keyed by the **bone's uuid**, each with
  `keyframes[{ channel, data_points: [{ x, y, z }], uuid, time, color: -1, interpolation }]`

UUIDs are derived deterministically from names, so **rebuilding a model produces a byte-identical
file** and diffs stay meaningful.

## Java Block/Item

```js
import { writeJavaModel } from '…/dist/index.js';

const result = writeJavaModel(model, 'out/java', { writeTexture: true, writeMcmeta: true });
// result: { modelPath, texturePath?, mcmetaPath?, warnings }
for (const warning of result.warnings) console.warn(warning);
```

The exporter converts model space (Y up, feet at `y = 0`) into Java's y-down space, scales the
model so its height fills `fitHeight` (default 16), and centres it horizontally at
`center` (default 8). It writes the standard Blockbench item `display` block.

Options: `{ fitHeight?, flipY?, display?, credit?, textures?, center?, writeTexture?, writeMcmeta? }`.
`fitHeight: null` keeps raw units; `display: false` omits the display block.

Warnings to expect: **Java elements can only rotate about one axis.** A cube that rotates on two
or three axes gets a warning and the rotation is dropped. Fix it by splitting the cube at the
joint, or accept the warning.

`.mcmeta` (animated texture):

```js
import { toMcmeta } from '…/dist/index.js';
toMcmeta(2, [0, 1, 2, 3], false);   // { animation: { frametime: 2, interpolate: false, frames: [...] } }
```

## Oraxen and ItemsAdder

```js
import { writeOraxen, writeItemsAdder } from '…/dist/index.js';

writeOraxen(model, 'out/oraxen', { itemId: 'trex_egg', namespace: 'oraxen', displayName: 'T-Rex Egg' });
writeItemsAdder(model, 'out/itemsadder', { namespace: 'trex', itemId: 'trex_egg' });
```

Both derive the model's texture reference and the config's texture list from the same namespace, so
they always agree. Both layouts are **conventional defaults** — pack layouts have shifted between
plugin releases, so verify the item appears in game and adjust the output directory to the user's
`plugins/<Plugin>` folder.

## The CLI

For a JSON spec, or when a script is unnecessary:

```bash
cd "tools ai model generator"

node dist/cli.js build examples/crate.json --out out/crate --bbmodel --java --preview --metrics
node dist/cli.js render  examples/crate.json --out out/crate --views front,iso --size 256
node dist/cli.js validate examples/crate.json --strict
node dist/cli.js metrics  examples/crate.json --json
```

| Flag | Effect |
|------|--------|
| `--out <dir>` | output directory (default `./out`) |
| `--bbmodel [file]` | write a `.bbmodel` (the default when no format flag is given) |
| `--java` | Java model + texture + `.mcmeta` |
| `--oraxen` / `--itemsadder` | plugin pack fragment |
| `--preview` | contact-sheet PNG |
| `--metrics` | print quality metrics after building |
| `--size <px>` | preview tile size (default 256) |
| `--json` | machine-readable metrics / validation |
| `--strict` | validation fails on warnings too |

The input may be a `.json` spec (see the `minecraft-model-builder` skill and `docs/SPEC.md`) or a
`.mjs`/`.js` module whose default export is a `Model`, a spec object, or a function returning
either.

`build` exits non-zero if validation fails, so it works as a build step.

## Checklist before handing output over

1. `validate(model).ok === true` — otherwise `build` fails anyway.
2. `metrics(model).grade` is `A` or better.
3. A contact sheet exists and you have actually looked at it.
4. The exporter's `warnings` array is empty, or every entry is understood and explained to the user.
5. The output directory matches what the user needs (`plugins/Oraxen`, `plugins/ItemsAdder`, a
   resource pack's `assets/<ns>/models/…`).
