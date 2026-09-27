# UV reference

## Types

```ts
type UvRect = [number, number, number, number];      // x1, y1, x2, y2 in texture pixels
type FaceName = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';

interface UvRule {
  id: string;                                        // shown in diagnostics
  when: (cube: Cube, face: FaceName) => boolean;
  rect: UvRect | ((cube: Cube, face: FaceName) => UvRect);
}

interface UvPolicy {
  rules?: UvRule[];
  fallback?: (cube: Cube, face: FaceName) => UvRect;
}
```

## `assignUv(cubes, policy?, resolution?)`

Resolves a window for every face of every cube, mutating the cubes and returning a trace:

```ts
interface AssignedFace {
  cube: Cube;
  face: FaceName;
  rect: UvRect;
  source: 'explicit' | 'rule' | 'fallback';
}
```

`Model.assignUv(policy?)` forwards the model's resolution, so an omitted fallback uses
`skinFieldPolicy({ region: [0, 0, width, height] })` — a 32×32 model never gets windows computed
against a 64×64 field.

Idempotent: explicit windows are never overwritten, and a cube that already received a rule or
fallback window keeps it (it is now explicit).

## `skinFieldPolicy(options)`

| Option | Default | Meaning |
|--------|---------|---------|
| `region` | `[0, 0, 64, 64]` | area generic faces may sample |
| `heightReference` | `38` | model height mapped to the darkest end |
| `litFromAbove` | `true` | higher cubes read lighter |
| `upNudge` | `-7` | vertical shift for the `up` face |
| `downNudge` | `6` | vertical shift for the `down` face |

Returns `(cube, face) => UvRect`. Windows are clamped inside the region and are never
zero-area. Horizontal placement is a hash of `cube.name + '|' + face`, so it is stable.

## `boxUv(cube, origin)` → `Partial<Record<FaceName, UvRect>>`

Classic 3×2 box patch. `origin` is `[x, y]` of the patch's top-left:

- `east`: `[0, sz, sz, sy]`, `north`: `[sz, sz, sx, sy]`, `west`: `[sz+sx, sz, …]`, `south`: `[sz+sx+sz, sz, …]`
- `up`: `[sz+sx, 0, sx, sz]`, `down`: `[sz+sx+sx, 0, sx, sz]`

## `faceFrame(cube, face)`

```ts
{ base: Vec3; uAxis: Vec3; vAxis: Vec3; width: number; height: number; center: Vec3 }
```

`base` is the corner that maps to the UV rect's `(u1, v1)`; `uAxis`/`vAxis` are unit vectors for
the texture's U and V directions; `width`/`height` are the face's extents. `faceCorners(cube, face)`
returns the projected corners in the same order. The renderer samples faces through this frame,
so a custom UV layout must stay consistent with it.

Frames by face (model space, `+Y` up, model faces `+Z`):

| Face | base | uAxis | vAxis | width × height |
|------|------|-------|-------|----------------|
| `north` | `(to.x, to.y, from.z)` | `-X` | `-Y` | `sx × sy` |
| `south` | `(from.x, to.y, to.z)` | `+X` | `-Y` | `sx × sy` |
| `west` | `(from.x, to.y, from.z)` | `+Z` | `-Y` | `sz × sy` |
| `east` | `(to.x, to.y, to.z)` | `-Z` | `-Y` | `sz × sy` |
| `up` | `(from.x, to.y, from.z)` | `+X` | `+Z` | `sx × sz` |
| `down` | `(from.x, from.y, to.z)` | `+X` | `-Z` | `sx × sz` |

(`V` runs downward in texture space, which is why side faces use `-Y`.)
