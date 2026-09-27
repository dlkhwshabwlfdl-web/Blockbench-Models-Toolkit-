#!/usr/bin/env node
/**
 * Build the ice dragon into a complete, downloadable package.
 *
 *   model/    the .bbmodel and the source script — open in Blockbench
 *   texture/  the 64×64 atlas, plus an 8× view for actually looking at it
 *   preview/  orthographic sheet, posed animation sheet
 *   packs/    Java model, Oraxen fragment, ItemsAdder fragment
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildIceDragon } from './icedragon.mjs';
import {
  Canvas,
  contactSheet,
  formatMetrics,
  metrics,
  posedScene,
  projectScene,
  validate,
  viewBasis,
  writeBbmodel,
  writeBinary,
  writeItemsAdder,
  writeJavaModel,
  writeOraxen,
} from '../../dist/index.js';

const outDir = path.resolve(process.argv[2] ?? 'out/icedragon');
fs.rmSync(outDir, { recursive: true, force: true });
for (const dir of ['model', 'texture', 'preview', 'packs']) fs.mkdirSync(path.join(outDir, dir), { recursive: true });

const { model, hygiene, seams } = buildIceDragon();
model.assignUv();

const report = validate(model, { warnOnEmptyBones: true });
if (!report.ok) {
  console.error(report.errors.join('\n'));
  process.exit(1);
}

const written = [];
const save = (rel, bytes) => {
  const full = path.join(outDir, rel);
  writeBinary(full, bytes);
  written.push({ rel, size: bytes.length });
};

/* -- model ----------------------------------------------------------------- */
writeBbmodel(model, path.join(outDir, 'model', 'icedragon.bbmodel'));
fs.copyFileSync(new URL('./icedragon.mjs', import.meta.url), path.join(outDir, 'model', 'icedragon.mjs'));

/* -- texture --------------------------------------------------------------- */
const texture = model.textures[0];
save('texture/icedragon.png', texture.data);
{
  const scale = 8;
  const source = Canvas.fromPng(texture.data);
  const big = new Canvas(texture.width * scale, texture.height * scale, [10, 11, 14, 255]);
  for (let y = 0; y < big.height; y += 1) {
    for (let x = 0; x < big.width; x += 1) {
      big.set(x, y, source.get(Math.floor(x / scale), Math.floor(y / scale)));
    }
  }
  save('texture/icedragon_atlas_8x.png', big.toPng());
}

/* -- previews -------------------------------------------------------------- */
save('preview/icedragon_views.png', contactSheet(model, { width: 320, height: 320, outline: true }).toPng());

const POSES = [
  ['roar', 0.7],
  ['frost_breath', 1.5],
  ['wing_unfurl', 0.55],
  ['flap', 0.18],
  ['bite', 0.24],
  ['takeoff', 1.15],
  ['run', 0.1],
  ['sleep', 3],
];
const VIEWS = ['iso', 'front'];
const TILE = 300;
const PAD = 12;
const tiles = [];
for (const [clipName, time] of POSES) {
  const clip = model.clips.find((c) => c.name === clipName);
  if (!clip) continue;
  for (const view of VIEWS) {
    const scene = posedScene(model, clip, time);
    tiles.push({
      canvas: projectScene(scene, viewBasis(view), { width: TILE, height: TILE, outline: true, background: [18, 19, 23, 255] }),
      label: `${clipName} @${time}s ${view}`,
    });
    save(`preview/pose_${clipName}_${String(time).replace('.', 'p')}_${view}.png`, tiles[tiles.length - 1].canvas.toPng());
  }
}
{
  const cols = VIEWS.length;
  const rows = Math.ceil(tiles.length / cols);
  const sheet = new Canvas(cols * TILE + PAD * (cols + 1), rows * TILE + PAD * (rows + 1), [18, 19, 23, 255]);
  tiles.forEach((tile, index) => {
    const ox = PAD + (index % cols) * (TILE + PAD);
    const oy = PAD + Math.floor(index / cols) * (TILE + PAD);
    for (let y = 0; y < TILE; y += 1) {
      for (let x = 0; x < TILE; x += 1) {
        const px = tile.canvas.get(x, y);
        if (px[3] === 0) continue;
        sheet.set(ox + x, oy + y, px);
      }
    }
  });
  save('preview/icedragon_poses.png', sheet.toPng());
}

/* -- packs ----------------------------------------------------------------- */
{
  const java = writeJavaModel(model, path.join(outDir, 'packs', 'java'), { writeTexture: true, writeMcmeta: true });
  for (const file of [java.modelPath, java.texturePath, java.mcmetaPath].filter(Boolean)) {
    written.push({ rel: path.relative(outDir, file), size: fs.statSync(file).size });
  }
}
{
  const oraxen = writeOraxen(model, path.join(outDir, 'packs', 'oraxen'));
  for (const file of [oraxen.modelPath, oraxen.texturePath, oraxen.configPath].filter(Boolean)) {
    written.push({ rel: path.relative(outDir, file), size: fs.statSync(file).size });
  }
}
{
  const ia = writeItemsAdder(model, path.join(outDir, 'packs', 'itemsadder'));
  for (const file of [ia.modelPath, ia.texturePath, ia.configPath].filter(Boolean)) {
    written.push({ rel: path.relative(outDir, file), size: fs.statSync(file).size });
  }
}

/* -- a manifest so the package explains itself ----------------------------- */
const m = metrics(model);
const manifest = {
  name: model.name,
  identifier: model.identifier,
  resolution: model.resolution,
  cubes: model.cubes.length,
  bones: model.bones,
  clips: model.clips.map((c) => ({ name: c.name, length: c.length, loop: c.loop, keys: c.keys.length })),
  quality: m,
  hygiene: { coincidentPairs: hygiene.report.pairs.length, facesAdjusted: hygiene.resolved.length },
  seams: { blended: seams.blended, pixels: seams.pixels, sharedJoins: seams.sharedJoins },
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(model.summary());
console.log(formatMetrics(m));
console.log('');
for (const { rel, size } of written) {
  console.log(`  ${(size / 1024).toFixed(1).padStart(7)}k  ${rel}`);
}
console.log(`  ${(fs.statSync(path.join(outDir, 'model/icedragon.bbmodel')).size / 1024).toFixed(1).padStart(7)}k  model/icedragon.bbmodel`);
console.log(`  ${(fs.statSync(path.join(outDir, 'model/icedragon.mjs')).size / 1024).toFixed(1).padStart(7)}k  model/icedragon.mjs`);
console.log(`  ${(fs.statSync(path.join(outDir, 'manifest.json')).size / 1024).toFixed(1).padStart(7)}k  manifest.json`);
console.log(`\n→ ${outDir}`);
