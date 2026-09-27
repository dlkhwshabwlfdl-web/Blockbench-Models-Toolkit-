#!/usr/bin/env node
/**
 * Render a model to a single self-contained HTML page.
 *
 *   node scripts/preview.mjs [example] [--out out/preview.html]
 *
 * PNGs are inlined as data URIs, so the page opens anywhere — no server, no relative paths to
 * get wrong. The point is a page an agent (or a person) can look at and judge: every side, the
 * underside on its own, the atlas at 8×, and a strip per animation sampled through the real
 * skeleton.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  Canvas,
  Model,
  clipStrip,
  formatMetrics,
  formatReport,
  metrics,
  projectModel,
  validate,
  viewBasis,
} from '../dist/index.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const example = args.find((value) => !value.startsWith('--') && value !== flag('out', null)) ?? 'trex';
const specPath = path.resolve(`examples/${example}/${example}.mjs`);
const { default: build } = await import(`file://${specPath.replace(/\\/g, '/')}`);
if (typeof build !== 'function') throw new Error(`examples/${example}/${example}.mjs has no default export`);
const built = await build();
const model = built.model ?? built;
model.assignUv();

const VIEW_SIZE = 320;
const views = ['front', 'back', 'left', 'right', 'iso', 'top', 'bottom'];

/**
 * A model containing only the cubes inside a box (plus the bones they hang from), rendered at a
 * forced px-per-unit scale. This is the only way to actually *look* at a detail — a full-model
 * render of a 106-unit-long animal puts the waist in about four pixels.
 */
function crop(source, box, name) {
  const inside = source.cubes.filter((cube) =>
    cube.from[0] <= box[1] && cube.to[0] >= box[0] &&
    cube.from[1] <= box[3] && cube.to[1] >= box[2] &&
    cube.from[2] <= box[5] && cube.to[2] >= box[4],
  );
  if (inside.length === 0) return null;
  const keep = new Set(inside.map((cube) => cube.bone));
  for (let changed = true; changed; ) {
    changed = false;
    for (const bone of source.rig.ordered()) {
      if (keep.has(bone.name) && bone.parent && !keep.has(bone.parent)) {
        keep.add(bone.parent);
        changed = true;
      }
    }
  }
  const out = new Model({ name, resolution: source.resolution, uvPolicy: source.uvPolicy });
  for (const bone of source.rig.ordered()) {
    if (!keep.has(bone.name)) continue;
    out.bone(bone.name, [...bone.pivot], bone.parent ?? null);
  }
  for (const cube of inside) {
    out.cube({
      name: cube.name,
      from: [...cube.from],
      to: [...cube.to],
      bone: cube.bone,
      rotation: [...cube.rotation],
      origin: [...cube.origin],
      ...(cube.inflate ? { inflate: cube.inflate } : {}),
      hidden: [...cube.hidden],
    });
  }
  if (source.textures[0]) out.addTexture(source.textures[0]);
  out.assignUv();
  return out;
}

const encode = (canvas) => `data:image/png;base64,${Buffer.from(canvas.toPng()).toString('base64')}`;
const tile = (canvas, size) => {
  const scaled = new Canvas(size, size, [14, 15, 19, 255]);
  const scale = Math.max(1, Math.floor(Math.min(size / canvas.width, size / canvas.height)));
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const [r, g, b, a] = canvas.get(x, y);
      if (a === 0) continue;
      scaled.rect(x * scale, y * scale, (x + 1) * scale, (y + 1) * scale, [r, g, b, a]);
    }
  }
  return scaled;
};

const viewImages = views.map((view) => ({
  view,
  src: encode(
    projectModel(model, viewBasis(view), {
      width: VIEW_SIZE,
      height: VIEW_SIZE,
      background: [14, 15, 19, 255],
      outline: true,
    }),
  ),
}));


const atlas = model.textures[0];
const atlasImage = atlas ? encode(tile(Canvas.fromPng(atlas.data), 384)) : '';

// Prefer the clips a reader most wants to see; fall back to the model's own order so the page
// works for any model rather than only the one it was written for.
const PREFERRED = ['idle', 'walk', 'run', 'flap', 'attack', 'roar', 'jump', 'glide', 'takeoff'];
const chosen = PREFERRED.map((name) => model.clips.find((clip) => clip.name === name)).filter(Boolean);
const STRIP_CLIPS = (chosen.length > 0 ? chosen : model.clips.slice(0, 6)).map((clip) => clip.name);

const stripTimes = [0, 0.13, 0.26, 0.39, 0.52, 0.65, 0.78, 0.91];
/** Locomotion and wing beats read side-on; everything else reads from the front. */
const stripView = (name) =>
  ['walk', 'run', 'flap', 'glide', 'takeoff', 'land'].includes(name) ? 'left' : 'front';
const strips = model.clips
  .filter((clip) => STRIP_CLIPS.includes(clip.name))
  .map((clip) => ({
    name: clip.name,
    src: encode(
      clipStrip(model, {
        clip: clip.name,
        times: stripTimes.map((t) => t * clip.length),
        view: stripView(clip.name),
        width: 130,
        height: 170,
        gap: 3,
      }),
    ),
  }));

// The surface passes are meant to be a dial, not a constant, so the page shows all three
// settings of the same model side by side. If `sharp` and `soft` look the same, the knob is
// doing nothing and the numbers below are lying.
const styleSections = [];
for (const style of ['sharp', 'balanced', 'soft']) {
  const variant = style === 'balanced' ? model : (await build({ style })).model;
  variant.assignUv();
  const tiles = ['left', 'front'].map((view) =>
    encode(
      projectModel(variant, viewBasis(view), {
        width: 220,
        height: 220,
        background: [14, 15, 19, 255],
        outline: true,
      }),
    ),
  );
  const variantQuality = style === 'balanced' ? null : metrics(variant);
  styleSections.push({
    style,
    tiles,
    note:
      style === 'balanced'
        ? 'the build above'
        : `${variantQuality.palette} colours · ${variantQuality.coloursPerFace.toFixed(2)} colours/face · ${variantQuality.score}/100`,
  });
}

// Detail crops, derived from the model's own bounds rather than hardcoded, so the page works for
// any model. A 106-unit animal fills about four pixels of its own waist in a full-model render,
// so "the hips shimmer" and "the belly looks wrong" can only be judged up close — but where the
// waist *is* differs per model, so it has to be computed.
const bounds = model.bounds();
const spanZ = bounds.max[2] - bounds.min[2];
const spanY = bounds.max[1] - bounds.min[1];
const band = (zFrom, zTo) => [bounds.min[0], bounds.max[0], bounds.min[1], bounds.max[1], zFrom, zTo];

/** Fix the crop to fill the tile: 380px across its longest axis. */
const fitScale = (box) =>
  380 / Math.max(box[1] - box[0], box[3] - box[2], box[5] - box[4]);

const detail = [
  { label: 'front end (from the left)', box: band(bounds.max[2] - spanZ * 0.3, bounds.max[2]), view: 'left' },
  { label: 'middle (from the left)', box: band(bounds.min[2] + spanZ * 0.28, bounds.min[2] + spanZ * 0.62), view: 'left' },
  { label: 'middle (from behind, above)', box: band(bounds.min[2] + spanZ * 0.28, bounds.min[2] + spanZ * 0.62), view: 'iso-back' },
  { label: 'underside (whole)', box: band(bounds.min[2], bounds.max[2]), view: 'bottom' },
  { label: 'rear end (from the left)', box: band(bounds.min[2], bounds.min[2] + spanZ * 0.32), view: 'left' },
];
const details = detail
  .map((entry) => {
    const cropped = crop(model, entry.box, entry.label);
    if (!cropped) return null;
    return {
      label: entry.label,
      src: encode(
        projectModel(cropped, viewBasis(entry.view), {
          width: 380,
          height: 380,
          // A crop taller than it is long needs its own scale; `fitScale` uses the longest axis
          // so the tile is always filled.
          scale: Math.max(3, fitScale(entry.box)),
          padding: 6,
          background: [14, 15, 19, 255],
          outline: true,
          ambient: 0.62,
        }),
      ),
    };
  })
  .filter(Boolean);

const report = validate(model, { warnOnEmptyBones: true });
const quality = metrics(model);

// `--focus` writes a page with only the detail crops. It exists because the full page is a few
// hundred kilobytes of inlined PNGs, and a small page is far easier to actually look at — the
// crops are the part that needs judging anyway.
const focus = args.includes('--focus');
const outPath = path.resolve(flag('out', focus ? `out/${example}_detail.html` : `out/${example}_preview.html`));
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const detailBlocks = details
  .map((entry) => `<figure><img src="${entry.src}" width="620"><figcaption>${entry.label}</figcaption></figure>`)
  .join('\n');

if (focus) {
  fs.writeFileSync(
    outPath,
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${model.name} — details</title>
<style>
:root{color-scheme:dark}
html{max-width:100%;overflow-x:hidden}
body{margin:0;padding:20px;max-width:100%;background:#0e0f13;color:#e7e9ef;font:14px/1.5 system-ui,"Segoe UI",sans-serif}
h1{font-size:17px;margin:0 0 4px}
figure{margin:0 0 22px;max-width:100%}
img{display:block;max-width:100%;height:auto;image-rendering:pixelated;border:1px solid #262a34;border-radius:8px;background:#0e1015}
figcaption{color:#8f97a8;font-size:12px;margin-top:6px}
.meta{color:#8f97a8;font-size:12.5px;margin-bottom:18px}
</style></head>
<body><h1>${model.name} — detail crops</h1>
<div class="meta">${model.summary()}</div>
${detailBlocks}
<h1>Texture atlas (8×)</h1>
<figure><img src="${atlasImage}" width="620"><figcaption>${atlas ? `${Canvas.fromPng(atlas.data).width}×${Canvas.fromPng(atlas.data).height} source` : 'no texture'}</figcaption></figure>
</body></html>
`,
    'utf8',
  );
  console.log(outPath);
  process.exit(0);
}

fs.writeFileSync(
  outPath,
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${model.name} — preview</title>
<style>
:root{color-scheme:dark}
/* A wide pre block would otherwise stretch the body, which makes every percentage width below
   resolve against the stretched width rather than the viewport. Cap the page and let the
   blocks scroll inside themselves. */
html{max-width:100%;overflow-x:hidden}
body{margin:0;padding:26px;max-width:100%;background:#0e0f13;color:#e7e9ef;
font:14px/1.55 system-ui,"Segoe UI",sans-serif}
h1{font-size:19px;margin:0 0 4px}h2{font-size:13px;margin:26px 0 10px;color:#8f97a8;text-transform:uppercase;letter-spacing:.08em}
.grid{display:flex;flex-wrap:wrap;gap:12px}
figure{margin:0;max-width:100%}
img{display:block;max-width:100%;height:auto;image-rendering:pixelated;border:1px solid #262a34;
border-radius:8px;background:#0e1015}
figcaption{color:#8f97a8;font-size:12px;margin-top:6px}
pre{background:#14161c;border:1px solid #262a34;border-radius:8px;padding:12px;overflow-x:auto;
max-width:100%;box-sizing:border-box;font-size:12.5px;color:#c6cbd6}
.wide img{width:100%}
.meta{color:#8f97a8;font-size:12.5px}
</style></head>
<body>
<h1>${model.name}</h1>
<div class="meta">${model.summary()}</div>

<h2>Every side</h2>
<div class="grid">
${viewImages.map((v) => `<figure><img src="${v.src}" width="230"><figcaption>${v.view}</figcaption></figure>`).join('\n')}
</div>

<h2>Texture atlas (8×)</h2>
<figure><img src="${atlasImage}" width="330"><figcaption>${atlas ? `${Canvas.fromPng(atlas.data).width}×${Canvas.fromPng(atlas.data).height} source` : 'no texture'}</figcaption></figure>

<h2>Animation strips (posed through the skeleton)</h2>
${strips.map((s) => `<figure class="wide"><img src="${s.src}"><figcaption>${s.name}</figcaption></figure>`).join('\n')}

<h2>Detail crops (forced scale, nearest neighbour)</h2>
<div class="meta">Run <code>node scripts/preview.mjs ${example} --focus</code> for these at full size. Model bounds
${[bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]].map((v) => v.toFixed(1)).join(' × ')} units.</div>
<div class="grid">
${details
  .map((entry) => `<figure><img src="${entry.src}" width="330"><figcaption>${entry.label}</figcaption></figure>`)
  .join('\n')}
</div>

<h2>Surface style dial</h2>
<div class="grid">
${styleSections
  .map(
    (section) =>
      `<figure><div style="display:flex;gap:6px">${section.tiles
        .map((src) => `<img src="${src}" width="200">`)
        .join('')}</div><figcaption><b>${section.style}</b> — ${section.note}</figcaption></figure>`,
  )
  .join('\n')}
</div>

<h2>Quality</h2>
<pre>${formatMetrics(quality).replace(/</g, '&lt;')}</pre>

<h2>Validation</h2>
<pre>${formatReport(report).replace(/</g, '&lt;')}</pre>
</body></html>
`,
  'utf8',
);
console.log(outPath);
