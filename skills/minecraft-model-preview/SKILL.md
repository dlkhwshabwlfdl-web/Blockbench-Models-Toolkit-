---
name: minecraft-model-preview
description: Render a Minecraft model to PNG previews without an editor and judge its quality — orthographic contact sheets from every angle, posed previews at any animation time, and art metrics covering palette size, colours per face, banding, symmetry and animation coverage. Use after building or changing a model to check the silhouette, spot a missing mirrored part, catch a noisy texture, or verify a texture is not dirty, washed out or flat.
---

# Preview and quality checks

Rendering is headless: the toolkit rasterises the boxes and the texture with a depth buffer, so
there is no editor, no GPU and no browser involved. This is how you *see* what you built.

## Contact sheet

```js
import { contactSheet, writeBinary } from '…/dist/index.js';

const sheet = contactSheet(model, { width: 220, height: 220, outline: true, views: ['front', 'left', 'iso'] });
writeBinary('out/preview.png', sheet.toPng());
```

Default views, left to right: `front`, `back`, `left`, `right`, `top`, `bottom`, `iso`.
Also available: `iso-back`.

Options: `width`, `height`, `padding`, `gap`, `background`, `tileBackground`, `light`,
`ambient`, `outline`, `scale`, `filter`, `views`.

Lighting is a fixed world light, so a surface is the same brightness in every view — which is
what makes the sheet usable for spotting problems rather than flattering the model.

```js
import { renderToFile, projectModel, viewBasis } from '…/dist/index.js';

renderToFile(model, 'iso', 'out/iso.png', { width: 512, height: 512 });
const canvas = projectModel(model, viewBasis('front'), { width: 256, height: 256 });
```

## Posed previews

The renderer evaluates the rig, so a preview can show an animation at a chosen time:

```js
import { posedScene, projectScene, viewBasis, samplePose } from '…/dist/index.js';

const clip = model.clips.find((c) => c.name === 'attack');
const scene = posedScene(model, clip, 0.4);
writeBinary('out/attack-0.4.png', projectScene(scene, viewBasis('iso'), { width: 256, height: 256 }).toPng());
```

`samplePose(clip, time)` gives `Map<boneName, { rotation, position, scale }>`; `buildScene(model, pose)`
bakes it into world-space faces. Posing respects each bone's pivot and the hierarchy, so
`pose`d previews match what the animation will look like.

## Metrics

```js
import { metrics, formatMetrics } from '…/dist/index.js';
console.log(formatMetrics(metrics(model)));
```

```
score 87/100 (A)
palette 42 · colours/face 2.62 · band edges/face 1.62
flat faces 30% (reported only) · uv use 100%
bones animated 83% · silhouette 25% coverage
```

| Field | Target | Meaning |
|-------|--------|---------|
| `palette` | 8–48 | distinct opaque colours in the atlas |
| `coloursPerFace` | ≈3 | mean distinct colours inside a face window; 3 = base + shade + highlight |
| `bandEdgesPerFace` | ≳1 | colour transitions across a face; too high means noise |
| `flatFaceShare` | — | **reported, never scored** |
| `uvUtilisation` | high | share of palette colours actually sampled by a face |
| `animatedBoneShare` | >0.4 | share of bones carrying a keyframe |
| `orphanAnimators` | `[]` | bones referenced by a clip that do not exist |
| `silhouette.coverage` / `.asymmetry` | — | front-view fill; asymmetry above ~0.35 means a part is missing |

`grade` is `S` (≥90), `A` (≥78), `B` (≥65), `C` (≥50) or `D`.

### Why flatness is reported but not scored

Scoring flatness rewards per-pixel dithering and noise: a randomly speckled texture is *never*
flat, so a flatness score would rank noise above clean art. The metric reports it so you can
notice a face that has no shading at all, and scores the things that actually correlate with good
Minecraft art: a small deliberate palette, about three colours per face, and clear band edges.

## The review loop

1. Render the contact sheet and **read the image**. Check the silhouette, that mirrored parts are
   present, and that nothing floats or clips through.
2. Run `metrics`. Fix the notes it prints before anything else.
3. Ask: does the front view read as the intended creature or object at a glance? A model that is
   correct in numbers but unreadable in silhouette needs geometry, not colour.
4. Re-render, re-check, then export.

## `validate()` is separate from `metrics()`

`metrics()` judges *art quality*; `validate()` judges *correctness* and returns
`{ errors, warnings, info, ok }`. Always run both:

```js
import { validate, formatReport } from '…/dist/index.js';
const report = validate(model, { warnOnEmptyBones: true, strict: false });
console.log(formatReport(report));
if (!report.ok) process.exit(1);
```

`assertValid(model)` throws instead of returning, for build scripts that should stop on the first
problem.

## Making previews visible to the user

Two ways to show the result:

```js
// the built-in static server, from the tool folder
//   node scripts/serve.mjs "F:\resourcepack\Trex\tools ai model generator" 4181
// then open http://127.0.0.1:4181/out/<name>_preview.png
```

or simply write the PNG somewhere the user can open. The `examples/trex/trex.mjs` script and the
CLI's `--preview` flag both produce a sheet automatically.

## Detail crops: the only way to see the problem

A 106-unit-long animal fills about four pixels of the waist in a full-model render. Fixing
"the belly looks wrong" or "the hips shimmer" needs a render of *just that part*, at a forced
scale.

```js
// Build a model containing only the cubes in a box, plus the bones they hang from, then render
// it at a fixed px-per-unit scale instead of fitting the frame.
const cropped = crop(model, [x1, x2, y1, y2, z1, z2]);
projectModel(cropped, viewBasis('iso-back'), { width: 380, height: 380, scale: 11, outline: true });
```

`scripts/preview.mjs` does exactly this (crop, scale, and a self-contained HTML page with the
PNGs inlined as data URIs) and also renders the underside and the atlas at 8×, so one page shows
everything worth judging.

## Notes and limits

- Orthographic only. There is no perspective camera.
- Transparency is honoured: faces sampling transparent texels are skipped.
- `clipStrip(model, { clip, times })` renders a horizontal strip sampled through the **real
  skeleton**, so the motion is visible rather than the rest pose. All tiles share one frame — the
  union of every sampled pose and the rest pose — so the model does not appear to change size as
  it animates, and a foot passing through the floor stays visible instead of being refitted away.
- `scale` forces a px-per-unit scale; `frame` overrides the bounds the view is fitted to.
- `.bbmodel` animations are also verified structurally (key counts, bones, interpolation, ranges)
  by `validate()`. The strip is how you judge the motion *visually*.
