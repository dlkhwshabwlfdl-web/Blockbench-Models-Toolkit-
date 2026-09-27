# @trex/aimodel

Build Minecraft **models, textures, UV atlases and animations by writing a script**.

There is no Blockbench in the loop, no editor and no plugin. A script — or a plain JSON spec —
goes in; a `.bbmodel`, a PNG atlas, Java model JSON, an Oraxen or ItemsAdder pack, and PNG previews
come out.

```
model + geometry ─┐
texture + palette ├─►  Model  ─►  .bbmodel | Java JSON | Oraxen | ItemsAdder
UV atlas         ─┤              contact sheet PNG | metrics | validation
animations       ─┘
```

This exists so an AI agent (or you) can go from *"a crate with a wooden body, metal bands, and a
lid that opens"* to finished files without a GUI in the middle.

---

## Quick start

```bash
cd "tools ai model generator"
npm install
npm run build
npm run smoke        # builds both examples and asserts 23 structural checks
```

### Build from a JSON spec

```bash
node dist/cli.js build examples/crate.json --out out/crate --bbmodel --preview --metrics
```

```
built crate
  crate: 11 cubes · 2 bones · 3 animations (17 keys, 2 bones animated) · bounds 17×18.8×18
score 93/100 (S)
palette 6 · colours/face 3 · band edges/face 2
flat faces 0% (reported only) · uv use 100%
```

### Build from a script

```js
import { Model, Atlas, bands, clip, pose, validate, writeBbmodel, contactSheet, writeBinary, metrics } from './tools ai model generator/dist/index.js';

const atlas = new Atlas(32, 32);
atlas.define('skin', [0, 0, 32, 32]);
bands(atlas.canvas, atlas.get('skin'), [138, 90, 43], { steps: 5, contrast: 0.45 });

const model = new Model({ name: 'crate', resolution: [32, 32] });
model.bone('root', [0, 0, 0]);
model.bone('lid', [0, 16, -8], 'root');
model.cube({ name: 'body', from: [-8, 0, -8], to: [8, 16, 8], bone: 'root' });
model.cube({ name: 'lid_plate', from: [-8.5, 16, -8.5], to: [8.5, 18, 8.5], bone: 'lid' });

model.addTexture(atlas.toTexture('crate_skin', { useAsDefault: true }));
model.addClip(clip({ name: 'open', loop: 'once', length: 0.6, keys: pose([
  { time: 0,   rotations: { lid: [0, 0, 0] }, interpolation: 'linear' },
  { time: 0.6, rotations: { lid: [-96, 0, 0] } },
]) }));
model.assignUv();

const report = validate(model);
if (!report.ok) throw new Error(report.errors.join('\n'));

writeBbmodel(model, 'out/crate.bbmodel');
writeBinary('out/crate_preview.png', contactSheet(model, { width: 200, height: 200, outline: true }).toPng());
console.log(metrics(model).grade);
```

---

## What is in the box

| Layer | Module | What it does |
|-------|--------|--------------|
| model | `src/model` | bones and pivots, cubes, mirroring, tapered chains, spike rows, UV policies and box UV, **element rotation and 45° bevels** |
| texture | `src/texture` | RGBA canvas, PNG encode/decode, atlas islands, discrete colour ramps, brushes, **palette harmony and seam softening** |
| animation | `src/anim` | keyframe builders, curve sampling, locomotion/idle/tail/head generators, clips |
| export | `src/export` | `.bbmodel`, Java Block/Item + `.mcmeta`, Oraxen, ItemsAdder, YAML, deterministic uuids |
| render | `src/render` | orthographic rasteriser with a depth buffer, skeletal pose evaluation, contact sheets, metrics |
| qa | `src/qa` | structural and UV validation, **coincident-face detection and cleanup** |
| spec | `src/spec.ts` | declarative JSON → `Model` |
| cli | `src/cli.ts` | `aimodel build / render / validate / metrics / hygiene` |

### The three passes that make it look good

Building a model that validates is not the same as building one that is pleasant to look at. Three
passes close that gap, and they run in this order:

```js
model.assignUv();                              // 1. every face needs a window
geometricHygiene(model, { mode: 'hide' });     // 2. remove faces that z-fight, stabilise duplicates
softenSeams(model, { style: 'balanced' });     // 3. bridge the material joins that remain
```

- **`geometricHygiene`** finds faces that occupy the same plane and overlap — two cubes claiming one
  surface, which is what makes a part shimmer as the model turns — and removes or retracts them.
- **`softenSeams`** bridges a colour join across a cube boundary by giving the boundary pixels the
  neighbouring material's own colour. It only ever writes colours already in the texture, only to
  texels a single face samples, and only between different materials, so it cannot inflate the
  palette or contaminate a shared atlas island.
- **`harmonize` / `deriveShade`** fix the other half: a belly picked independently of the back, so
  the join is a hue jump instead of a shade step.

Alongside them, `rotation` and `bevelEdges()` stop the silhouette reading as stacked boxes. Element
rotation is legal on every cube in a `.bbmodel`; a voxel model simply never uses it.

### Conventions

Model space is fixed across the whole toolkit: **`+X` is the model's left, `+Y` is up with the feet
at `y = 0`, and the model faces `+Z`**.

### Determinism

Element, group, texture, animation and keyframe ids are derived from names, so rebuilding a model
produces a **byte-identical** `.bbmodel`. The smoke test asserts this.

### Textures stay clean

The metrics encode what good Minecraft art is, and what it is not. Shading is discrete bands, never
a gradient and never a dither pattern; the palette is counted; about three colours per face is the
target; and *flatness is reported but never scored*, because scoring flatness would rank dithered
noise above clean art.

```
score 86/100 (A)
palette 41 · colours/face 2.56 · band edges/face 1.55
flat faces 30% (reported only) · uv use 100%
bones animated 83% · silhouette 26% coverage
```

The surface passes are held to the same standard. Seam softening writes only colours that were
already present — the numbers above are what the T-Rex scores *after* a full hygiene and seam pass,
and the palette is the same 41 before and after it. A pass that grows the palette is blending
rather than bridging, and is a bug.

### Headless previews

`contactSheet(model)` rasterises every view into one PNG with a depth buffer and a fixed world
light, so you can actually look at what you built — including previews of the rig **posed at a
given animation time**:

```js
import { posedScene, projectScene, viewBasis, samplePose } from './tools ai model generator/dist/index.js';
const scene = posedScene(model, model.clips[0], 0.4);
writeBinary('out/posed.png', projectScene(scene, viewBasis('iso'), { width: 256, height: 256 }).toPng());
```

`scripts/preview.mjs` goes further and writes a **self-contained HTML page** — every side, the
underside, the atlas at 8×, detail crops of the parts that are too small to judge in a full-model
render, a strip per animation sampled through the real skeleton, and all three surface styles side
by side. The PNGs are inlined as data URIs, so it opens anywhere with no server:

```bash
node scripts/preview.mjs trex             # → out/trex_preview.html
```

Or serve the output directory for a browser view:

```bash
node scripts/serve.mjs "$(pwd)" 4181     # → http://127.0.0.1:4181/out/
```

---

## Skills for the AI agent

Eight skill packages live in `skills/`. They teach an agent when and how to use this toolkit, and
they are what makes the workflow "user asks for a model → agent produces files" work.

| Skill | Covers |
|-------|--------|
| `minecraft-model-builder` | the tool location, the build → preview → validate → export loop, hard rules |
| `minecraft-rig-and-bones` | bones, pivots, hierarchies, limbs, chains, spikes, mirrored parts |
| `minecraft-texture-atlas` | atlases, islands, palettes, brushes, the colour rules |
| `minecraft-uv-mapping` | skin-field policy, island rules, explicit windows, box UV |
| `minecraft-animation` | keyframes, curves, the motion generators, what makes motion read correctly |
| `minecraft-surface-finishing` | element rotation, bevels, coincident-face cleanup, palette harmony, seam softening, the sharp/balanced/soft style dial |
| `minecraft-model-preview` | contact sheets, posed animation strips, detail crops, reading the metrics |
| `minecraft-model-export` | `.bbmodel`, Java, Oraxen, ItemsAdder, the CLI |

### Install them

```bash
node scripts/install-skills.mjs            # → <repo>/.agents/skills   (project, default)
node scripts/install-skills.mjs --global   # → ~/.agents/skills        (every project)
node scripts/install-skills.mjs --target DIR
node scripts/install-skills.mjs --dry-run  # validate without writing
```

The agent discovers skills by scanning for `<dir>/<skill>/SKILL.md`, where the file begins with YAML
frontmatter carrying `name` and `description`. The searched locations, highest priority first:

```
{cwd}/.agents/skills/     {cwd}/.claude/skills/     ~/.agents/skills/     ~/.claude/skills/
```

The installer validates that each skill's frontmatter `name` matches its folder and that the
`description` is long enough to be selectable, and refuses to install a broken skill.

After installing, a new agent session in this repository picks them up automatically. Details and
troubleshooting are in `docs/INSTALL-SKILLS.md`.

---

## Examples

| Path | What it shows |
|------|---------------|
| `examples/trex/trex.mjs` | the full API: 98 cubes, 30 bones, 25 animations, 45° bevels, rotated scutes, derived body materials, coincidence cleanup, seam softening, every exporter |
| `examples/crate.json` | the declarative JSON path, no TypeScript |

```bash
node examples/trex/trex.mjs --out out          # model, texture, animations, preview
node scripts/preview.mjs trex                    # a self-contained HTML page with everything in it
```

`trex.mjs` exports `buildTrex(options)`, so the surface dial can be compared on the same model:

```bash
node -e 'const {buildTrex}=await import("./examples/trex/trex.mjs"); const m=buildTrex({style:"soft"}).model; ...'
```

---

## Development

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest (61 tests)
npm run build         # tsc → dist/
npm run smoke         # end-to-end: both examples, 23 structural checks
npm run verify        # typecheck + test + build
```

Tests cover the writer's schema and round-trip, UV precedence and bounds, rig parent maths,
curve sampling, pose evaluation around pivots, the exporters' geometry conversion, the spec
resolver, and the quality invariants (clean banded art must outscore noisy art).

## Documentation

- `docs/SPEC.md` — the declarative JSON spec, in full
- `docs/INSTALL-SKILLS.md` — installing the skills, and how skill discovery works
- `skills/*/SKILL.md` and `skills/*/reference.md` — the agent-facing documentation
- `docs/ARCHITECTURE.md` — how the layers fit together and the decisions behind them

## Caveats

- Java, Oraxen and ItemsAdder carry geometry, UV and texture but **not skeletal animation** — Java
  has no rig. Animations live in the `.bbmodel`.
- The renderer is orthographic only.
- The Oraxen and ItemsAdder pack layouts are conventional defaults; verify against your plugin
  version.
- Java elements rotate about a single axis; multi-axis element rotations are dropped with a warning.
