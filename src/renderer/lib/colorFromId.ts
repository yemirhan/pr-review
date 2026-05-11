/**
 * Deterministic mapping from a string (repo id) to a tile color pair
 * (background + foreground). Used by the collapsed sidebar rail so each
 * repo gets a recognizable, stable letter-tile color.
 *
 * Backgrounds are saturated enough to read against both themes;
 * foregrounds are chosen for AA contrast on the background.
 */

const TILES: Array<{ bg: string; fg: string }> = [
  { bg: '#7c3aed', fg: '#ffffff' }, // violet
  { bg: '#0ea5e9', fg: '#ffffff' }, // sky
  { bg: '#10b981', fg: '#062e1a' }, // emerald
  { bg: '#f59e0b', fg: '#2a1a01' }, // amber
  { bg: '#ef4444', fg: '#ffffff' }, // red
  { bg: '#ec4899', fg: '#ffffff' }, // pink
  { bg: '#14b8a6', fg: '#022c27' }, // teal
  { bg: '#6366f1', fg: '#ffffff' } // indigo
];

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function tileColor(seed: string): { bg: string; fg: string } {
  return TILES[hash(seed) % TILES.length];
}

export function tileLetter(label: string): string {
  const cleaned = label.replace(/^@/, '').trim();
  return (cleaned[0] ?? '?').toUpperCase();
}
