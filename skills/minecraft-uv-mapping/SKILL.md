---
name: minecraft-uv-mapping
description: Assign UV windows to a Minecraft model's faces — skin-field policies, per-material island rules, explicit per-face rectangles, and classic box UV layout. Use when faces show the wrong part of a texture, when a material needs its own patch of the atlas, when UVs fall outside the texture, when setting up box UV for a vanilla-style skin, or when a model needs its texture regions organised before exporting.
---

# UV mapping

Every face of every cube needs a rectangle in the texture. A model whose faces have no UV
window cannot be exported — `validate()` reports it as an error.

## The three sources, in priority order

1. **Explicit** — `cube.faces[face]` written in the spec. Use it when you know the exact
   rectangle and nothing else should override it.
2. **Rule** — the first entry of `uvPolicy.rules` whose predicate matches. Use it for materials.
3. **Fallback** — `uvPolicy.fallback`, or a skin field sized to the texture when none is given.

Later sources never overwrite an earlier one. Full resolution happens in `model.assignUv()`.

## The skin field (the default)

```js
import { skinFieldPolicy } from '…/dist/index.js';

const policy = skinFieldPolicy({
  region: [16, 0, 64, 64],  // where generic faces may sample
  heightReference: 38,      // model height that maps to the bottom (darkest) of the field
  litFromAbove: true,       // higher cubes read lighter
  upNudge: -7,              // shift the up face toward the light end
  downNudge: 6,             // shift the down face toward the dark end
});
```

How it works: a face's window sits at a vertical position derived from the cube's **height in
the model**, and at a horizontal position derived from a hash of `cube name + face`. The
vertical gradient alone produces "lighter upper surfaces, darker underside" with no painted-on
shading, and the hash keeps the layout stable between rebuilds.

If you paint a vertical band ramp into the region, this is the whole shading story. Set
`heightReference` to roughly the model's height so the full ramp is used.

## Island rules for materials

```js
import { islandRules } from '…/dist/index.js';

uvPolicy: {
  rules: islandRules(atlas, [
    { island: 'eye_left',  exact: 'eye_left',  face: 'east' },   // specific first
    { island: 'eye_right', exact: 'eye_right', face: 'west' },
    { island: 'teeth',     prefix: 'tooth_' },
    { island: 'claw',      suffix: '_claw_1' },
    { island: 'claw',      suffix: '_claw_2' },
    { island: 'claw',      prefix: 'toe_' },
    { island: 'tongue',    exact: 'tongue' },
    { island: 'scute',     prefix: 'ridge_' },
    { island: 'mouth',     exact: 'lower_jaw_cube', face: 'up' },
    { island: 'mouth',     exact: 'snout',           face: 'down' },
    { island: 'belly',     exact: 'torso',           face: 'down' },
    { island: 'eye_black', prefix: 'eye_' },                     // catch-all last
  ]),
  fallback: skinFieldPolicy({ region: [16, 0, 64, 64], heightReference: 38 }),
}
```

Pattern keys: `exact`, `prefix`, `suffix`, `face` (one face or an array). A pattern must set at
least one of `exact` / `prefix` / `suffix`, otherwise it never matches.

**Order is the mechanism.** `find()` takes the first match, so general catch-alls go last.

### Custom predicates

When name patterns are not enough, write the rule directly:

```js
rules: [
  { id: 'underside', when: (cube, face) => face === 'down' && cube.from[1] < 12, rect: [0, 8, 4, 12] },
  { id: 'dynamo',    when: (cube) => cube.name.includes('metal'), rect: (cube, face) => face === 'up' ? [4, 0, 8, 4] : [8, 0, 12, 4] },
]
```

`rect` may be a fixed `[x1, y1, x2, y2]` or a function of `(cube, face)`.

## Explicit windows

```js
model.cube({
  name: 'sign', from: [-4, 10, 3], to: [4, 16, 4], bone: 'body',
  faces: { south: [0, 16, 8, 22], north: [0, 16, 8, 22] },
});
```

Remaining faces still flow through the rules and fallback.

## Box UV (vanilla-style skins)

```js
import { boxUv } from '…/dist/index.js';
Object.assign(cube.faces, boxUv(cube, [0, 0]));   // origin = top-left of the 3×2 patch
```

Patch layout, for a cube of size `(sx, sy, sz)`:

```
        +-------------+-------------+-------------+-------------+
        |    east     |    north    |    west     |    south    |   sz tall
        +-------------+-------------+-------------+-------------+
        |             |     up      |            |    down     |
```

## Checking the result

```js
const trace = model.assignUv();          // [{ cube, face, rect, source: 'explicit' | 'rule' | 'fallback' }]
console.log(trace.filter((t) => t.source === 'fallback').length);
```

`validate(model)` reports, as errors:

- a face with no UV window at all;
- a window that runs outside `resolution`;
- a zero-area window.

## Rules of thumb

- Keep the skin field and every island **non-overlapping**; `Atlas.define` enforces this.
- A face window should be at least as large as the face's pixel size, or the texture will be
  stretched visibly.
- Let faces share regions — that is how Minecraft models work. Only insist on separation where
  the material differs.
- Do not scale the atlas above 128×128 for a mob. Larger textures cost memory in game and buy
  nothing at this blockiness.

## Reference

`reference.md` documents `UvPolicy`, `UvRule`, `assignUv`, `boxUv` and `faceFrame` precisely.
