---
name: minecraft-texture-atlas
description: Paint textures for a Minecraft model — build a PNG atlas, define material islands, create discrete colour ramps and palettes, and apply clean Minecraft-style shading with fills, bands, bevels, seams, eyes and blotches. Use when creating or changing a model's colours, palette, colour scheme, texture, skin, atlas, shading, or when a generated texture looks noisy, dirty, washed out or too flat.
---

# Textures and the atlas

The texture is one PNG. It is divided into named **islands**: the main skin field plus one
small patch per material (teeth, claws, eyes, mouth, metal, …). A UV rule points faces at the
right island.

## Minimal atlas

```js
import { Atlas, bands } from '…/dist/index.js';

const atlas = new Atlas(64, 64);

atlas.define('skin', [16, 0, 64, 64]);          // fixed region, coordinates you control
bands(atlas.canvas, atlas.get('skin'), [176, 199, 117], { steps: 8, contrast: 0.5 });

atlas.alloc('teeth', 4, 4);                     // shelf-packed, you do not care where
atlas.canvas.rect(...atlas.get('teeth'), [244, 239, 216, 255]);
```

- `define(name, rect)` throws on overlap or on falling outside the canvas. Use it whenever the
  layout matters.
- `alloc(name, w, h)` shelf-packs from a moving cursor and throws when it runs out of room.
- `atlas.paint(name, (rect, canvas) => { … })` scopes a paint callback to an island.
- `atlas.toTexture(name, { useAsDefault: true })` wraps the image as a `Texture`;
  add it with `model.addTexture(...)`.

## The colour rules that matter

These are not preferences — they are what separates Minecraft art from noise, and the
`metrics()` check enforces them.

1. **Flat, discrete bands.** Shade with `bands()` (3–6 steps). A face should show roughly
   **three colours**: a base, one shade, one highlight.
2. **No dithering.** Never use `dither()`. Ordered dithering is a per-pixel pattern, and at
   texture scale it reads as digital noise.
3. **No per-pixel noise as shading.** `grain()` exists for very faint organic mottling at
   `amount <= 6`. Using it to fake lighting produces the "dirty / creepy" look.
4. **Small, deliberate palette.** 8–48 distinct colours for a whole mob skin. If you are
   above that, you are adding variety that the eye reads as damage.
5. **Do not paint lighting that the geometry already provides.** Shade with the vertical band
   ramp and let the top/bottom faces differ; do not bake directional light into a face.
6. **Only paint islands you use.** An island nobody samples still adds colours to the palette.

## Brushes

```js
import { fill, bands, bevel, seam, outline, radial, grain, blotch, eye, blendPixel } from '…/dist/index.js';

fill(canvas, rect, [r, g, b, 255]);                          // flat
bands(canvas, rect, [r, g, b], { steps: 4, axis: 'vertical' }); // discrete ramp
bevel(canvas, rect, [r, g, b], { light: 0.2, dark: -0.22 });   // lit top-left, dark bottom-right
seam(canvas, rect, [r, g, b], { amount: 0.18 });               // darken edges so boxes separate
outline(canvas, rect, [r, g, b, 255], 1);                      // 1px inset border
radial(canvas, rect, { inner, outer, steps: 4 });              // quantised radial shade
grain(canvas, rect, [r, g, b], { amount: 4, scale: 0.4 });     // faint mottling only
blotch(canvas, rect, { color, chance: 0.3, scale: 0.24 });     // flat patches via low-freq noise
eye(canvas, rect, { sclera, pupil, brow, gaze: 'center' });    // stylised eye
```

`bands` with `axis: 'vertical'` puts the light end at the **top** of the rect by default, and
`inverted: true` flips it. `tintToward` / `tintAmount` blend each band toward another colour.

## Palettes

```js
import { Palette, ramp } from '…/dist/index.js';

const palette = new Palette();
palette.define('skin',  '#6e8745', { steps: 4, contrast: 0.45 });
palette.define('belly', '#3e4a28', { steps: 3 });
palette.shade('skin', 0);          // darkest step
palette.baseRgba('skin');          // the base colour as RGBA
palette.light('skin');             // lightest step
palette.size();                    // distinct colours across every entry
```

`ramp(rgb, { steps, contrast, bias })` returns dark → light steps without a `Palette`. Use the
palette when several parts should share a scheme; it also makes the palette size inspectable.

## Working from a reference colour scheme

When the user names colours, convert them once and derive every material from that:

```js
const SCHEME = { back: '#b0c775', belly: '#3e4a28', accent: '#8a5a2b', metal: '#9aa4ad' };
for (const [name, hex] of Object.entries(SCHEME)) {
  palette.define(name, hex, { steps: name === 'accent' ? 3 : 4, contrast: 0.45 });
}
```

Keep the user's colours. Recolour by changing the ramp, never by layering noise on top.

## How the atlas connects to the model

The atlas does not touch the model by itself; a UV policy does. The usual pairing:

```js
import { islandRules } from '…/dist/index.js';

const model = new Model({
  name: 'trex', resolution: [64, 64],
  uvPolicy: {
    rules: islandRules(atlas, [
      { island: 'teeth', prefix: 'tooth_' },
      { island: 'claw',  suffix: '_claw_1' },
      { island: 'mouth', exact: 'lower_jaw_cube', face: 'up' },
    ]),
    fallback: skinFieldPolicy({ region: [16, 0, 64, 64], heightReference: 38 }),
  },
});
```

Rules are tried in order and the **first match wins**, so put the specific ones first.
Full detail is in the `minecraft-uv-mapping` skill.

## Verify what you painted

```js
console.log(metrics(model));   // palette, colours/face, band edges, notes
```

`palette 33 · colours/face 2.07` is healthy. `palette 85 · colours/face 6.7` means the
texture is noisy — go back to `bands`.

You can also write the atlas out and look at it:

```js
import { writeBinary } from '…/dist/index.js';
writeBinary('out/skin.png', model.textures[0].data);
```

## Joins between materials

A colour that jumps where two faces meet has two possible causes, and picking the wrong fix
wastes an afternoon. If the two colours belong to different **materials** — skin against belly,
skin against claw — the fix is the material: `deriveShade` the second one from the first so it
is the same pigment at a different depth, then `harmonize` the set onto a shared hue. If they
belong to the *same* material but meet abruptly at a cube edge, `softenSeams` bridges the
boundary. See `minecraft-surface-finishing`.

One trap worth knowing here: an island is a **shared surface**. A four-pixel island read by forty
faces cannot carry a per-face rim, because a rim written for one reader appears on all of them.
That is why `softenSeams` declines and reports `sharedJoins` instead of writing.

## Reference

`reference.md` lists the canvas API, every brush and every palette helper.
