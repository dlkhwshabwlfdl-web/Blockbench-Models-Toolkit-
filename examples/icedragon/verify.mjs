#!/usr/bin/env node
/**
 * Check the render the way an eye would: how much of the frame the model fills, whether the
 * warm core actually appears in the picture, and whether any pose came out blank.
 *
 * This is the check that a "validated, 87/100" model can still fail — a model can score well
 * on metrics and render as a grey smudge.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Canvas } from '../../dist/index.js';

const dir = path.resolve(process.argv[2] ?? 'out/icedragon');

/** Hue bucket for a pixel, ignoring anything darker than the background. */
function classify([r, g, b, a]) {
  if (a < 8) return 'transparent';
  if (r + g + b < 90) return 'dark';
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 22) return 'neutral';
  // Hue in degrees.
  let hue;
  if (max === r) hue = ((g - b) / (max - min)) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;
  if (hue >= 300 || hue < 20) return 'warm/magenta';
  if (hue >= 20 && hue < 60) return 'gold';
  if (hue >= 60 && hue < 170) return 'green/teal';
  if (hue >= 170 && hue < 260) return 'blue';
  return 'violet';
}

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort()) {
  const canvas = Canvas.fromPng(fs.readFileSync(path.join(dir, file)));
  const counts = new Map();
  let opaque = 0;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const bucket = classify(canvas.get(x, y));
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
      if (bucket !== 'transparent' && bucket !== 'dark') opaque += 1;
    }
  }
  const total = canvas.width * canvas.height;
  const pct = (n) => ((n / total) * 100).toFixed(1).padStart(5);
  const fill = ((opaque / total) * 100).toFixed(1).padStart(5);
  const warm = counts.get('warm/magenta') ?? 0;
  const teal = (counts.get('green/teal') ?? 0) + (counts.get('blue') ?? 0);
  const blank = opaque / total < 0.02 ? '  <-- NEARLY BLANK' : '';
  console.log(
    `${file.padEnd(34)} fill ${fill}%  teal ${pct(teal)}%  warm ${pct(warm)}%  ` +
      `neutral ${pct(counts.get('neutral') ?? 0)}%${blank}`,
  );
}
