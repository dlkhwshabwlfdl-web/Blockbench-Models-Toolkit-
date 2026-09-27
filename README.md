# Blockbench Models Toolkit

**Build Minecraft entity models — geometry, texture, UV atlas and animations — by writing a script.**

No Blockbench in the loop, no editor, no plugin. A TypeScript script (or a plain JSON spec) goes in;
a `.bbmodel`, a PNG atlas, Java model JSON, an Oraxen or ItemsAdder pack, and rendered preview PNGs
come out. It was built for one workflow: **a user describes a creature, an AI agent writes the
script that builds it.**

```
model + geometry ─┐
texture + palette ├─►  Model  ─►  .bbmodel | Java JSON | Oraxen | ItemsAdder
UV atlas          ─┤             contact sheet PNG | quality metrics | validation
animations        ─┘
```

```bash
npm install && npm run build
npm run smoke        # builds all three examples end-to-end, 35 checks
```

---

## What it actually does

| | |
|---|---|
| **Geometry** | Bones and pivots, cubes, real **element rotation**, 45° **bevels**, mirroring, tapered chains, spike rows — not just axis-aligned voxel boxes |
| **Texture** | RGBA canvas, PNG encode/decode, atlas islands, discrete colour ramps, brushes, **palette harmony** and geometry-aware **seam softening** |
| **UV** | Island-based atlas policies, per-face rules, skin-field fallback, box UV |
| **Animation** | Keyframe builders, curve sampling, idle / walk / run / tail / head generators, clips with real skeletal posing in previews |
| **Export** | `.bbmodel`, Java Block/Item + `.mcmeta`, Oraxen, ItemsAdder, YAML — with deterministic UUIDs |
| **QA** | A **geometric gate** that fails the build on open joints or invisible parts, coincident-face cleanup, and quality metrics tuned to what good Minecraft art is |
| **Render** | Headless orthographic rasteriser with a depth buffer — contact sheets, posed animation strips, detail crops |

### The QA gate — the part that makes agent-built models trustworthy

Two failure modes are invisible in a quality score and ruin a model anyway:

1. **Open joints.** Two cubes that merely *touch* are valid geometry and look fine at rest —
   and open into a visible slit the moment either side rotates. `auditSeal` measures how much
   material each joint actually shares (exact SAT penetration depth over 15 axes) and fails the
   build below a threshold.
2. **Invisible parts.** A cube can exist, be textured, be UV-mapped — and be entirely inside
   another cube. This is how a model ships with "no eyes": the eye is there at x 5.25, and the
   cheek plate reaches x 5.9. `findBuriedFaces` reports any cube with no visible face left.

Both run inside the build. A build either passes or exits non-zero:

```
seal · 155/155 joint(s) interpenetrating
  weakest sealed joint 1.00u — front_foot_left_cube ↔ front_toe_left_2
occlusion · 1 hidden cube(s) · 296 buried face(s) · 775 partly
  HIDDEN tongue — present, textured, and behind jaw_hinge   ← correct: it shows when the jaw opens
```

---

## Gallery: prompt → script → result

Every example in `examples/` was written the way an agent would write it — a description in, one
script out. The numbers are real output from the current build.

### Fire Dragon
**Brief:** *"A large, muscular quadruped boss — massive body, long neck, big skull with a defined
jaw and two large horns, dorsal spikes, powerful legs with clear claws, a long tapering
multi-segment tail, and big half-folded wings. Skin: deep reds and fire oranges, dark horn/claw
brown, yellow eyes with orange centres. No noise, no dithering."*

```
$ node examples/firedragon/firedragon.mjs --out out
fire_dragon: 204 cubes · 46 bones · 21 animations (2948 keys, 40 bones animated)
bounds 55×53×137.5
score 93/100 (S) · palette 47 · colours/face 3.31
seal · 155/155 joints interpenetrating · every detail part visible
```

- Half-folded wings built from shared hinges at real joints (shoulder → elbow → wrist → fingers)
- Jaw that opens without tearing, tongue and teeth that are actually visible
- Tail of 8 interpenetrating segments that stays sealed through its whole wave animation
- Gates: 21 one-shot and looping clips — idle, walk, run, prowl, flap, glide, takeoff, land,
  fire breath, roar, bite, claw swipe, tail whip, hurt, sleep

**Prompt → file:** [`examples/firedragon/firedragon.mjs`](examples/firedragon/firedragon.mjs)

### T-Rex
**Brief:** *"A T-Rex with an articulated tail, neck and jaw — and keep the original green
colour scheme. Make the waist and back join cleanly and the posture read as an animal, not a
stack of boxes."*

```
trex: 98 cubes · 30 bones · 25 animations (3176 keys, 26 bones animated)
score 86/100 (A) · palette 41 · colours/face 2.56
```

- 45° bevels on the torso, rotated scutes down the spine, real element rotation throughout
- Two-tone skin with derived shades — the belly is computed *from* the back colour, so the join
  is a shade step, never a hue jump
- Seam softening wrote zero new colours: the palette is 41 before and after

**Prompt → file:** [`examples/trex/trex.mjs`](examples/trex/trex.mjs)

### Crate
**Brief (JSON, not code):** *"A wooden crate with metal bands and a lid that opens."*

```json
{
  "name": "crate",
  "resolution": [32, 32],
  "bones": [{ "name": "root" }, { "name": "lid", "parent": "root" }],
  "cubes": [{ "name": "body", "from": [-8, 0, -8], "to": [8, 16, 8], "bone": "root" }],
  "clips": [{ "name": "open", "loop": "once", "length": 0.6 }]
}
```

```
crate: 11 cubes · 2 bones · 3 animations
score 93/100 (S) · palette 6
```

The same JSON-spec path works for anything — it is the route an agent takes when it wants a
model described declaratively instead of procedurally.

**Prompt → file:** [`examples/crate.json`](examples/crate.json)

### Preview everything without a GUI

```bash
node scripts/preview.mjs firedragon   # → out/firedragon_preview.html
```

One **self-contained** HTML page (PNGs inlined as data URIs, no server): every side, the
underside, the atlas at 8×, detail crops of parts too small to judge in a full render, and a
strip per animation sampled through the real skeleton. This is the page the examples above were
judged on.

---

## Skills for the AI agent

Eight installable skill packages in `skills/` teach an agent *when and how* to use the toolkit —
the build → gate → preview → validate → export loop, the colour rules, the joint rules, and the
export targets. This is what makes "user asks for a model → agent produces files" work:

| Skill | Covers |
|-------|--------|
| `minecraft-model-builder` | tool location, the build loop, hard rules |
| `minecraft-rig-and-bones` | bones, pivots, hierarchies, chains, mirrored parts |
| `minecraft-texture-atlas` | atlases, islands, palettes, brushes, colour rules |
| `minecraft-uv-mapping` | skin-field policy, island rules, explicit windows, box UV |
| `minecraft-animation` | keyframes, curves, motion generators |
| `minecraft-surface-finishing` | rotation, bevels, hygiene, harmony, the sharp/balanced/soft dial |
| `minecraft-model-preview` | contact sheets, posed strips, reading the metrics |
| `minecraft-model-export` | `.bbmodel`, Java, Oraxen, ItemsAdder, the CLI |

```bash
node scripts/install-skills.mjs            # → <repo>/.agents/skills   (project)
node scripts/install-skills.mjs --global   # → ~/.agents/skills        (every project)
```

Discovery scans `{cwd}/.agents/skills/`, `{cwd}/.claude/skills/`, `~/.agents/skills/`,
`~/.claude/skills/` for `<skill>/SKILL.md`. Details: [`docs/INSTALL-SKILLS.md`](docs/INSTALL-SKILLS.md).

---

## Quick start

```js
import { Model, Atlas, bands, clip, pose, validate, writeBbmodel, contactSheet, writeBinary, metrics } from '@trex/aimodel';

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
  { time: 0,   rotations: { lid: [0, 0, 0] } },
  { time: 0.6, rotations: { lid: [-96, 0, 0] } },
]) }));

model.assignUv();
const report = validate(model);
if (!report.ok) throw new Error(report.errors.join('\n'));

writeBbmodel(model, 'out/crate.bbmodel');
writeBinary('out/crate_preview.png', contactSheet(model, { width: 200, height: 200, outline: true }).toPng());
console.log(metrics(model).grade);   // S
```

Or from the CLI:

```bash
node dist/cli.js build examples/crate.json --out out/crate --bbmodel --preview --metrics
```

### Conventions

Model space is fixed across the toolkit: **`+X` is the model's left, `+Y` is up with the feet at
`y = 0`, and the model faces `+Z`.**

### Determinism

Every element, group, texture, animation and keyframe ID is derived from names, so rebuilding a
model produces a **byte-identical** `.bbmodel`. The smoke test asserts this.

### Quality metrics

Shading must be discrete bands, never gradients or dither; the palette is counted; ~3 colours per
face is the target; flatness is reported but **never scored** — scoring it would rank noisy art
above clean art.

```
score 86/100 (A)
palette 41 · colours/face 2.56 · band edges/face 1.55
flat faces 30% (reported only) · uv use 100%
bones animated 83% · silhouette 26% coverage
```

---

## Development

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest — 111 tests
npm run build         # tsc → dist/
npm run smoke         # end-to-end: all examples, 35 checks (incl. the geometric gate)
npm run verify        # typecheck + test + build
```

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) — the declarative JSON spec, in full
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the layers fit together and why
- [`docs/INSTALL-SKILLS.md`](docs/INSTALL-SKILLS.md) — installing the agent skills
- [`skills/*/SKILL.md`](skills/) — the agent-facing reference cards

## Caveats

- Java, Oraxen and ItemsAdder carry geometry, UV and texture but **not skeletal animation** —
  Java has no rig. Animations live in the `.bbmodel`.
- The renderer is orthographic only.
- The Oraxen and ItemsAdder pack layouts are conventional defaults; verify against your plugin
  version.
- Java elements rotate about a single axis; multi-axis element rotations are dropped with a warning.

## License

[MIT](LICENSE)
