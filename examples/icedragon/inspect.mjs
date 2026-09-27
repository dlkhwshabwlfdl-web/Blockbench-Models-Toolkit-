#!/usr/bin/env node
/**
 * Diagnostics for the ice dragon — the questions a contact sheet cannot answer.
 *
 * `crop` is not exported by this version of the toolkit, so this leans on the posed
 * renderer instead: a clip sampled mid-action shows whether the rig actually works, which a
 * rest-pose contact sheet cannot.
 */
import { buildIceDragon } from './icedragon.mjs';
import { metrics, posedScene, projectScene, samplePose, validate, viewBasis } from '../../dist/index.js';

const { model } = buildIceDragon();
const report = metrics(model, { viewSize: 256 });

console.log('=== silhouette (asymmetry > 0.35 means a part is missing) ===');
console.log(JSON.stringify(report.silhouette, null, 1));

console.log('\n=== bones with no keyframe in any clip ===');
const animated = new Set();
for (const clip of model.clips) for (const key of clip.keys) animated.add(key.bone);
const idle = model.rig.all().filter((bone) => !animated.has(bone.name));
if (idle.length === 0) console.log('(none) — every bone is animated by something');
for (const bone of idle) {
  const cubes = model.cubesOf(bone.name).length;
  const children = model.rig.childrenOf(bone.name).length;
  if (cubes || children) console.log(`  ${bone.name}: ${cubes} cube(s), ${children} child(ren)`);
}
const deadEnds = idle.filter((bone) => model.cubesOf(bone.name).length === 0 && model.rig.childrenOf(bone.name).length === 0);
console.log(deadEnds.length ? `  WARNING: ${deadEnds.length} bone(s) carry nothing at all` : '');

console.log('\n=== validation ===');
const v = validate(model, { warnOnEmptyBones: true });
console.log(`errors: ${v.errors.length}, warnings: ${v.warnings.length}`);
for (const line of v.errors) console.log(`  x ${line}`);
for (const line of v.warnings) console.log(`  ! ${line}`);

console.log('\n=== per-clip coverage ===');
for (const clip of model.clips) {
  const bones = new Set(clip.keys.map((k) => k.bone));
  console.log(`  ${clip.name.padEnd(14)} ${String(clip.keys.length).padStart(4)} keys  ${String(bones.size).padStart(2)} bones  ${clip.length}s  ${clip.loop}`);
}

console.log('\n=== pose sanity: every keyed bone resolves, pivots are finite ===');
for (const clip of model.clips) {
  const at = samplePose(clip, clip.length * 0.5);
  let bad = 0;
  for (const [name, pose] of at) {
    for (const axis of [...pose.rotation, ...pose.position, ...pose.scale]) {
      if (!Number.isFinite(axis)) bad += 1;
    }
    if (!model.rig.has(name)) bad += 1;
  }
  if (bad) console.log(`  ${clip.name}: ${bad} non-finite / unknown value(s)`);
}
console.log('  (no output above means every sampled pose is finite and on a real bone)');
