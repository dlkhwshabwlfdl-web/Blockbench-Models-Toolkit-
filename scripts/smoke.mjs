#!/usr/bin/env node
/**
 * End-to-end smoke test: builds both examples, checks structural invariants, validates,
 * renders and scores them. Exits non-zero on any failure, so it works as a CI gate.
 *
 *   npm run build && node scripts/smoke.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  Canvas,
  contactSheet,
  findCoincidentFaces,
  formatReport,
  formatMetrics,
  metrics,
  resolveSpec,
  validate,
  writeBinary,
  writeBbmodel,
  writeJavaModel,
} from '../dist/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(ROOT, 'out', 'smoke');

let failures = 0;
let checks = 0;

function check(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✖ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** The .bbmodel must round-trip: writing then re-parsing keeps every entity. */
function reparse(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  /* ---------------------------------------------------------------- T-Rex -- */
  console.log('\nT-Rex (programmatic API)');
  const { buildTrex } = await import(pathToFileURL(path.join(ROOT, 'examples/trex/trex.mjs')).href);
  const { model, hygiene, seams } = buildTrex();
  model.assignUv();

  check('cube count', model.cubes.length === 98, `got ${model.cubes.length}`);
  check('uses element rotation', model.cubes.filter((cube) => cube.rotation.some((value) => value !== 0)).length >= 15,
    `got ${model.cubes.filter((cube) => cube.rotation.some((value) => value !== 0)).length}`);
  check('hygiene resolved coincident faces', hygiene.resolved.length > 0, `got ${hygiene.resolved.length}`);
  check('coincident faces nearly eliminated', findCoincidentFaces(model).pairs.length <= 8,
    `got ${findCoincidentFaces(model).pairs.length}`);
  check('seam pass wrote pixels', seams.pixels > 0, `got ${seams.pixels}`);
  check('seam pass introduced no colours', (() => {
    const plain = buildTrex({ soften: false }).model;
    const before = new Set(plain.textures[0].data.length ? Canvas.fromPng(plain.textures[0].data).distinctColors().keys() : []);
    const after = new Set(Canvas.fromPng(model.textures[0].data).distinctColors().keys());
    for (const key of after) if (!before.has(key)) return false;
    return true;
  })(), 'the seam pass only writes colours that already existed');
  check('bone count', model.rig.size === 30, `got ${model.rig.size}`);
  check('clip count', model.clips.length === 25, `got ${model.clips.length}`);
  check('every bone animated at least once', new Set(model.clips.flatMap((c) => c.keys.map((k) => k.bone))).size >= 25);
  check('has keyframes', model.clips.every((clip) => clip.keys.length > 0));

  const trexReport = validate(model, { warnOnEmptyBones: true });
  check('validates clean', trexReport.ok, trexReport.errors.join('; '));
  if (!trexReport.ok) console.log(formatReport(trexReport));

  const bbmodelFile = writeBbmodel(model, path.join(OUT, 'trex.bbmodel'));
  const doc = reparse(bbmodelFile);
  check('bbmodel elements written', doc.elements.length === 98, `got ${doc.elements.length}`);
  check('bbmodel groups written', doc.groups.length === 30, `got ${doc.groups.length}`);
  check('bbmodel animations written', doc.animations.length === 25, `got ${doc.animations.length}`);
  check('texture embedded as data uri', typeof doc.textures[0]?.source === 'string' && doc.textures[0].source.startsWith('data:image/png;base64,'));
  // Hidden faces are dropped from the export, so "every element has six" is the *pre*-hygiene
  // invariant. After the geometry pass some cubes legitimately carry fewer.
  check(
    'every element has 1..6 faces',
    doc.elements.every((e) => Object.keys(e.faces).length >= 1 && Object.keys(e.faces).length <= 6),
  );
  check('outliner references every element', (() => {
    const referenced = new Set();
    const walk = (node) => {
      for (const child of node.children ?? []) {
        if (typeof child === 'string') referenced.add(child);
        else walk(child);
      }
    };
    for (const node of doc.outliner) walk(node);
    return doc.elements.every((e) => referenced.has(e.uuid));
  })());
  check('animators keyed by existing group uuid', (() => {
    const uuids = new Set(doc.groups.map((g) => g.uuid));
    return doc.animations.every((animation) => Object.keys(animation.animators).every((key) => uuids.has(key)));
  })());
  check('deterministic rebuild', (() => {
    const second = writeBbmodel(model, path.join(OUT, 'trex.second.bbmodel'));
    return fs.readFileSync(bbmodelFile, 'utf8') === fs.readFileSync(second, 'utf8');
  })());

  const java = writeJavaModel(model, path.join(OUT, 'java-trex'));
  const javaDoc = reparse(java.modelPath);
  check('java model written', javaDoc.elements.length === 98);
  check('java geometry fits 0..16 on Y', javaDoc.elements.every((e) => e.from[1] >= -0.01 && e.to[1] <= 16.01));
  check('java uv stays inside texture_size', javaDoc.elements.every((e) =>
    Object.values(e.faces).every((f) => f.uv[0] >= 0 && f.uv[1] >= 0 && f.uv[2] <= 64 && f.uv[3] <= 64)));

  const trexMetrics = metrics(model);
  check('trex grade is A or better', trexMetrics.grade === 'S' || trexMetrics.grade === 'A', `got ${trexMetrics.grade} (${trexMetrics.score})`);
  console.log(formatMetrics(trexMetrics).split('\n').map((l) => `    ${l}`).join('\n'));

  const sheet = contactSheet(model, { width: 200, height: 200, outline: true });
  check('contact sheet is a valid PNG', sheet.toPng().length > 1000);
  writeBinary(path.join(OUT, 'trex_preview.png'), sheet.toPng());

  /* ---------------------------------------------------------------- crate -- */
  console.log('\nCrate (JSON spec)');
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/crate.json'), 'utf8'));
  const resolved = resolveSpec(spec);
  resolved.model.assignUv();
  check('crate cubes', resolved.model.cubes.length === 11, `got ${resolved.model.cubes.length}`);
  check('crate clips', resolved.model.clips.length === 3, `got ${resolved.model.clips.length}`);
  const crateReport = validate(resolved.model);
  check('crate validates clean', crateReport.ok, crateReport.errors.join('; '));
  const crateMetrics = metrics(resolved.model);
  check('crate grade is A or better', crateMetrics.grade === 'S' || crateMetrics.grade === 'A', `got ${crateMetrics.grade}`);
  writeBbmodel(resolved.model, path.join(OUT, 'crate.bbmodel'));
  writeBinary(path.join(OUT, 'crate_preview.png'), contactSheet(resolved.model, { width: 180, height: 180, outline: true }).toPng());

  /* ---------------------------------------------------------- fire dragon -- */
  // The dragon is the end-to-end check on assembly quality. Its gate is the only thing in the
  // suite that can tell a sealed joint from a gapped one, so it runs here rather than only when a
  // person happens to build the example.
  console.log('\nFire Dragon (joints and occlusion)');
  const { buildFireDragon } = await import(
    pathToFileURL(path.join(ROOT, 'examples/firedragon/firedragon.mjs')).href
  );
  for (const detail of [0, 1]) {
    const { model: dragon, gate } = buildFireDragon({ detail });
    const open = gate.joints.open;
    check(
      `dragon detail ${detail}: every joint interpenetrates`,
      open.length === 0,
      `${open.length} open, shallowest ${open[0]?.depth.toFixed(2)}u (${open[0]?.a} <-> ${open[0]?.b})`
    );
    check(
      `dragon detail ${detail}: eyes and detail parts are visible`,
      gate.invisible.length === 0,
      gate.invisible.join('; ')
    );
    check(`dragon detail ${detail} validates clean`, validate(dragon).ok);
  }
  {
    const { model: dragon } = buildFireDragon({ detail: 1 });
    const dragonMetrics = metrics(dragon);
    check(
      'dragon grade is A or better',
      dragonMetrics.grade === 'S' || dragonMetrics.grade === 'A',
      `got ${dragonMetrics.grade} (${dragonMetrics.score})`
    );
    writeBinary(
      path.join(OUT, 'firedragon_preview.png'),
      contactSheet(dragon, { width: 220, height: 220, outline: true }).toPng()
    );
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
