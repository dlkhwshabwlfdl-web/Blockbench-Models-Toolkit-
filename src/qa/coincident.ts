import type { Model } from '../model/model.js';
import { FACE_NORMALS } from '../model/types.js';
import type { Cube, FaceName, Vec3 } from '../model/types.js';
import { posedFaceCorners, visibleFaces } from '../model/cubes.js';
import { elementMatrix } from '../model/rotation.js';
import { crossVec, dotVec, normalizeVec } from '../util/math.js';
import { transformDirection } from '../util/mat4.js';

/**
 * Geometry hygiene.
 *
 * Two faces that occupy the same plane and overlap are the most common reason a model looks
 * broken in motion: the rasteriser has to pick a winner per pixel, tiny numerical differences
 * flip that choice as the view moves, and the two colours shimmer into each other along the
 * shared region. Blockbench exposes alignment/pivot tooling to avoid it by hand; this module
 * finds it and removes it.
 *
 * Two cases are reported separately because the fix differs:
 *
 *  - **interior** — opposite normals on the same plane. Invisible from outside, so hiding
 *    both faces costs nothing and ends the z-fighting.
 *  - **duplicate** — same normal on the same plane. Two pieces of geometry claiming one
 *    surface; one must win deterministically.
 */

export type CoincidenceKind = 'interior' | 'duplicate';

export interface CoincidentPair {
  kind: CoincidenceKind;
  a: { cube: string; face: FaceName };
  b: { cube: string; face: FaceName };
  /** Overlapping area, model units². */
  overlap: number;
  /** Overlap as a fraction of the smaller face's area, 0..1. */
  coverage: number;
  /** Distance between the two planes. */
  gap: number;
}

export interface CoincidenceReport {
  pairs: CoincidentPair[];
  /** Cubes with identical bounds and rotation — almost always an accidental duplicate. */
  duplicates: Array<{ a: string; b: string }>;
}

export interface FindOptions {
  /** Plane-distance tolerance, model units. Default 0.02. */
  tolerance?: number;
  /** Ignore overlaps smaller than this, model units². Default 0.001. */
  minOverlap?: number;
}

interface FacePlane {
  cube: Cube;
  face: FaceName;
  corners: [Vec3, Vec3, Vec3, Vec3];
  normal: Vec3;
  /** Canonical (sign-normalised) normal, used to group coplanar faces. */
  canonical: Vec3;
  /** Plane offset measured against the canonical normal. */
  offset: number;
  /** Projection of the corners into the plane's own 2D basis. */
  poly: Array<[number, number]>;
  area: number;
}

const EPS = 1e-6;

const roundTo = (value: number, places = 3): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function faceNormal(cube: Cube, face: FaceName): Vec3 {
  const base = FACE_NORMALS[face];
  if (cube.rotation[0] === 0 && cube.rotation[1] === 0 && cube.rotation[2] === 0) return base;
  return normalizeVec(transformDirection(elementMatrix(cube), base));
}

function planeBasis(normal: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = normalizeVec(crossVec(helper, normal));
  const e2 = normalizeVec(crossVec(normal, e1));
  return [e1, e2];
}

function signedArea(poly: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Sutherland–Hodgman clip of a convex subject polygon. */
function clipPolygon(subject: Array<[number, number]>, clip: Array<[number, number]>): Array<[number, number]> {
  const clipIsCcw = signedArea(clip) > 0;
  let output = subject;
  for (let i = 0; i < clip.length; i += 1) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const side = (p: [number, number]): number => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const inside = (p: [number, number]): boolean => (clipIsCcw ? side(p) >= -EPS : side(p) <= EPS);
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j += 1) {
      const current = input[j];
      const previous = input[(j + input.length - 1) % input.length];
      const currentInside = inside(current);
      const previousInside = inside(previous);
      if (currentInside) {
        if (!previousInside) output.push(edgeIntersect(previous, current, a, b));
        output.push(current);
      } else if (previousInside) {
        output.push(edgeIntersect(previous, current, a, b));
      }
    }
    if (output.length === 0) return [];
  }
  return output;
}

function edgeIntersect(
  p1: [number, number],
  p2: [number, number],
  a: [number, number],
  b: [number, number],
): [number, number] {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = b[0] - a[0];
  const d2y = b[1] - a[1];
  const denominator = d1x * d2y - d1y * d2x;
  if (Math.abs(denominator) < EPS) return [...p2];
  const t = ((a[0] - p1[0]) * d2y - (a[1] - p1[1]) * d2x) / denominator;
  return [p1[0] + d1x * t, p1[1] + d1y * t];
}

function canonicalise(normal: Vec3): { canonical: Vec3; flipped: boolean } {
  const [x, y, z] = normal;
  const flipped =
    x < -EPS ||
    (Math.abs(x) <= EPS && y < -EPS) ||
    (Math.abs(x) <= EPS && Math.abs(y) <= EPS && z < 0);
  return { canonical: flipped ? [-x, -y, -z] : [x, y, z], flipped };
}

function collectPlanes(model: Model, tolerance: number): FacePlane[] {
  const planes: FacePlane[] = [];
  const precision = Math.max(1, Math.ceil(-Math.log10(tolerance)));
  for (const cube of model.cubes) {
    for (const face of visibleFaces(cube)) {
      const corners = posedFaceCorners(cube, face);
      const normal = faceNormal(cube, face);
      const { canonical, flipped } = canonicalise(normal);
      const rawOffset = dotVec(normal, corners[0]);
      const offset = flipped ? -rawOffset : rawOffset;
      const [e1, e2] = planeBasis(canonical);
      const poly = corners.map((corner): [number, number] => [dotVec(corner, e1), dotVec(corner, e2)]);
      planes.push({
        cube,
        face,
        corners,
        normal,
        canonical,
        offset: roundTo(offset, precision),
        poly,
        area: Math.abs(signedArea(poly)),
      });
    }
  }
  return planes;
}

/** Find every pair of faces that occupy the same plane and overlap. */
export function findCoincidentFaces(model: Model, options: FindOptions = {}): CoincidenceReport {
  const tolerance = options.tolerance ?? 0.02;
  const minOverlap = options.minOverlap ?? 1e-3;
  const planes = collectPlanes(model, tolerance);

  const buckets = new Map<string, FacePlane[]>();
  for (const plane of planes) {
    const key = `${plane.canonical.map((v) => roundTo(v, 3)).join('|')}|${plane.offset}`;
    const list = buckets.get(key);
    if (list) list.push(plane);
    else buckets.set(key, [plane]);
  }

  const pairs: CoincidentPair[] = [];
  for (const group of buckets.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i];
        const b = group[j];
        if (a.cube === b.cube) continue;
        const clipped = clipPolygon(a.poly, b.poly);
        if (clipped.length < 3) continue;
        const overlap = Math.abs(signedArea(clipped));
        if (overlap < minOverlap) continue;
        const sameDirection = dotVec(a.normal, b.normal) > 0.5;
        const smaller = Math.min(a.area, b.area);
        pairs.push({
          kind: sameDirection ? 'duplicate' : 'interior',
          a: { cube: a.cube.name, face: a.face },
          b: { cube: b.cube.name, face: b.face },
          overlap: roundTo(overlap, 4),
          coverage: roundTo(smaller > 0 ? overlap / smaller : 0, 4),
          gap: roundTo(Math.abs(a.offset - b.offset), 4),
        });
      }
    }
  }

  pairs.sort((left, right) => right.overlap - left.overlap);
  return { pairs, duplicates: findDuplicateCubes(model) };
}

/** Cubes with identical bounds and rotation. */
export function findDuplicateCubes(model: Model): Array<{ a: string; b: string }> {
  const seen = new Map<string, string>();
  const duplicates: Array<{ a: string; b: string }> = [];
  for (const cube of model.cubes) {
    const key = [...cube.from, ...cube.to, ...cube.rotation].map((value) => roundTo(value)).join(',');
    const existing = seen.get(key);
    if (existing) duplicates.push({ a: existing, b: cube.name });
    else seen.set(key, cube.name);
  }
  return duplicates;
}

export interface HygieneOptions extends FindOptions {
  /** Hide a face when the overlap covers at least this fraction of it. Default 0.9. */
  hideCoverage?: number;
  /** `hide` removes faces, `separate` nudges geometry apart, `report` only inspects. */
  mode?: 'hide' | 'separate' | 'report';
  /** Nudge distance for `mode: 'separate'`. Default 0.05. */
  epsilon?: number;
}

export interface HygieneResult {
  report: CoincidenceReport;
  resolved: Array<{ cube: string; face: FaceName; reason: CoincidenceKind }>;
  hiddenByCube: Record<string, FaceName[]>;
}

/** Visible face area per `cube|face` key, model units². */
export function faceSurfaceAreas(model: Model, tolerance = 0.02): Map<string, number> {
  const areas = new Map<string, number>();
  for (const plane of collectPlanes(model, tolerance)) {
    areas.set(`${plane.cube.name}|${plane.face}`, plane.area);
  }
  return areas;
}

const faceKey = (ref: { cube: string; face: FaceName }): string => `${ref.cube}|${ref.face}`;

/**
 * Remove coincident faces.
 *
 * Coverage is accumulated **per face**, not per pair. That distinction matters: a small ridge
 * sitting on a wide back is coincident with the back face only where it touches, so hiding the
 * back face because "the overlap covers 100% of the smaller face" would punch a hole straight
 * through the model. A face is hidden only once its neighbours between them cover
 * `hideCoverage` of *its own* area.
 *
 * Interior pairs are invisible from outside, so both faces are candidates. For a duplicate pair
 * the cube that appears first in the model keeps its surface, which makes the surviving surface
 * deterministic across rebuilds.
 *
 * Partial overlaps below `hideCoverage` are left alone and only reported: a partly-covered face
 * is doing real work.
 */
export function geometricHygiene(model: Model, options: HygieneOptions = {}): HygieneResult {
  const hideCoverage = options.hideCoverage ?? 0.9;
  const mode = options.mode ?? 'hide';
  const epsilon = options.epsilon ?? 0.05;
  const report = findCoincidentFaces(model, options);
  const areas = faceSurfaceAreas(model, options.tolerance ?? 0.02);

  const resolved: Array<{ cube: string; face: FaceName; reason: CoincidenceKind }> = [];
  const hiddenByCube: Record<string, FaceName[]> = {};
  const byName = new Map(model.cubes.map((cube) => [cube.name, cube]));
  const indexOf = new Map(model.cubes.map((cube, index) => [cube.name, index]));
  const seen = new Set<string>();

  const apply = (cubeName: string, face: FaceName, reason: CoincidenceKind, action: 'hide' | 'separate'): void => {
    const key = `${cubeName}|${face}`;
    if (seen.has(key)) return;
    seen.add(key);
    const cube = byName.get(cubeName);
    if (!cube) return;
    if (mode === 'report') {
      resolved.push({ cube: cubeName, face, reason });
      return;
    }
    if (mode === 'separate') action = 'separate';
    if (action === 'hide') {
      if (cube.hidden.has(face)) return;
      cube.hidden.add(face);
    } else {
      separateFace(cube, face, epsilon);
    }
    resolved.push({ cube: cubeName, face, reason });
    hiddenByCube[cubeName] = [...(hiddenByCube[cubeName] ?? []), face];
  };

  // Sum interior overlap per face, then hide whichever faces are covered on their own terms.
  const interiorOverlap = new Map<string, number>();
  for (const pair of report.pairs) {
    if (pair.kind !== 'interior') continue;
    interiorOverlap.set(faceKey(pair.a), (interiorOverlap.get(faceKey(pair.a)) ?? 0) + pair.overlap);
    interiorOverlap.set(faceKey(pair.b), (interiorOverlap.get(faceKey(pair.b)) ?? 0) + pair.overlap);
  }
  for (const [key, overlap] of interiorOverlap) {
    const area = areas.get(key) ?? 0;
    if (area <= 0 || overlap / area < hideCoverage) continue;
    // Back-to-back faces buried inside solid geometry. Removing one is free, because it can
    // never be rasterised from outside either way. A *partly* overlapping interior pair is
    // left alone: the coincident patch is usually buried too, and retracting it would only
    // open a hairline gap where the neighbour ends.
    const [cubeName, face] = key.split('|') as [string, FaceName];
    apply(cubeName, face, 'interior', 'hide');
  }

  // Two faces on one plane facing the same way are the classic z-fight. Only the later cube is
  // touched, so the surviving surface is the same on every rebuild.
  for (const pair of report.pairs) {
    if (pair.kind !== 'duplicate') continue;
    const firstIndex = indexOf.get(pair.a.cube) ?? 0;
    const secondIndex = indexOf.get(pair.b.cube) ?? 0;
    const winner = firstIndex <= secondIndex ? pair.a : pair.b;
    const loser = winner === pair.a ? pair.b : pair.a;
    const area = areas.get(faceKey(loser)) ?? 0;
    // Fully covered → hide it. Partly covered → the loser's surface is real geometry that
    // merely overlaps, so shrink that face just behind the winner rather than cut a hole in it.
    const fullyCovered = area > 0 && pair.overlap / area >= hideCoverage;
    apply(loser.cube, loser.face, 'duplicate', fullyCovered ? 'hide' : 'separate');
  }

  return { report, resolved, hiddenByCube };
}

/**
 * Pull one face inward, just enough that it stops sharing a plane with its neighbour.
 *
 * Inward, not outward: pushing a face out would grow the silhouette, while retracting it by a
 * twentieth of a unit is invisible and guarantees the other cube's surface wins every pixel.
 */
function separateFace(cube: Cube, face: FaceName, amount: number): void {
  const axis = face === 'east' || face === 'west' ? 0 : face === 'up' || face === 'down' ? 1 : 2;
  const positive = face === 'east' || face === 'up' || face === 'south';
  if (positive) cube.to[axis] -= amount;
  else cube.from[axis] += amount;
}

/** Human-readable coincidence report. */
export function formatCoincidence(report: CoincidenceReport): string {
  if (report.pairs.length === 0 && report.duplicates.length === 0) {
    return 'no coincident faces or duplicate cubes';
  }
  const interior = report.pairs.filter((pair) => pair.kind === 'interior').length;
  const duplicate = report.pairs.filter((pair) => pair.kind === 'duplicate').length;
  const lines = [`${interior} interior · ${duplicate} duplicate face pair(s)`];
  for (const pair of report.pairs.slice(0, 8)) {
    lines.push(
      `  ${pair.kind.padEnd(9)} ${pair.a.cube}.${pair.a.face} ↔ ${pair.b.cube}.${pair.b.face}` +
        ` · overlap ${pair.overlap} (${Math.round(pair.coverage * 100)}% of the smaller face)`,
    );
  }
  if (report.pairs.length > 8) lines.push(`  … ${report.pairs.length - 8} more`);
  for (const duplicate of report.duplicates) lines.push(`  duplicate cube ${duplicate.a} = ${duplicate.b}`);
  return lines.join('\n');
}
