# Preview reference

## Views

`front`, `back`, `left`, `right`, `top`, `bottom`, `iso`, `iso-back`.

Each is an orthonormal basis:

```ts
interface ViewBasis { forward: Vec3; up: Vec3; right: Vec3 }
```

`forward` is the direction the camera looks; `right = forward × up`, `up = right × forward`.
Lookup with `viewBasis('iso')`; the whole table is `VIEWS`.

## Rendering

```ts
projectScene(scene, view, options?) → Canvas
projectModel(model, view, options?) → Canvas      // rest pose
```

| Option | Default | Meaning |
|--------|---------|---------|
| `width` / `height` | 512 | output size in pixels |
| `padding` | 12 | inset inside the frame |
| `background` | transparent | RGBA |
| `light` | `[-0.35, 0.85, 0.4]` | world light direction |
| `ambient` | 0.55 | ambient floor, 0..1 |
| `outline` | false | darken pixels touching the background |
| `scale` | fitted | px per model unit; overrides the automatic fit |
| `filter` | `nearest` | or `linear` |

The projector uses a per-pixel depth buffer (not a centroid sort) so posed rigs that
interpenetrate draw correctly, and skips back-facing faces and transparent texels.

## Scenes

```ts
buildScene(model, pose?) → Scene        // { faces, texture, bounds, posed }
restScene(model) → Scene
posedScene(model, clip, time) → Scene
samplePose(clip, time) → Pose           // Map<bone, { rotation, position, scale }>
boneWorldTransforms(model, pose) → Map<bone, Mat4>
```

`SceneFace` = `{ corners: [Vec3, Vec3, Vec3, Vec3], normal, uv, cube, face }`. Corners are ordered
to match the UV rect's `(u1,v1) → (u2,v2)` corners, the same contract as `faceCorners`.

Pose sampling interpolates linearly between surrounding keys, smoothed with a smoothstep unless
the key's interpolation is `linear` or `step`. Bone transforms are
`parent · T(pivot) · R · S · T(−pivot)` with `R` in Blockbench's ZYX euler order.

Matrix helpers (column-major, `m[column * 4 + row]`): `identity`, `multiply`, `translation`,
`scaleMatrix`, `rotationX`, `rotationY`, `rotationZ`, `rotationZYX`, `transformPoint`,
`transformDirection`.

## Sheets and files

```ts
contactSheet(model, { views?, width?, height?, gap?, background?, tileBackground?, …renderOptions }) → Canvas
clipStrip(model, { clip, times, view?, width?, height?, gap?, … }) → Canvas
renderToFile(model, view, file, options?) → string
```

`contactSheet` defaults to all seven views in four columns. `clipStrip` renders a horizontal strip
of the model at the given times (rest pose plus element rotations; it is a layout sheet, not a
full animation preview — use `posedScene` for a real posed frame).

## Metrics

```ts
metrics(model, { viewSize? }) → MetricsReport
formatMetrics(report) → string
```

```ts
interface MetricsReport {
  palette: number;
  coloursPerFace: number;
  flatFaceShare: number;          // reported only — never scored
  bandEdgesPerFace: number;
  score: number;                  // 0..100
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  notes: string[];
  uvUtilisation: number;
  animatedBoneShare: number;
  orphanAnimators: string[];
  silhouette: { coverage: number; asymmetry: number };
}
```

Scoring: `palette` peaks in 8–48 (slope 2.5/colour outside); `coloursPerFace` peaks at 3 (slope 26);
`bandEdgesPerFace` rises to 3 then saturates; `animatedBoneShare` is linear. Weights: 0.34 palette,
0.36 colours-per-face, 0.15 band edges, 0.15 animation coverage. Grades: S ≥ 90, A ≥ 78, B ≥ 65,
C ≥ 50, else D.

Flatness is excluded from the score on purpose: scoring it would rank dithered noise — which is
never flat — above clean art.

## Validation

```ts
validate(model, { strict?, warnOnEmptyBones? }) → { errors, warnings, info, ok }
assertValid(model, options?) → ValidationReport      // throws when not ok
formatReport(report) → string
```

Errors: no bones, no cubes, duplicate cube names, cube on a missing bone, non-positive cube size,
missing or zero-area UV window, UV outside the resolution, empty animation, non-positive length,
keyframes on a missing bone, invalid interpolation, duplicate animation name, texture with no data.
Warnings: multiple roots, resolution/texture mismatch, texture with no data (as a warning when
absent), keyframes outside `0..length`, single-key channels, clipboard warnings collected on
`model.warnings`.
