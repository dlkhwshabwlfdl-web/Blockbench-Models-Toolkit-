#!/usr/bin/env node
/**
 * Render the gallery: every orthographic view, the signature poses side by side, and the
 * atlas at 8×.
 *
 * The contact sheet shows the rest pose. What proves the rig works is the *posed* render — a
 * clip sampled mid-action and evaluated through the real skeleton, which is the only way to
 * see whether a wing folds the right way or a head comes back to centre.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildIceDragon } from './icedragon.mjs';
import { Canvas, contactSheet, posedScene, projectScene, viewBasis, writeBinary } from '../../dist/index.js';

const outDir = path.resolve(process.argv[2] ?? 'out/icedragon');
fs.mkdirSync(outDir, { recursive: true });

const { model } = buildIceDragon();
model.assignUv();

const written = [];
const save = (file, bytes) => {
  const full = path.join(outDir, file);
  writeBinary(full, bytes);
  written.push(full);
  return full;
};

/* -- 1. every orthographic view -------------------------------------------- */
save('icedragon_views.png', contactSheet(model, { width: 256, height: 256, outline: true }).toPng());

/* -- 2. posed frames -------------------------------------------------------- */
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
const POSE_VIEWS = ['iso', 'front'];
const TILE = 300;
const PAD = 12;

const tiles = [];
for (const [clipName, time] of POSES) {
  const clip = model.clips.find((c) => c.name === clipName);
  if (!clip) continue;
  for (const view of POSE_VIEWS) {
    const scene = posedScene(model, clip, time);
    const canvas = projectScene(scene, viewBasis(view), {
      width: TILE,
      height: TILE,
      outline: true,
      background: [18, 19, 23, 255],
    });
    tiles.push({ canvas, label: `${clipName} @${time}s ${view}` });
    save(`pose_${clipName}_${String(time).replace('.', 'p')}_${view}.png`, canvas.toPng());
  }
}

// Compose the tiles into one sheet, so there is a single image that shows the motion.
{
  const cols = POSE_VIEWS.length;
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
  save('icedragon_poses.png', sheet.toPng());
}

/* -- 3. the atlas at 8x ----------------------------------------------------- */
{
  const texture = model.textures[0];
  const scale = 8;
  const source = Canvas.fromPng ? Canvas.fromPng(texture.data) : null;
  const big = new Canvas(texture.width * scale, texture.height * scale, [10, 11, 14, 255]);
  for (let y = 0; y < texture.height * scale; y += 1) {
    for (let x = 0; x < texture.width * scale; x += 1) {
      if (!source) continue;
      big.set(x, y, source.get(Math.floor(x / scale), Math.floor(y / scale)));
    }
  }
  if (source) save('icedragon_atlas_8x.png', big.toPng());
  else written.push('(atlas preview skipped: no PNG reader on Canvas — use the java/ PNG instead)');
}

console.log(written.map((file) => `→ ${path.relative(process.cwd(), file)}`).join('\n'));
