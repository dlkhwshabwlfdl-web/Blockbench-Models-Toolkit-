# Surface finishing — full API

Everything is exported from the package barrel:

```js
import {
  // rotation
  setRotation, rotateAround, clearRotation, elementMatrix, bevelEdges, slab,
  // geometry hygiene
  findCoincidentFaces, findDuplicateCubes, geometricHygiene, faceSurfaceAreas, formatCoincidence,
  // colour
  harmonize, deriveShade, bridgeColors, softenSeams, resolveStyle, SURFACE_STYLES,
  rgbToHsl, hslToRgb,
} from '../dist/index.js';
```

---

## Element rotation

Rotation is stored on the cube in `.bbmodel` terms: `rotation: [x, y, z]` in degrees, applied in
the ZYX order Blockbench uses, around `origin` (default: the cube's centre). Every consumer of
the geometry — bounds, rendering, the coincidence check, the seam pass — evaluates it through
`posedFaceCorners`, so there is one answer to "where is this box".

```js
model.cube({ name: 'nose_tip', from: [-3, 32, 40], to: [3, 37.5, 44], bone: 'upper_jaw',
  rotation: [7, 0, 0],            // 7° about X
  origin: [0, 34, 40] });         // pivot at the back of the snout, which stays put
```

### `setRotation(cube, rotation, origin?)`
Sets the rotation outright. Returns the cube.

### `rotateAround(cube, axis, degrees, origin?)`
Composes a single-axis rotation onto whatever is already there. `axis` is `'x' | 'y' | 'z'`.

### `clearRotation(cube)`
Back to pure voxel.

### `elementMatrix({ rotation, origin })`
The 4×4 transform, `T(origin) · R · T(−origin)`. Rarely needed directly; useful when you want to
place something relative to a rotated cube.

### Which way does a sign go?

For a rotation about X, a point at local offset `(0, y, z)` from the pivot maps to
`(0, y·cosθ − z·sinθ, y·sinθ + z·cosθ)`.

| Want | Do |
|------|-----|
| tip a top surface **backward** (−Z) | negative X |
| tip a top surface **forward** (+Z) | positive X |
| make a muzzle droop at the front | positive X, pivot at the snout's back |
| angle a fin **outward** to the model's left | negative Z on the left side |
| flare a cheek toward the jaw | negative Y on the left, positive Y on the right |

### `slab({ name, from, to, bone, axis, degrees?, origin?, color? })`
Returns a `CubeOptions` for a rotated box. The useful trick: put the pivot on the buried edge and
the visible part becomes a wedge, so a slope costs one cube and no subtraction.

```js
model.cube(slab({ name: 'shoulder_fin', from: [6, 22, 4], to: [9, 27, 10], bone: 'chest',
  axis: 'z', degrees: -10, origin: [6, 24.5, 7] }));
```

### `bevelEdges({ name, from, to, bone, edges, chamfer?, inset?, color? })`
Returns an **array** of `CubeOptions` — one per edge. Spread them into the model.

```js
for (const spec of bevelEdges({
  name: 'torso', from: [-7, 17, -9], to: [7, 29, 3], bone: 'body',
  edges: ['top-left', 'top-right'], chamfer: 3.4, inset: 0.45,
})) model.cube(spec);          // bevelEdges returns specs; model.cube() registers them
```

- `edges` — any of `top-`/`bottom-` + `front-`/`back-`/`left-`/`right-`, e.g. `'top-left'`,
  `'front-right'`, `'bottom-front'`. Each name must use two different axes.
- `chamfer` — how far the bevel reaches along each adjoining face (default 1.5).
- `inset` — how deep the strip sits inside the box, as a fraction of `chamfer` (default 0.5).
  `1` buries it completely, `0.25` makes the corner stand out more.

A cube model cannot subtract material, so a bevel is built the other way round: a square strip
rotated 45° about the edge and sunk in, so only a thin diagonal face pokes out. Layout: `+X` is
the model's left, `+Z` is the direction it faces.

**Always run `geometricHygiene` after adding bevels.** The strip shares its end planes with its
parent by construction, and the parent's faces there are coplanar duplicates.

---

## Geometry hygiene

```js
import { findCoincidentFaces, geometricHygiene, formatCoincidence } from '../dist/index.js';

console.log(formatCoincidence(findCoincidentFaces(model)));
geometricHygiene(model, { mode: 'hide' });
```

### `findCoincidentFaces(model, options?) → CoincidenceReport`

Faces are grouped by canonical plane (normal, sign-normalised, plus offset within `tolerance`),
then pairwise-clipped (Sutherland–Hodgman) to measure the overlap.

| Field | Meaning |
|-------|---------|
| `pairs[].kind` | `'interior'` (opposite normals) or `'duplicate'` (same normal) |
| `pairs[].a` / `.b` | `{ cube, face }` |
| `pairs[].overlap` | overlapping area, model units² |
| `pairs[].coverage` | overlap as a fraction of the **smaller** face |
| `pairs[].gap` | distance between the two planes |
| `duplicates[]` | cubes with identical bounds *and* rotation |

`options: { tolerance = 0.02, minOverlap = 0.001 }`.

Only *visible* faces participate. A hidden face cannot z-fight and is ignored.

### `geometricHygiene(model, options?) → HygieneResult`

| Option | Default | Meaning |
|--------|---------|---------|
| `mode` | `'hide'` | `'hide'`, `'separate'` (retract every coincident face), `'report'` (inspect only) |
| `hideCoverage` | `0.9` | fraction of a face that must be covered before it is removed |
| `epsilon` | `0.05` | how far a retracted face moves |

Coverage is accumulated **per face across all its neighbours**, not taken from a single pair.

- **interior** — a fully covered face is hidden. It is buried inside solid geometry, so removing
  it is free and it cannot be seen either way. A partly covered interior face is left alone: the
  coincident patch is usually buried too, and retracting it would open a hairline gap.
- **duplicate** — fully covered → the later cube's face is hidden. Partly covered → it is
  retracted inward, just behind the winner, so the winner takes every pixel. Only the later cube
  is touched, so the surviving surface is identical on every rebuild.

Returns `{ report, resolved, hiddenByCube }`, where `resolved` lists every
`{ cube, face, reason }` that was acted on.

### `faceSurfaceAreas(model, tolerance?) → Map<'cube|face', number>`
Visible face area per face, in model units². Useful for deciding your own `hideCoverage`.

### `findDuplicateCubes(model) → Array<{ a, b }>`
Cubes with identical bounds and rotation — almost always an accidental copy.

---

## Colour harmony

```js
import { harmonize, deriveShade, bridgeColors, rgbToHsl, hslToRgb } from '../dist/index.js';
```

### `harmonize(colors, options?) → Array<[r,g,b]>`

| Option | Default | Meaning |
|--------|---------|---------|
| `strength` | `0.55` | 0 leaves the colours alone, 1 collapses them onto one hue |
| `targetHue` | saturation-weighted mean | hue to move toward, in degrees |
| `pinned` | `[]` | indices that must not move (a loud accent colour) |

Lightness and saturation are deliberately preserved — only the hue moves. A set that already
reads as one material at different depths keeps its depth; it just stops jumping between olive
and swamp.

### `deriveShade(base, options?) → [r,g,b]`

| Option | Default | Meaning |
|--------|---------|---------|
| `lightness` | `0` | signed offset, −1..1 |
| `saturation` | `1` | multiplier on saturation |
| `hueShift` | `0` | degrees |

`base` may be `[r,g,b]` or `'#rrggbb'`. This is how a belly, a scute plate or a shadowed
underside should be chosen: same hue, darker. Picking a plausible-looking but unrelated colour
means the join is only discovered when the model is viewed from below.

### `bridgeColors(a, b, steps = 2) → Array<[r,g,b]>`
Intermediate colours between two materials, for a hand-painted bridge band.

### `rgbToHsl(rgb)` / `hslToRgb([h, s, l])`
Round-trip helpers. `h` is 0–360, `s` and `l` are 0–1.

---

## Seam softening

```js
import { softenSeams, resolveStyle, SURFACE_STYLES } from '../dist/index.js';

const result = softenSeams(model, { style: 'balanced' });
```

### `resolveStyle(name | partial) → SurfaceStyle`
`SURFACE_STYLES` holds the three presets; a partial override fills in from `balanced`:

```js
resolveStyle({ edgeSoftness: 2, seamStrength: 1 })   // bands/contrast come from balanced
```

### `softenSeams(model, options?) → SoftenSeamsResult`

Mutates `model.textures[0]` in place.

| Option | Default | Meaning |
|--------|---------|---------|
| `style` | `'balanced'` | preset name, or a partial `SurfaceStyle` |
| `softness` | from style | how many pixels wide the transition is, counting the solid join |
| `strength` | from style | density of the dithered bands beyond the solid join |
| `minDifference` | `60` | minimum Manhattan colour difference to bother bridging |
| `tolerance` | `0.02` | how close two edges must be to count as joined |
| `pose` | rest pose | skeleton pose to measure the geometry in |
| `acrossMaterialsOnly` | `true` | only bridge joins between different materials |
| `shareIslands` | `false` | allow writes to texels several faces read (see below) |

Result: `{ pairs, blended, pixels, softness, strength, sharedJoins }`.

**How a join is found.** Every visible face is reduced to four 3D boundary segments. Two segments
that are collinear within `tolerance` and overlap along at least a pixel's worth of length
produce a shared edge. This catches the cases that equal-corner matching misses: a torso and a
chest block sharing a whole plane, a bevel sharing only part of an edge, a sub-segment of one
face meeting the middle of another's — and, most importantly, the adjacent faces of a **single**
cube, which is where a UV policy most often sends two atlas islands onto neighbouring faces.

**How a join is written.** The shared 3D segment is mapped into the texture on both sides. For
each sampled point, the boundary pixel of one face takes the colour of the other material sampled
a little way inside it. The first band is solid; further bands are dithered, thinning inward. The
only colour ever written is one that was already in the texture, so the palette cannot grow and
no unrelated colour can appear.

**Ownership.** By default a texel is only written when exactly one face samples it. That is a
hard guarantee: the pass can never alter artwork another face depends on. It matters because
islands are shared surfaces — the belly island here is four pixels square and about forty faces
read it — so a rim written for one reader appears on all of them. For a large island that is fine;
for a small one it is destructive, and the tool cannot tell them apart, so it declines and counts
the join in `sharedJoins`.

When `sharedJoins` is non-zero, the right fix is almost always **the material, not the seam**:
`deriveShade` the secondary colour from the primary so the join is a shade step rather than a hue
jump. `shareIslands: true` writes the rim across the whole island instead — correct for a large
island, wrong for a four-pixel one.

**Order of operations.**

```js
model.assignUv();                                     // 1. every face needs a window
geometricHygiene(model, { mode: 'hide' });            // 2. drop buried faces, stabliise duplicates
softenSeams(model, { style: options.style });         // 3. bridge what is left
```

Running hygiene first means hidden faces are skipped by the seam pass. Running `softenSeams`
before `assignUv` would sample windows that do not exist yet.

---

## Choosing a style

| | `sharp` | `balanced` | `soft` |
|---|---|---|---|
| `edgeSoftness` | 0 | 1 | 3 |
| `seamStrength` | 0 | 0.6 | 0.55 |
| `paletteHarmony` | 0.35 | 0.55 | 0.7 |
| `bands` | 4 | 5 | 7 |
| `contrast` | 0.45 | 0.45 | 0.38 |
| Typical request | "keep it crisp / voxel / vanilla" | (default) | "make it smoother / more organic" |

`sharp` makes `softenSeams` a no-op, which is a legitimate answer — if the user wants a crisp
voxel model, do not talk them out of it. Use the smoothness dial for the seam pass, and the
material step for anything on a shared island.
