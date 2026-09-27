import type { Model } from '../model/model.js';
import { FACE_NAMES } from '../model/types.js';
import { Canvas } from '../texture/canvas.js';
import { projectModel, viewBasis } from './projector.js';
import { buildScene, samplePose } from './scene.js';
import { clamp, dotVec, normalizeVec, rgbToHex } from '../util/math.js';

export interface MetricsReport {
  /** Number of distinct opaque colours in the atlas. Target 8–30. */
  palette: number;
  /** Mean distinct colours sampled inside one face's UV window. Target ≈3. */
  coloursPerFace: number;
  /** Fraction of faces with a single flat colour. Reported, never scored. */
  flatFaceShare: number;
  /** Faces per cube whose neighbours are a different colour band (edge contrast). */
  bandEdgesPerFace: number;
  /** 0..100 composite. */
  score: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  notes: string[];
  /** Fraction of the texture's opaque pixels that are actually used by a face. */
  uvUtilisation: number;
  /** Fraction of bones that carry at least one keyframe across all clips. */
  animatedBoneShare: number;
  /** Orphaned animators: bones referenced by a clip but absent from the rig. */
  orphanAnimators: string[];
  silhouette: {
    /** Pixels covered by the model in the front view. */
    coverage: number;
    /** 0 = perfectly symmetric left/right, 1 = fully asymmetric. */
    asymmetry: number;
  };
}

export interface MetricsOptions {
  /** Resolution used for the silhouette pass. */
  viewSize?: number;
}

/**
 * Offline quality metrics.
 *
 * These encode what "good Minecraft art" means for this toolkit, and just as importantly
 * what it does not: flat blocks are *reported* but never *scored*, because scoring flatness
 * rewards dithering and noise and produces the dirty-looking textures the metric exists to
 * prevent. What is scored is a small deliberate palette, a consistent number of colour
 * bands per face, and clear band edges.
 */
export function metrics(model: Model, options: MetricsOptions = {}): MetricsReport {
  const notes: string[] = [];
  const size = options.viewSize ?? 256;

  // --- palette ---
  const texture = model.textures[0];
  let palette = 0;
  let uvUtilisation = 0;
  const atlas = texture ? Canvas.fromPng(texture.data) : null;
  if (atlas) {
    const counts = atlas.distinctColors();
    palette = counts.size;
    const used = new Set<string>();
    for (const cube of model.cubes) {
      for (const face of FACE_NAMES) {
        const rect = cube.faces[face];
        if (!rect) continue;
        for (let y = Math.max(0, Math.floor(rect[1])); y < Math.min(atlas.height, Math.ceil(rect[3])); y += 1) {
          for (let x = Math.max(0, Math.floor(rect[0])); x < Math.min(atlas.width, Math.ceil(rect[2])); x += 1) {
            const [r, g, b, a] = atlas.get(x, y);
            if (a > 0) used.add(rgbToHex([r, g, b]));
          }
        }
      }
    }
    uvUtilisation = used.size === 0 ? 0 : clamp(used.size / Math.max(1, palette), 0, 1);
  }

  if (palette === 0) notes.push('no texture — palette metrics unavailable');
  else if (palette < 8) notes.push(`palette ${palette} is small; Minecraft art usually wants 8–48`);
  else if (palette > 48) notes.push(`palette ${palette} is large; the texture may be noisy or over-shaded`);

  // --- per-face colour counts ---
  const perFace: number[] = [];
  let flatFaces = 0;
  for (const cube of model.cubes) {
    for (const face of FACE_NAMES) {
      const rect = cube.faces[face];
      if (!rect || !atlas) continue;
      const seen = new Set<string>();
      for (let y = Math.max(0, Math.floor(rect[1])); y < Math.min(atlas.height, Math.ceil(rect[3])); y += 1) {
        for (let x = Math.max(0, Math.floor(rect[0])); x < Math.min(atlas.width, Math.ceil(rect[2])); x += 1) {
          const [r, g, b, a] = atlas.get(x, y);
          if (a > 0) seen.add(rgbToHex([r, g, b]));
        }
      }
      if (seen.size > 0) {
        perFace.push(seen.size);
        if (seen.size === 1) flatFaces += 1;
      }
    }
  }
  const coloursPerFace = perFace.length === 0 ? 0 : perFace.reduce((a, b) => a + b, 0) / perFace.length;
  const flatFaceShare = perFace.length === 0 ? 0 : flatFaces / perFace.length;

  if (coloursPerFace > 0 && coloursPerFace < 2) notes.push('faces are nearly single-colour; add one shade and one highlight');
  if (coloursPerFace > 5.5) notes.push('faces carry many colours; this usually reads as noise rather than shading');

  // --- band edges: colour transitions across a face window ---
  // Sampled along both the middle row and the middle column and the richer of the two is
  // kept: a vertical band ramp shows no horizontal transitions, and scoring only the row
  // would punish exactly the shading this toolkit encourages.
  let bandEdges = 0;
  if (atlas) {
    const transitions = (samples: string[]): number => {
      let count = 0;
      for (let i = 1; i < samples.length; i += 1) if (samples[i] !== samples[i - 1]) count += 1;
      return count;
    };
    for (const cube of model.cubes) {
      for (const face of FACE_NAMES) {
        const rect = cube.faces[face];
        if (!rect) continue;
        const row: string[] = [];
        const y = Math.floor((rect[1] + rect[3]) / 2);
        for (let x = Math.floor(rect[0]); x < Math.ceil(rect[2]); x += 1) {
          const [r, g, b, a] = atlas.get(x, y);
          if (a > 0) row.push(rgbToHex([r, g, b]));
        }
        const column: string[] = [];
        const cx = Math.floor((rect[0] + rect[2]) / 2);
        for (let yy = Math.floor(rect[1]); yy < Math.ceil(rect[3]); yy += 1) {
          const [r, g, b, a] = atlas.get(cx, yy);
          if (a > 0) column.push(rgbToHex([r, g, b]));
        }
        bandEdges += Math.max(transitions(row), transitions(column));
      }
    }
  }
  const bandEdgesPerFace = perFace.length === 0 ? 0 : bandEdges / perFace.length;

  // --- animation coverage ---
  const bones = new Set(model.rig.names);
  const animated = new Set<string>();
  const orphanAnimators = new Set<string>();
  for (const clip of model.clips) {
    for (const key of clip.keys) {
      if (bones.has(key.bone)) animated.add(key.bone);
      else orphanAnimators.add(key.bone);
    }
  }
  const animatedBoneShare = bones.size === 0 ? 0 : animated.size / bones.size;
  if (orphanAnimators.size > 0) notes.push(`${orphanAnimators.size} clip(s) reference bones that do not exist`);

  // --- silhouette ---
  const scene = buildScene(model);
  const render = projectModel(model, viewBasis('front'), { width: size, height: size, background: [0, 0, 0, 0] as [number, number, number, number] });
  let covered = 0;
  let mirrored = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const visible = render.get(x, y)[3] > 0;
      if (visible) covered += 1;
      const mirror = render.get(size - 1 - x, y)[3] > 0;
      if (visible !== mirror) mirrored += 1;
    }
  }
  const coverage = covered / (size * size);
  const asymmetry = covered === 0 ? 0 : mirrored / covered;

  // --- composite score ---
  // Palette: peak in 8..48 (a multi-material skin legitimately needs a few dozen), and a
  // gentle slope outside so a slightly rich palette is not punished like a noisy one.
  const PALETTE_MIN = 8;
  const PALETTE_MAX = 48;
  const paletteDistance = palette < PALETTE_MIN ? PALETTE_MIN - palette : palette > PALETTE_MAX ? palette - PALETTE_MAX : 0;
  const paletteScore = palette === 0 ? 0 : 100 - Math.min(100, paletteDistance * 2.5);
  // Colours per face: peak at 3, penalty either side.
  const cpfScore = coloursPerFace === 0 ? 0 : 100 - Math.min(100, Math.abs(coloursPerFace - 3) * 26);
  // Band edges: some transitions are good; a wall of noise is not.
  const bandScore = clamp(bandEdgesPerFace / 3, 0, 1) * 100;
  // Animation coverage: reward a rig that is actually used.
  const animScore = animatedBoneShare * 100;

  const score = Math.round(paletteScore * 0.34 + cpfScore * 0.36 + bandScore * 0.15 + animScore * 0.15);
  const grade: MetricsReport['grade'] = score >= 90 ? 'S' : score >= 78 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D';

  if (flatFaceShare > 0.6) notes.push(`${Math.round(flatFaceShare * 100)}% of faces are single-colour (reported, not scored)`);
  if (asymmetry > 0.35) notes.push('front silhouette is strongly asymmetric — check for a missing mirrored part');
  if (animatedBoneShare < 0.4 && model.clips.length > 0) notes.push('fewer than half the bones are animated');

  return {
    palette,
    coloursPerFace: Math.round(coloursPerFace * 100) / 100,
    flatFaceShare: Math.round(flatFaceShare * 1000) / 1000,
    bandEdgesPerFace: Math.round(bandEdgesPerFace * 100) / 100,
    score,
    grade,
    notes,
    uvUtilisation: Math.round(uvUtilisation * 1000) / 1000,
    animatedBoneShare: Math.round(animatedBoneShare * 1000) / 1000,
    orphanAnimators: [...orphanAnimators],
    silhouette: { coverage: Math.round(coverage * 1000) / 1000, asymmetry: Math.round(asymmetry * 1000) / 1000 },
  };
}

/** Human-readable metrics block for the console. */
export function formatMetrics(report: MetricsReport): string {
  const lines = [
    `score ${report.score}/100 (${report.grade})`,
    `palette ${report.palette} · colours/face ${report.coloursPerFace} · band edges/face ${report.bandEdgesPerFace}`,
    `flat faces ${Math.round(report.flatFaceShare * 100)}% (reported only) · uv use ${Math.round(report.uvUtilisation * 100)}%`,
    `bones animated ${Math.round(report.animatedBoneShare * 100)}% · silhouette ${Math.round(report.silhouette.coverage * 100)}% coverage`,
  ];
  for (const note of report.notes) lines.push(`! ${note}`);
  return lines.join('\n');
}
