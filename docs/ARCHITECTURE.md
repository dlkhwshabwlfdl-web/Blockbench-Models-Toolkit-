# Architecture

## The shape of the thing

```
                    ┌──────────────────────────────┐
   script  ────────►│                              │
   JSON spec ──────►│            Model             │
                    │  rig · cubes · textures ·    │
                    │  clips · warnings            │
                    └──────────────┬───────────────┘
                                   │
        ┌──────────────┬───────────┼───────────┬──────────────┐
        ▼              ▼           ▼           ▼              ▼
    export/         render/      qa/        spec.ts       cli.ts
    bbmodel         projector    validate   resolveSpec   commands
    java            scene        coincident
    oraxen          metrics      formatReport
    itemsadder      render
```

The surface passes sit alongside the layers rather than inside one, because each addresses a
different part of a single question — *does this look right?* `model/rotation.ts` shapes the
silhouette, `qa/coincident.ts` removes the geometry that shimmers, and `texture/harmony.ts` fixes
the colours where two materials meet. See "The surface passes" below.

`Model` is the hub and knows nothing about any file format: it is bones, boxes, PNG bytes and
keyframes. Everything else either produces one, consumes one, or inspects one. That is the whole
reason a single build script can emit `.bbmodel`, Java JSON and a plugin pack from the same object,
and why the renderer can draw a model that has never been written to disk.

## Layers, and why the boundaries are where they are

### `src/model` — geometry and rig

Types, the bone hierarchy, cube construction, shape builders, UV policies.

Three decisions worth calling out:

**`Rig.add` validates immediately.** A missing parent, a duplicate name or self-parenting throws at
the line that caused it, not later in a validator. An agent writing a rig gets told the moment it
gets the order wrong, which is the single most common rig mistake (a child declared before its
parent).

**Corners are normalised.** `from`/`to` may be given in either order and are sorted into min/max.
Mirrored limbs flip sign on X, which would otherwise require every caller to swap the corners by
hand.

**`faceFrame(cube, face)` is the shared contract.** It returns the corner that maps to the UV
rect's `(u1, v1)` plus the U and V axes. The UV policy positions windows through it and the
renderer samples through it. Because both read the same definition, a face's texture cannot be
mirrored between "what the atlas expects" and "what the preview shows".

### `src/texture` — the atlas

`Canvas` is a plain RGBA `Uint8Array` with `pngjs` used only to encode/decode. No 2D canvas library:
textures here are 16–256 px, the operations are pixel-exact, and staying on a typed array means a
rebuild is bit-identical on every machine and every Node version.

`Atlas` divides one image into named islands. `define()` takes a fixed rect and **refuses
overlaps**; `alloc()` shelf-packs when the position does not matter. Overlap is a real bug — two
materials sharing pixels produce a texture that looks corrupted in game — so it is an error rather
than a warning.

`Palette` and `ramp()` exist so shading is a list of discrete values rather than arithmetic at each
call site.

### `src/anim` — motion

`keys.ts` builds and orders keyframes. `curves.ts` samples normalised cycles. `motion.ts` holds the
generators. `clip.ts` assembles.

The generators are the interesting part. `locomotion()` derives three things from one phase: the
knee flexes while the leg swings, the foot counter-rotates to stay near the ground, and the toes
grip on the push-off. All three are needed before a cube leg stops reading as a wind-up toy, and
deriving them together means a caller tunes `stride`, `knee` and `bob` instead of fighting four
independent wave phases.

`cycle()` samples `samples + 1` points, both endpoints included, because a loop whose endpoints
disagree pops every cycle.

`tailWave`, `breathe`, `idleSway`, `headTurn` and `chain` all propagate a per-segment lag, which is
what makes a chain look attached rather than assembled.

### `src/export` — writers

`bbmodel.ts` is hand-written JSON rather than a round-trip through Blockbench, so it has to match
Blockbench's schema exactly. Two details are easy to get wrong and are asserted in the smoke test:
outliner children are **element uuid strings or group objects**, and animation animators are keyed
by the **bone's uuid**, not its name.

Ids come from `UuidSpace`, derived from `hash(name:key)`. Rebuilding writes a byte-identical file,
which is what makes diffs meaningful when a model changes over many sessions.

`java.ts` converts model space (Y up, feet at `y = 0`) into Java's y-down space, scales to a
16-unit box and centres horizontally. It warns — rather than silently misplacing geometry — when a
cube rotates about more than one axis, because Java models cannot express that.

`oraxen.ts` / `itemsadder.ts` reuse the Java writer and add the pack layout and a config, with the
model's texture reference and the config's texture list derived from one namespace so they cannot
disagree. `yaml.ts` is a ~60-line emitter so the package keeps a single runtime dependency.

### `src/render` — headless previews

`scene.ts` evaluates the rig: `samplePose(clip, time)` interpolates each channel, then
`boneWorldTransforms` folds the hierarchy into `parent · T(pivot) · R · S · T(−pivot)` per bone, and
`buildScene` bakes the transforms into world-space face corners. Normals go through the linear part
only.

`projector.ts` then rasterises those faces. Two choices:

**A depth buffer, not a painter's sort.** Boxes in a rig interpenetrate freely; a centroid sort
draws the wrong box on top the moment two overlap. A per-pixel depth test costs one `Float64Array`
and removes the whole class of ordering artefacts.

**A fixed world light.** If lighting followed the camera, every view would look evenly lit and the
contact sheet would hide exactly the shape problems it exists to reveal.

`metrics.ts` scores the result in numbers. The design of this metric is the most opinionated part
of the toolkit, and is explained below.

### The surface passes: `src/model/rotation.ts`, `src/qa/coincident.ts`, `src/texture/harmony.ts`

These three exist because "builds and validates" is not the same as "looks right", and because the
three ways a model looks wrong need three different fixes.

**`rotation.ts` makes element rotation usable.** It is legal on every cube in a `.bbmodel` and a
voxel model simply never uses it, which is why a generated model reads as stacked boxes. The
insight that makes it cheap is that **the buried end of a rotated slab is invisible**: put the
pivot on the edge you want to keep still, tilt the box 8–25°, and a sloped surface costs one angle
and no extra geometry. `bevelEdges()` builds a 45° strip the same way — a cube model cannot
subtract material, so it is built the other way round, as a square strip rotated about the edge and
sunk into its parent until only a diagonal face pokes out.

`mat4.ts` lives in `util` rather than in the renderer for this reason. A cube's element rotation has
to be evaluated when computing its corners — for bounds, for rendering, and for the coincidence
check — and one implementation means a rotated box is described identically everywhere.

**`coincident.ts` finds the faces that shimmer.** Two faces on one plane and overlapping make the
rasteriser pick a winner per pixel with no stable answer. Faces are grouped by canonical plane,
then pairwise-clipped to measure the overlap, and separated into two cases because the fix differs:
`interior` (opposite normals — invisible from outside, so a fully covered face is simply deleted)
and `duplicate` (same normal — one must win, deterministically, which is why only the later cube is
ever touched).

The subtle part is coverage. It is accumulated **per face across all its neighbours**, not read off
a single pair. A small ridge sitting on a wide back is coincident with the back's top face only
where it touches; hiding that face because "the overlap covers 100% of the smaller face" would cut
a hole straight through the model. Getting this wrong is invisible in a report and obvious on the
model — one case the smoke test now pins.

**`harmony.ts` fixes joins, in two halves.** `harmonize` and `deriveShade` address the *material*:
a belly picked independently of the back is not a shading problem, it is two hues that were never
related, so the fix is to derive one from the other and pull the set onto a shared hue while leaving
lightness alone. `softenSeams` addresses the *boundary*: it finds every pair of faces meeting along
a 3D edge and gives the boundary pixels the neighbouring material's own colour.

Three rules in `softenSeams` are worth stating because each one is a bug that had to be found:

1. **Only the neighbour's own colour is written.** The first implementation blended the two colours
   and snapped the result to the palette. Halfway between olive skin and pink tongue is a colour
   that belongs to neither, and it landed as a pink speck on the model's back. Writing the
   neighbour's colour makes the join a discrete interleave: the palette cannot grow and no
   unrelated colour can appear.
2. **Only texels with a lone owner are written.** Islands are shared surfaces — the T-Rex belly
   island is four pixels square and about forty faces read it — so a rim written for one reader
   appears on all of them. For a large island that is right; for a small one it is destructive (an
   olive rim on a four-pixel claw island turns every claw pale) and the tool cannot tell them
   apart. So it declines, counts the join in `sharedJoins`, and leaves the fix to `deriveShade`.
   `shareIslands: true` opts into the rim for the cases where it is correct.
3. **Only joins between different materials are bridged.** Two bands of one skin ramp meeting at a
   cube edge is the texture working as intended; blurring it turns a crisp model into noise.

A boundary shared edge is found by overlapping *segments*, not by matching equal corner pairs. That
catches a torso and a chest block sharing a whole plane, a bevel sharing part of an edge, a
sub-segment meeting the middle of another face — and, most importantly, the adjacent faces of a
**single** cube, which is where a UV policy most often sends two atlas islands onto neighbouring
faces and which equal-corner matching on different cubes misses entirely.

One detail that cost a debugging session: a UV window is half-open, `[a, b)`, so the boundary at
`u = b` is the outside edge of pixel `b - 1`. Rounding the coordinate and stepping inward from there
put the first band one pixel *outside* the window for every join on the far side of a face, quietly
skipping about half of them.

### `src/spec.ts` and `src/cli.ts`

`resolveSpec` makes the toolkit usable as pure data: bones, cubes, materials, animations. Each
material gets an island painted with a band ramp, and faces are pointed at it. This is the path for
an agent that would rather emit one JSON object than a program, and `crate.json` shows it reaching
93/100 with eleven lines of geometry.

The CLI is a thin shell over the same functions: `build`, `render`, `validate`, `metrics`,
`hygiene`. `build` validates first and exits non-zero on errors so it can be a build step, and takes
`--hygiene` and `--soften [--style sharp|balanced|soft]` to run the surface passes inside it.
`hygiene` stands alone because it is a *diagnostic*: `--mode report` lists every coincident pair
without changing anything and exits non-zero when it finds one, so it works as a CI gate.

## The quality metric, and the mistake it corrects

An earlier iteration of this toolkit scored a texture partly on how *flat* it was — the reasoning
being that Minecraft art is flat. That reasoning is wrong in a specific and destructive way:
scoring flatness rewards per-pixel dithering, because a randomly speckled texture is never flat.
The metric graded noise above clean art, and the generated textures came out looking dirty.

The current metric measures what actually correlates with good Minecraft art:

| Signal | Target | Weight |
|--------|--------|--------|
| `palette` | 8–48 distinct colours | 0.34 |
| `coloursPerFace` | ≈3 (base, shade, highlight) | 0.36 |
| `bandEdgesPerFace` | rises to 3, then saturates | 0.15 |
| `animatedBoneShare` | higher is better | 0.15 |

`flatFaceShare` is **reported and never scored**. It is useful information — a face with one colour
has no shading at all — but it must not be an objective, or the optimiser finds the dither.

Two more details that matter:

- **`bandEdgesPerFace` samples both the middle row and the middle column** and keeps the richer
  reading. A vertical band ramp has no horizontal transitions; scoring only the row would punish
  exactly the shading the toolkit encourages.
- **`palette` peaks in 8–48, not 8–30.** A skin with ten materials legitimately needs a few dozen
  colours; the tighter bound punished multi-material models for being multi-material.

`grade` is S ≥ 90, A ≥ 78, B ≥ 65, C ≥ 50, else D. `A` is the bar the skills tell an agent to
clear.

## Validation vs metrics

They answer different questions and both run:

- `validate()` — **is it correct?** Missing UV, out-of-bounds UV, duplicate cube names, a keyframe
  on a bone that does not exist, an empty clip, a non-positive length, an invalid interpolation,
  multiple roots, a texture that does not match the resolution. Errors and warnings.
- `metrics()` — **is it good?** Palette, per-face colour count, banding, silhouette symmetry,
  animation coverage, a score and a grade.

A model can be valid and bad, or pretty and broken. The skills require both.

## Determinism

Every id is derived from a name, every texture operation is integer arithmetic on a `Uint8Array`,
noise is a hash rather than `Math.random`, and keyframe values are rounded to three decimals. The
consequence is that a rebuild produces identical bytes, which the smoke test asserts — and which is
what makes it safe for an agent to regenerate a model it built in a previous session.

## Testing strategy

`tests/core.test.ts` covers the primitives: normalisation, mirroring, face frames, UV precedence,
canvas bounds, band discreteness, palette clamping, rig ordering, cycle endpoints, phase
counter-rotation.

`tests/pipeline.test.ts` covers the whole way through: the `.bbmodel` schema and outliner shape,
deterministic rebuild, Java Y-fitting and UV bounds, the multi-axis rotation warning, both plugin
pack layouts, YAML emission, the spec resolver's errors and warnings, view orthonormality, projected
aspect ratios, pivot-centred pose transforms, and the two metric invariants that matter — clean
banded art must outscore noisy art, and flatness must be reported without being scored.

`tests/surface.test.ts` covers the surface passes: that a tilt moves corners off the axis grid and a
pivot on a buried edge leaves the exposed edge where it was, that a bevel resolves to a 45° strip on
the free axis, that a small ridge does **not** take the whole back face with it when its coverage is
retracted, that a partly overlapping duplicate is retracted rather than deleted, that a shade keeps
its hue, and — the ones that matter most — that seam softening writes nothing in the `sharp` style,
nothing when a texel has more than one owner, nothing between two faces of one material, and never
any colour that was not already in the texture.

`scripts/smoke.mjs` is the end-to-end gate: it builds both examples and asserts 28 structural
properties of the output, including that the `.bbmodel` re-parses with every element referenced
from the outliner and every animator keyed by a real group uuid, that the model uses element
rotation at all, and that geometry hygiene cuts coincident pairs from 105 to 5. It also compares the
texture before and after the seam pass and fails if any new colour appears.

## Deliberate limitations

- **No skeletal animation outside `.bbmodel`.** Java has no rig; the Java, Oraxen and ItemsAdder
  writers carry geometry, UV and texture, and bake nothing. A Bedrock `.geo.json` +
  `.animation.json` adapter is the natural next exporter for animation consumed by a plugin.
- **Orthographic rendering only.** A perspective camera would flatter the model rather than
  describe it.
- **Seam softening cannot help a join on a shared atlas island.** Islands are shared surfaces, so a
  per-face boundary treatment is impossible on one, and for a small island it is actively harmful.
  The pass declines and reports `sharedJoins`; the fix at that point is the material, not the seam.
  A future pass could sub-window an island per face at build time and remove the limit.
- **Rotation is not interpreted by the Java writer.** Java cannot express a rotation about more than
  one axis, so `java.ts` warns rather than silently misplacing geometry; bevels and scutes exported
  to Java lose their angles.
- **Plugin pack layouts are conventional defaults.** They have moved between Oraxen and ItemsAdder
  releases; the writers parameterise `outDir` so the caller can match their install.
