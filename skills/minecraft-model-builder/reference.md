# Toolkit reference

Package: `@trex/aimodel` at `F:\resourcepack\Trex\tools ai model generator`.

## Build once

```bash
cd "tools ai model generator"
npm install
npm run build        # tsc → dist/
npm run typecheck    # tsc --noEmit
npm test             # vitest
npm run smoke        # build + end-to-end example checks
```

Scripts import from `dist/index.js`. There is also a CLI at `dist/cli.js` and three subpath
entry points: `.` (everything), `./export`, `./render`.

## The object model

```
Model
 ├── rig: Rig            bones (groups): name, pivot, parent
 ├── cubes: Cube[]       boxes: from, to, bone, faces[face] = UvRect, origin, rotation, inflate
 ├── textures: Texture[] PNG bytes + resolution metadata
 ├── clips: Clip[]       name, loop, length, keys[{ bone, channel, time, value, interpolation }]
 └── warnings: string[]  non-fatal problems collected while building
```

`Model` is format-agnostic. Exporters serialise it; the renderer draws it; `validate()` checks it.

## Full export surface (`src/index.ts`)

| Group | Exports |
|-------|---------|
| model | `Model`, `Rig`, `makeCube`, `faceFrame`, `faceCorners`, `cubeSize`, `cubeCenter`, `mirrorCube`, `series`, `mirrorPair`, `spikes`, `boneChain`, `segmentedBoxes`, `plate`, `assignUv`, `skinFieldPolicy`, `boxUv`, `FACE_NAMES`, `FACE_NORMALS` |
| texture | `Canvas`, `Atlas`, `islandRules`, `Palette`, `ramp`, `rgba`, `tint`, `fill`, `grain`, `bands`, `bevel`, `seam`, `outline`, `radial`, `eye`, `blotch`, `dither`, `blendPixel`, `eachPixel` |
| animation | `kf`, `rot`, `rot3`, `pos`, `pos3`, `scale`, `scaleUniform`, `sortKeys`, `dedupeKeys`, `mergeKeys`, `keyCountByBone`, `animatedBones`, `maxTime`, `cycle`, `cycleBones`, `chain`, `sin`, `cos`, `saw`, `triangle`, `bump`, `pulse`, `ease`, `rampUp`, `decay`, `locomotion`, `tailWave`, `breathe`, `headTurn`, `idleSway`, `defaultMotionRig`, `clip`, `clipAuto`, `pose` |
| export | `toBbmodel`, `serializeBbmodel`, `writeBbmodel`, `toJavaModel`, `writeJavaModel`, `toMcmeta`, `javaTransform`, `DEFAULT_JAVA_DISPLAY`, `writeOraxen`, `writeItemsAdder`, `ensureDir`, `writeText`, `writeJson`, `writeBinary`, `fileStem`, `toYaml` |
| render | `projectScene`, `projectModel`, `viewBasis`, `VIEWS`, `contactSheet`, `clipStrip`, `renderToFile`, `metrics`, `formatMetrics`, `buildScene`, `restScene`, `posedScene`, `samplePose`, `boneWorldTransforms`, `identity`, `multiply`, `translation`, `rotationX`, `rotationY`, `rotationZ`, `rotationZYX`, `scaleMatrix`, `transformPoint`, `transformDirection` |
| qa | `validate`, `assertValid`, `formatReport` |
| spec | `resolveSpec` plus its spec types |
| util | `clamp`, `lerp`, `round3`, `hashString`, `noise2`, `fbm2`, `hexToRgb`, `rgbToHex`, `mixRgb`, `shadeRgb`, `uuidFor`, `UuidSpace` |

## Model methods

| Call | Purpose |
|------|---------|
| `new Model({ name, resolution?, identifier?, uvPolicy? })` | resolution defaults to 64×64 |
| `model.bone(name, pivot, parent?, extra?)` | declare a bone (parents first) |
| `model.cube(options)` | add a cube (bone must exist) |
| `model.addTexture(texture)` / `model.addClip(clip)` | attach |
| `model.assignUv(policy?)` | resolve every face's UV window |
| `model.bounds()` / `model.size()` | extent |
| `model.findCube(name)` / `model.cubesOf(bone)` / `model.boneOf(cube)` | lookup |
| `model.translateBone(bone, delta)` / `model.reassign(from, to)` | edit |
| `model.summary()` | one-line description |

## Examples in this repository

| File | Demonstrates |
|------|--------------|
| `examples/trex/trex.mjs` | 82 cubes, 30 bones, 25 animations, islands, island rules, motion generators, all exporters |
| `examples/crate.json` | the declarative JSON spec path (no TypeScript at all) |

```bash
node examples/trex/trex.mjs --out out
node dist/cli.js build examples/crate.json --out out/crate --bbmodel --preview --metrics
```

## Where things live

```
tools ai model generator/
  src/model/       types, rig, cubes, shapes, uv, model
  src/texture/     canvas, palette, brush, atlas
  src/anim/        keys, curves, motion, clip
  src/export/      io, uuid-backed bbmodel, java, oraxen, itemsadder, yaml
  src/render/      projector, scene, render, metrics
  src/qa/          validate
  src/spec.ts      declarative spec → Model
  src/cli.ts       aimodel CLI
  examples/        trex, crate
  skills/          these skill packages (installed to .agents/skills)
  scripts/         install-skills, smoke, serve
  docs/            SPEC.md
```
