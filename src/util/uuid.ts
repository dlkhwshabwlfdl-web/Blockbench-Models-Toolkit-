import { hashString } from './math.js';

/**
 * Deterministic UUIDs.
 *
 * Blockbench ids every element, group, texture, animation and keyframe. If we generated
 * them randomly, rebuilding the same model would produce a different file every time and
 * diffs would be useless. Instead we derive a stable v4-shaped id from a seed string, so
 * `rebuild(model) === rebuild(model)` byte for byte.
 */

function xorshift32(seed: number): () => number {
  let state = seed || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

/** A stable UUID (8-4-4-4-12 hex) derived from `seed`. */
export function uuidFor(seed: string): string {
  const next = xorshift32(hashString(seed));
  const bytes: number[] = [];
  for (let i = 0; i < 16; i += 1) bytes.push(next() & 0xff);
  // Stamp version 4 and the RFC 4122 variant so the shape is indistinguishable from a v4.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * A namespaced id allocator. Two callers asking for the same key get the same uuid, and
 * the key is namespaced so a bone called "head" never collides with a cube called "head".
 */
export class UuidSpace {
  private readonly cache = new Map<string, string>();

  constructor(private readonly namespace: string) {}

  get(key: string): string {
    const cached = this.cache.get(key);
    if (cached) return cached;
    const id = uuidFor(`${this.namespace}:${key}`);
    this.cache.set(key, id);
    return id;
  }
}
