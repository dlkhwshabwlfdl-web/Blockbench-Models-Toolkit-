#!/usr/bin/env node
/**
 * `aimodel` command line.
 *
 * The CLI is the low-friction path for an agent that would rather hand over a JSON spec
 * than write a TypeScript program. It accepts either a `.json` spec (resolved through
 * `resolveSpec`) or a `.mjs`/`.js` module whose default export is a `Model`, a spec object,
 * or a function returning either.
 *
 *   aimodel build <spec>    --out <dir> [--bbmodel] [--java] [--oraxen] [--itemsadder]
 *                           [--preview] [--metrics] [--json]
 *                           [--style sharp|balanced|soft] [--soften] [--hygiene]
 *   aimodel render <spec>   --out <dir> [--views front,iso] [--size 256]
 *   aimodel validate <spec> [--json]
 *   aimodel metrics <spec>  [--json]
 *   aimodel hygiene <spec>  [--mode hide|separate|report] [--fix <file.bbmodel>] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Model } from './model/model.js';
import { resolveSpec, type JsonSpec } from './spec.js';
import { assertValid, formatReport, validate } from './qa/validate.js';
import { findCoincidentFaces, formatCoincidence, geometricHygiene } from './qa/coincident.js';
import { softenSeams, type SurfaceStyleName } from './texture/harmony.js';
import { contactSheet, metrics, formatMetrics, renderToFile, viewBasis } from './render/index.js';
import { fileStem, writeBinary, writeBbmodel } from './export/index.js';
import { writeJavaModel } from './export/java.js';
import { writeOraxen } from './export/oraxen.js';
import { writeItemsAdder } from './export/itemsadder.js';

interface ParsedArgs {
  command: string;
  input?: string;
  flags: Map<string, string | boolean>;
  positional: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, true);
      }
    } else {
      positional.push(token);
    }
  }
  return { command, ...(positional[0] ? { input: positional[0] } : {}), flags, positional };
}

function flagString(args: ParsedArgs, key: string): string | undefined {
  const value = args.flags.get(key);
  return typeof value === 'string' ? value : undefined;
}

function flagBool(args: ParsedArgs, key: string): boolean {
  return args.flags.has(key);
}

/** Load a model from a JSON spec or a JS/TS-compiled module. */
async function loadModel(input: string): Promise<{ model: Model; warnings: string[] }> {
  const resolved = path.resolve(input);
  if (!fs.existsSync(resolved)) throw new Error(`cannot find spec "${input}"`);

  if (resolved.endsWith('.json')) {
    const spec = JSON.parse(fs.readFileSync(resolved, 'utf8')) as JsonSpec;
    const { model, warnings } = resolveSpec(spec);
    return { model, warnings };
  }

  const module = (await import(pathToFileURL(resolved).href)) as { default?: unknown; build?: unknown };
  const candidate = module.default ?? module.build;
  if (candidate === undefined) throw new Error(`module "${input}" has no default export`);
  let value: unknown = typeof candidate === 'function' ? await (candidate as () => unknown)() : candidate;
  if (value && typeof value === 'object' && 'model' in (value as Record<string, unknown>)) {
    value = (value as { model: unknown }).model;
  }
  if (value instanceof Model) return { model: value, warnings: [] };
  if (value && typeof value === 'object' && 'bones' in (value as Record<string, unknown>)) {
    const { model, warnings } = resolveSpec(value as JsonSpec);
    return { model, warnings };
  }
  throw new Error(`module "${input}" did not produce a Model or a spec object`);
}

function printWarnings(warnings: string[]): void {
  for (const warning of warnings) console.log(`! ${warning}`);
}

async function commandBuild(args: ParsedArgs): Promise<number> {
  if (!args.input) throw new Error('usage: aimodel build <spec> --out <dir>');
  const outDir = path.resolve(flagString(args, 'out') ?? 'out');
  const { model, warnings } = await loadModel(args.input);
  printWarnings(warnings);
  model.assignUv();

  // Geometry hygiene runs before validation: hiding a covered face cannot create an error,
  // and it is the difference between a model that z-fights and one that does not.
  if (flagBool(args, 'hygiene')) {
    const hygiene = geometricHygiene(model, { mode: 'hide' });
    console.log(
      `hygiene: ${hygiene.report.pairs.length} coincident pair(s), ${hygiene.resolved.length} face(s) hidden`,
    );
  }
  if (flagBool(args, 'soften')) {
    const style = (flagString(args, 'style') ?? 'balanced') as SurfaceStyleName;
    const result = softenSeams(model, { style });
    console.log(`soften: ${result.pixels} pixel(s) bridged across ${result.blended} seam(s) (${style})`);
    if (result.sharedJoins > 0) {
      console.log(
        `  ${result.sharedJoins} material(s) left alone: their joins fall on atlas texels that ` +
          'several faces read. Derive those colours instead (deriveShade/harmonize), or pass ' +
          'shareIslands to give the whole island a rim.',
      );
    }
  }

  const report = validate(model);
  if (!report.ok) {
    console.error(formatReport(report));
    throw new Error(`spec failed validation with ${report.errors.length} error(s)`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const outputs: string[] = [];
  const stem = fileStem(model.name);

  if (flagBool(args, 'bbmodel') || !anyFormatRequested(args)) {
    const name = flagString(args, 'bbmodel');
    const target = path.join(outDir, typeof name === 'string' ? name : `${stem}.bbmodel`);
    outputs.push(writeBbmodel(model, target));
  }
  if (flagBool(args, 'java')) {
    const result = writeJavaModel(model, path.join(outDir, 'java'), { writeTexture: true, writeMcmeta: true });
    printWarnings(result.warnings);
    outputs.push(result.modelPath);
    if (result.texturePath) outputs.push(result.texturePath);
    if (result.mcmetaPath) outputs.push(result.mcmetaPath);
  }
  if (flagBool(args, 'oraxen')) {
    const result = writeOraxen(model, path.join(outDir, 'oraxen'));
    printWarnings(result.warnings);
    outputs.push(result.modelPath, result.texturePath);
    if (result.configPath) outputs.push(result.configPath);
  }
  if (flagBool(args, 'itemsadder')) {
    const result = writeItemsAdder(model, path.join(outDir, 'itemsadder'));
    printWarnings(result.warnings);
    outputs.push(result.modelPath, result.texturePath);
    if (result.configPath) outputs.push(result.configPath);
  }
  if (flagBool(args, 'preview')) {
    const size = Number(flagString(args, 'size') ?? 256);
    const sheet = contactSheet(model, { width: size, height: size, outline: true });
    const previewPath = writeBinary(path.join(outDir, `${stem}_preview.png`), sheet.toPng());
    outputs.push(previewPath);
  }

  console.log(`built ${model.name}`);
  console.log(`  ${model.summary()}`);
  for (const file of outputs) console.log(`  → ${path.relative(process.cwd(), file)}`);

  if (flagBool(args, 'metrics')) {
    const result = metrics(model);
    console.log(formatMetrics(result));
    if (flagBool(args, 'json')) console.log(JSON.stringify(result, null, 2));
  }
  return 0;
}

function anyFormatRequested(args: ParsedArgs): boolean {
  return ['bbmodel', 'java', 'oraxen', 'itemsadder'].some((key) => args.flags.has(key));
}

async function commandRender(args: ParsedArgs): Promise<number> {
  if (!args.input) throw new Error('usage: aimodel render <spec> --out <dir>');
  const outDir = path.resolve(flagString(args, 'out') ?? 'out');
  const size = Number(flagString(args, 'size') ?? 256);
  const { model } = await loadModel(args.input);
  model.assignUv();
  fs.mkdirSync(outDir, { recursive: true });

  const views = (flagString(args, 'views') ?? 'front,back,left,right,top,bottom,iso').split(',').map((v) => v.trim());
  const stem = fileStem(model.name);
  for (const view of views) {
    const file = renderToFile(model, view, path.join(outDir, `${stem}_${view}.png`), {
      width: size,
      height: size,
      outline: true,
      background: [18, 19, 23, 255],
    });
    console.log(`  → ${path.relative(process.cwd(), file)}`);
  }
  if (!flagBool(args, 'no-sheet')) {
    const sheet = contactSheet(model, { width: size, height: size, views, outline: true });
    const file = writeBinary(path.join(outDir, `${stem}_sheet.png`), sheet.toPng());
    console.log(`  → ${path.relative(process.cwd(), file)}`);
  }
  return 0;
}

async function commandValidate(args: ParsedArgs): Promise<number> {
  if (!args.input) throw new Error('usage: aimodel validate <spec>');
  const { model, warnings } = await loadModel(args.input);
  printWarnings(warnings);
  model.assignUv();
  const report = validate(model, { strict: flagBool(args, 'strict'), warnOnEmptyBones: true });
  if (flagBool(args, 'json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
    console.log(report.ok ? 'ok' : 'FAILED');
  }
  return report.ok ? 0 : 1;
}

async function commandHygiene(args: ParsedArgs): Promise<number> {
  if (!args.input) throw new Error('usage: aimodel hygiene <spec> [--mode hide|separate|report]');
  const mode = (flagString(args, 'mode') ?? 'hide') as 'hide' | 'separate' | 'report';
  const { model } = await loadModel(args.input);
  model.assignUv();
  const result = geometricHygiene(model, {
    mode,
    ...(flagBool(args, 'strict') ? { hideCoverage: 0.5 } : {}),
  });
  if (flagBool(args, 'json')) {
    console.log(JSON.stringify({ report: result.report, resolved: result.resolved }, null, 2));
  } else {
    console.log(formatCoincidence(result.report));
    if (mode !== 'report') {
      console.log(`${mode}: ${result.resolved.length} face(s) adjusted`);
      for (const entry of result.resolved.slice(0, 10)) {
        console.log(`  ${entry.reason.padEnd(9)} ${entry.cube}.${entry.face}`);
      }
    }
  }
  if (result.report.pairs.length === 0) return 0;

  const fix = flagString(args, 'fix');
  if (fix) {
    const file = writeBbmodel(model, path.resolve(fix));
    console.log(`  → ${path.relative(process.cwd(), file)}`);
  }
  // Non-zero when coincident faces remain, so a build script can gate on it.
  return mode === 'report' ? 1 : 0;
}

async function commandMetrics(args: ParsedArgs): Promise<number> {
  if (!args.input) throw new Error('usage: aimodel metrics <spec>');
  const { model } = await loadModel(args.input);
  model.assignUv();
  const report = metrics(model, { viewSize: Number(flagString(args, 'size') ?? 256) });
  console.log(flagBool(args, 'json') ? JSON.stringify(report, null, 2) : formatMetrics(report));
  return 0;
}

const HELP = `aimodel — build Minecraft models as data

Usage:
  aimodel build <spec.json|spec.mjs> --out <dir> [options]
  aimodel render <spec> --out <dir> [--views front,iso] [--size 256]
  aimodel validate <spec> [--strict] [--json]
  aimodel metrics <spec> [--json]
  aimodel hygiene <spec> [--mode hide|separate|report] [--fix <file.bbmodel>] [--json]

Build options:
  --out <dir>        output directory (default ./out)
  --bbmodel [file]   write a .bbmodel (default when no format flag is given)
  --java             write a Java Block/Item model + texture
  --oraxen           write an Oraxen pack fragment
  --itemsadder       write an ItemsAdder pack fragment
  --preview          write a contact-sheet PNG
  --metrics          print quality metrics after building
  --size <px>        tile size for previews (default 256)
  --json             machine-readable metrics/validation
  --hygiene          hide faces that sit coincident with a neighbour (stops z-fighting)
  --soften           blend texture seams across cube joins
  --style <name>     sharp | balanced | soft, for --soften (default balanced)

Hygiene options:
  --mode <name>      hide (default) | separate | report
  --strict           also resolve partial overlaps (50% coverage instead of 90%)
  --fix <file>       write the cleaned model as a .bbmodel

Spec files may be JSON (see docs/SPEC.md) or a JS module default-exporting a Model,
a spec object, or a function returning either.
`;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  switch (args.command) {
    case 'build':
      return commandBuild(args);
    case 'render':
      return commandRender(args);
    case 'validate':
      return commandValidate(args);
    case 'metrics':
      return commandMetrics(args);
    case 'hygiene':
      return commandHygiene(args);
    case 'help':
    case '--help':
    case '-h':
    default:
      console.log(HELP);
      return args.command === 'help' || args.command === '--help' || args.command === '-h' ? 0 : 1;
  }
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
})();

if (isDirectRun) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}

// Referenced so `viewBasis`/`assertValid` stay part of the CLI bundle's public surface.
export const internals = { viewBasis, assertValid };
