---
name: minecraft-surface-finishing
description: Fix the things that make a Minecraft model look wrong rather than merely incorrect - a colour that jumps between two cube faces, a part of the model that shimmers because two cubes put a face on the same plane, and a silhouette that reads as flat stacked boxes. Covers element rotation, 45-degree bevels, coincident-face cleanup, palette harmony and seam softening, and how to choose between the sharp, balanced and soft surface styles. Use when a model builds and validates but still looks bad, when the user says an area is ugly, dirty, too dark, flickering, shimmering or too voxel, or when asked to make a model prettier or smoother.
---

# Surface finishing

A model can validate cleanly, export cleanly and still look wrong. This skill covers the four
failures that account for almost all of that, and the tools for each.

Everything here is a **dial, not a switch**. Ask what the user wants — a crisp voxel model is a
legitimate answer — and set the style accordingly:

| Style | `edgeSoftness` | What it does |
|-------|----------------|--------------|
| `sharp` | 0 | every join is a hard line; pure voxel |
| `balanced` | 1 | a one-pixel boundary at each material change — the default |
| `soft` | 3 | a solid join plus two dithered bands fading inward |

```js
import { resolveStyle, SURFACE_STYLES, softenSeams, harmonize, deriveShade } from '../dist/index.js';

softenSeams(model, { style: 'balanced' });   // or { softness: 2, strength: 0.5 }
```

## 1. A colour that jumps between two faces

Two causes, two different fixes. Get this right first — it is the most common complaint.

**The colours are unrelated.** One olive back meeting a swamp-green belly is not a shading
problem: they are two hues that were never related. Derive the secondary material *from* the
primary, then pull the pair onto a shared hue:

```js
const SKIN = [176, 199, 117];
const raw = [
  SKIN,
  deriveShade(SKIN, { lightness: -0.16, saturation: 0.95 }),   // belly
  deriveShade(SKIN, { lightness: -0.07, saturation: 1.2 }),    // scute plates
  deriveShade(SKIN, { lightness: -0.3, saturation: 1.15 }),    // nostrils
];
const [SKIN_OK, BELLY, SCUTE, NOSTRIL] = harmonize(raw, { strength: 0.4 });
```

`deriveShade` keeps the hue and moves lightness. `harmonize` pulls a set of colours toward a
shared hue while leaving each one's lightness and saturation alone, so shading survives. This is
the right fix for any join on a **shared atlas island**, where a per-face boundary is impossible.

**The colours are related but meet abruptly.** `softenSeams` finds every pair of faces that meet
along a 3D edge — including the faces of a single cube, which is where a UV policy most often
puts two different islands side by side — and gives the boundary pixels the neighbouring
material's colour.

Three rules keep it from making things worse, and all three were learned by getting them wrong:

- It only ever writes **the neighbour's own colour**. Blending two colours and snapping to the
  palette puts a colour that belongs to neither at the join; halfway between olive skin and pink
  tongue is a pink speck on the model's back.
- It only writes texels with a **lone owner**. Atlas islands are shared, and a rim written for
  one reader appears on all of them. Small islands cannot take a rim: an olive rim on a
  four-pixel claw island turns every claw pale. When a join is skipped for this reason the
  result reports it in `sharedJoins` — the fix is then `deriveShade`, not a bigger `softness`.
- It only bridges joins **between different materials**. Two bands of one skin ramp meeting at a
  cube edge is the texture working as intended.

## 2. A part that shimmers as the model turns

Two faces on one plane, overlapping: the rasteriser picks a winner per pixel with no stable
answer, and the two colours flicker into each other. Blockbench has pivot/alignment tooling for
this; here it is `geometricHygiene`:

```js
import { findCoincidentFaces, geometricHygiene, formatCoincidence } from '../dist/index.js';

console.log(formatCoincidence(findCoincidentFaces(model)));   // inspect only
geometricHygiene(model, { mode: 'hide' });                    // resolve
```

It separates the two cases, because the fix differs:

- **interior** — opposite normals on one plane. Invisible from outside, so a fully covered face
  is removed (`hidden.add(face)`); the export then drops it and the flicker is gone.
- **duplicate** — same normal on one plane. Two pieces of geometry claiming one surface. Fully
  covered → hidden. Partly covered → that face is retracted 0.05 units *behind* the winner,
  which is invisible but makes the winner win every pixel.

Coverage is accumulated **per face**, which matters: a small ridge on a wide back is coincident
with the back's top face only where it touches, so hiding the back's face because "the overlap
covers 100% of the smaller face" would cut a hole straight through the model.

Run it after building the geometry and before the seam pass. `hidden` faces are skipped by both
the exporter and the seam pass, so ordering it first is what stops them being bridged.

## 3. A silhouette of flat stacked boxes

Element rotation is legal on every cube in a `.bbmodel` — a voxel model simply never uses it.
Rotating a box is what turns a stack of blocks into sloped snouts, swept-back scutes and angled
claws. A rotation of 8–25° is usually all it takes, and **the buried end of a rotated slab is
invisible**, so a slope costs one angle and no extra geometry.

```js
import { slab, bevelEdges, setRotation, rotateAround } from '../dist/index.js';

// A scute swept back about its own rear-bottom edge: the pivot is what makes it lean
// instead of swing.
model.cube({ name: 'ridge', from: [-1.6, 29, -7], to: [1.6, 31.5, -3], bone: 'body',
  rotation: [-26, 0, 0], origin: [0, 29, -6] });
```

**Put the pivot on the edge you want to keep still.** A pivot at the cube's centre makes it
swing; a pivot at the buried end makes it slope. `slab()` and `bevelEdges()` generate rotated
cubes for you, and `bevelEdges` builds a 45° strip sunk into its parent so only a thin diagonal
face pokes out — one cube per edge to break a hard corner.

Rotation signs follow the model space: `-X` tips a top surface backward, `+X` tips it forward,
`+Z` rolls toward the model's left.

**Bevels and scutes are flush with their parent by construction**, which is exactly the
coincidence case — so follow any `bevelEdges` call with `geometricHygiene`.

## Watch the metrics, but do not obey them blindly

`metrics(model)` scores the texture. Two notes are traps:

- **"faces are nearly single-colour"** — the fix is one shade band and one highlight band
  (`bands(..., { steps: 5 })`), never noise or dithering.
- **"flat faces"** is *reported*, not scored, and deliberately so. Scoring it would reward
  dither, and dither is what makes a Minecraft texture look dirty.

A small palette, ~3 colours per face and clear discrete bands is the target. After a full surface
pass the T-Rex lands at 41 colours and 2.6 colours per face with no palette growth from seam
softening at all — if a surface pass inflates the palette, something is blending rather than
bridging.

## Related skills

- `minecraft-model-builder` — the overall loop, model space, hard rules
- `minecraft-texture-atlas` — islands, bands, brushes, the palette
- `minecraft-model-preview` — rendering detail crops so a 4-pixel problem is actually visible
- `minecraft-uv-mapping` — which island each face samples, and why that decides ownership
- `reference.md` — the full API for rotation, hygiene and harmony
