#!/usr/bin/env node
/** Diagnostic: where does the seam pass write, which faces sample those pixels, and is any pixel shared? */
import { Canvas } from '../dist/index.js';
import build from '../examples/trex/trex.mjs';

const clean = (await build({ soften: false })).model;
const soft = (await build({ style: 'balanced' })).model;
const a = Canvas.fromPng(clean.textures[0].data);
const b = Canvas.fromPng(soft.textures[0].data);

// Which faces sample each texel.
const owners = new Map();
for (const cube of soft.cubes) {
  for (const [face, rect] of Object.entries(cube.faces)) {
    if (!rect) continue;
    for (let y = rect[1]; y < rect[3]; y += 1) {
      for (let x = rect[0]; x < rect[2]; x += 1) {
        const key = y * a.width + x;
        const list = owners.get(key) ?? [];
        list.push(`${cube.name}.${face}`);
        owners.set(key, list);
      }
    }
  }
}

const materialOf = new Map(soft.uvTrace.map((e) => [`${e.cube.name}|${e.face}`, e.material ?? 'base']));

let shared = 0;
const byOwner = new Map();
for (let key = 0; key < a.width * a.height; key += 1) {
  const before = a.get(key % a.width, Math.floor(key / a.width));
  const after = b.get(key % a.width, Math.floor(key / a.width));
  if (before[0] === after[0] && before[1] === after[1] && before[2] === after[2]) continue;
  const list = owners.get(key) ?? ['<unused>'];
  if (list.length > 1) shared += 1;
  const label = list.join(' + ');
  const entry = byOwner.get(label) ?? { count: 0, colours: new Set() };
  entry.count += 1;
  entry.colours.add(`${after[0]},${after[1]},${after[2]}`);
  byOwner.set(label, entry);
}

console.log(`changed texels whose pixels are sampled by more than one face: ${shared}`);
console.log('\ntop changed pixels by owning face(s):');
for (const [label, entry] of [...byOwner.entries()].sort((p, q) => q[1].count - p[1].count).slice(0, 20)) {
  const materials = label
    .split(' + ')
    .map((f) => materialOf.get(f) ?? '?')
    .join(',');
  console.log(`  ${String(entry.count).padStart(4)}  ${label}   [${materials}]  → ${[...entry.colours].slice(0, 3).join(' ')}`);
}
