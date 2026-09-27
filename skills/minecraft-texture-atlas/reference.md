# Texture reference

## `new Atlas(width, height, fill?)`

| Member | Description |
|--------|-------------|
| `atlas.canvas` | the backing `Canvas` (RGBA `Uint8Array`) |
| `atlas.width` / `atlas.height` | dimensions |
| `atlas.define(name, rect)` | claim a fixed rect; throws on overlap or out-of-bounds |
| `atlas.alloc(name, w, h, { gap?, origin? })` | shelf-pack a rect |
| `atlas.allocSquare(name, size, opts?)` | square shorthand |
| `atlas.get(name)` / `atlas.has(name)` / `atlas.names()` | lookup |
| `atlas.paint(name, fn)` | `fn(rect, canvas)` scoped to an island |
| `atlas.rule(id, island, when)` | build a `UvRule` from an island |
| `atlas.toTexture(name, opts?)` | produce a `Texture` (`particle`, `useAsDefault`, `renderMode`, `renderSides`, `wrapMode`, `frameOrder`, `frameTime`, `frameInterpolate`) |

`islandRules(atlas, patterns)` builds a rule list from `{ island, prefix?, suffix?, exact?, face?, id? }`
patterns, matched in order.

## `new Canvas(width, height, fill?)`

Coordinates are image space: `y` increases downward, matching texture `v`.

| Method | Notes |
|--------|-------|
| `get(x, y)` → `[r,g,b,a]` | out of bounds returns transparent |
| `set(x, y, rgba)` | out of bounds is a no-op |
| `fill(rgba)` | whole canvas |
| `rect(x1, y1, x2, y2, rgba)` | half-open, clipped |
| `outlineRect(x1, y1, x2, y2, rgba)` | 1px inset stroke |
| `line(x0, y0, x1, y1, rgba)` | Bresenham |
| `ellipse(cx, cy, rx, ry, rgba)` | filled |
| `blit(source, x, y)` | copy another canvas in |
| `clone()`, `mirrorHorizontal(from?)` | |
| `toPng()` → `Uint8Array`, `Canvas.fromPng(bytes)` | PNG round-trip |
| `distinctColors()` → `Map<'r,g,b', count>` | ignores transparent pixels |

## Brushes

| Function | Signature |
|----------|-----------|
| `fill` | `(canvas, rect, rgba)` |
| `bands` | `(canvas, rect, rgb, { steps?, contrast?, bias?, axis?, inverted?, tintToward?, tintAmount? })` |
| `grain` | `(canvas, rect, rgb, { amount?, scale?, seed?, blotch? })` |
| `bevel` | `(canvas, rect, rgb, { light?, dark?, thickness?, inset? })` |
| `seam` | `(canvas, rect, rgb, { amount?, edges?, thickness? })` |
| `outline` | `(canvas, rect, rgba, thickness?)` |
| `radial` | `(canvas, rect, { inner, outer, steps?, power? })` |
| `blotch` | `(canvas, rect, { color, chance?, scale?, seed?, mask? })` |
| `eye` | `(canvas, rect, { sclera?, iris?, pupil?, brow?, gaze? })` |
| `blendPixel` | `(canvas, x, y, rgb, amount?)` |
| `eachPixel` | `(canvas, rect, (x, y) => void)` |
| `dither` | `(canvas, rect, a, b, matrix?)` — **do not use**; present only for completeness |

`bands` with `axis: 'vertical'` (default) runs the ramp down the rect with the lightest step at
the top unless `inverted: true`.

## Palette

```ts
ramp(rgb | '#hex', { steps?, contrast?, bias? }) → Rgb[]   // dark → light
rgba(rgb, alpha?) → Rgba
tint(step, toward, amount) → Rgb
```

`new Palette()`:

| Method | Returns |
|--------|---------|
| `define(name, color, options?)` | the entry |
| `get(name)` / `has(name)` / `names()` | lookup |
| `shade(name, index)` | step, clamped |
| `dark(name)` / `baseRgba(name)` / `light(name)` | `Rgba` |
| `allSteps()` / `size()` | distinct colours |

## Colour utilities (from `util/math`)

`hexToRgb`, `rgbToHex`, `mixRgb(a, b, t)`, `shadeRgb(rgb, amount)` (`amount` is signed, `-1..1`),
`clamp`, `lerp`, `noise2(x, y, periodX)`, `fbm2(x, y, octaves, periodX)`, `hashString`.
