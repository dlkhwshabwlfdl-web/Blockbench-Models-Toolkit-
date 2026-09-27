---
name: minecraft-model-builder
description: Build Minecraft models, mobs, entities, items, blocks, props and furniture from scratch by writing a script, producing .bbmodel, Java model JSON, Oraxen and ItemsAdder output plus textures, UV atlases and animations. Use when the user asks to create, generate, script or "make with code" any Minecraft model, mob, entity, item, prop, or when they want a model with a specific colour scheme and specific animations. Do not use for editing an existing .bbmodel by hand.
---

# Minecraft model builder

Build a Minecraft model by **writing a Node script**, not by clicking in an editor. The
toolkit writes the `.bbmodel`, the PNG texture, the UV atlas and the animations directly to
disk. Blockbench is never involved and does not need to be installed.

## The toolkit

Everything lives in one package in this repository:

```
F:\resourcepack\Trex\tools ai model generator
```

Import the built library from a script. Both forms work, including the space in the folder
name:

```js
// a script inside the project root
import { Model, Atlas, clip } from './tools ai model generator/dist/index.js';
```

```js
// a script inside the tool folder
import { Model, Atlas, clip } from '../dist/index.js';
```

The library must be built once before the first use:

```bash
cd "tools ai model generator" && npm install && npm run build
```

After that, `dist/` exists and every script below works.

## The loop

1. **Plan** the model: what parts it has, what colour scheme it uses, which animations it needs.
2. **Write a script** that builds it. Put the script somewhere you can run it, e.g.
   `F:\resourcepack\Trex\ai_context\models\<name>.mjs`, and import the library by relative path.
3. **Run it**: `node ai_context/models/<name>.mjs`.
4. **Look at the result.** The script writes a contact-sheet PNG. Open it and check the
   silhouette and colours before declaring success. See the `minecraft-model-preview` skill.
5. **Validate**: `validate(model)` must return `ok: true`, or fix what it reports.
6. **Export** to the formats the user needs. See `minecraft-model-export`.

Steps 4 and 5 are not optional. A model that builds is not a model that is correct.

## Skeleton of a build script

```js
import {
  Model, Atlas, bands, skinFieldPolicy, islandRules,
  clip, pose, locomotion, defaultMotionRig,
  validate, formatReport, metrics, formatMetrics,
  contactSheet, writeBinary, writeBbmodel,
  geometricHygiene, softenSeams,
} from './tools ai model generator/dist/index.js';

const atlas = new Atlas(64, 64);
atlas.define('skin', [0, 0, 64, 64]);
bands(atlas.canvas, atlas.get('skin'), [120, 150, 90], { steps: 6, contrast: 0.5 });

const model = new Model({
  name: 'my_model',
  resolution: [64, 64],
  uvPolicy: { fallback: skinFieldPolicy({ region: [0, 0, 64, 64], heightReference: 32 }) },
});

model.bone('root', [0, 0, 0]);
model.bone('body', [0, 10, 0], 'root');
model.cube({ name: 'torso', from: [-4, 10, -3], to: [4, 18, 3], bone: 'body' });

model.addTexture(atlas.toTexture('my_model_skin', { useAsDefault: true }));
model.addClip(clip({ name: 'idle', length: 3, keys: [] }));

// 1. windows, 2. remove buried/duplicate faces, 3. bridge the remaining material joins
model.assignUv();
geometricHygiene(model, { mode: 'hide' });
softenSeams(model, { style: 'balanced' });

const report = validate(model, { warnOnEmptyBones: true });
console.log(formatReport(report));
if (!report.ok) process.exit(1);

writeBbmodel(model, 'out/my_model.bbmodel');
writeBinary('out/my_model_preview.png', contactSheet(model, { width: 220, height: 220, outline: true }).toPng());
console.log(formatMetrics(metrics(model)));
```

## Judge the result, do not just trust it

`metrics(model)` returns a score and a grade. `A` or better is the bar. The notes tell you
what to change:

- *palette is large / faces carry many colours* → you added noise, dithering or a smooth
  gradient. Use `bands()` with 3–6 steps instead.
- *faces are nearly single-colour* → add one shade and one highlight band.
- *front silhouette is strongly asymmetric* → a mirrored part is missing.
- *fewer than half the bones are animated* → the rig is idle.

## Hard rules

- **Never** dither a texture. Never fake shading with random per-pixel noise.
- **Never** put colours outside the texture. `validate()` catches this; so does `assignUv`.
- Build the rig **top-down**: a bone's parent must exist before the child is declared.
- One root bone. `validate()` warns when there is more than one.
- Every cube must name a bone that exists.
- Run `model.assignUv()` before exporting; every face needs a UV window.

## Model space

Fixed convention, shared by every tool in this suite:

| Axis | Meaning |
|------|---------|
| `+X` | the model's **left** (so `left_leg` has positive X) |
| `+Y` | up, with the feet at `y = 0` |
| `+Z` | the direction the model **faces** |

Rotation signs follow from that: `-X` swings a limb below its pivot forward, `+Y` turns
toward the model's left, `+X` on the tail lifts it.

## Related skills

Read these when the task touches their area — each has a `reference.md` with the full API:

- `minecraft-rig-and-bones` — bones, pivots, shapes, mirroring, limbs and chains
- `minecraft-texture-atlas` — islands, palettes, brushes, colour rules
- `minecraft-uv-mapping` — UV policies, island rules, box UV
- `minecraft-animation` — keyframes, curve helpers, locomotion, tails, one-shot actions
- `minecraft-model-preview` — rendering contact sheets and reading the metrics
- `minecraft-model-export` — .bbmodel, Java JSON, Oraxen, ItemsAdder, and the CLI
- `minecraft-surface-finishing` — element rotation, bevels, coincident-face cleanup, palette
  harmony and seam softening. Read it whenever the model builds but the user says it looks
  wrong: ugly, dirty, flickering, too dark, or too voxel.
