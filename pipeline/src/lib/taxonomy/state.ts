import { mkdirSync, renameSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';

/** Persisted rotation state: slug -> ISO time of the last assessment / re-home classification. */
export interface TaxState {
  roots: Record<string, string>;
  rehome: Record<string, string>;
  /**
   * Re-home categories whose OWN questions errored: failed attempts so far and the run id of the last one (a resume
   * of the same run id does not count again). After 2 failed runs the category is marked done anyway and reported,
   * so one bad question cannot freeze the rotation. Optional: older state files have none.
   */
  rehomeAttempts?: Record<string, { n: number; run: string }>;
}

export const emptyState = (): TaxState => ({ roots: {}, rehome: {} });

function cleanMap(v: unknown): Record<string, string> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, t] of Object.entries(v)) if (typeof t === 'string' && Number.isFinite(Date.parse(t))) out[k] = t;
  return out;
}

function cleanAttempts(v: unknown): Record<string, { n: number; run: string }> {
  const out: Record<string, { n: number; run: string }> = {};
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  for (const [k, a] of Object.entries(v)) {
    const o = a as { n?: unknown; run?: unknown } | null;
    if (o && typeof o.n === 'number' && Number.isInteger(o.n) && o.n > 0 && typeof o.run === 'string') out[k] = { n: o.n, run: o.run };
  }
  return out;
}

/** Missing file = empty state. Corrupt or malformed file = empty state plus a warning. Never throws. */
export function loadState(path: string | undefined, warn: (msg: string) => void): TaxState {
  if (!path) return emptyState();
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warn(`state file unreadable, treating as empty: ${(e as Error).message}`);
    return emptyState();
  }
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const roots = cleanMap(j.roots);
    const rehome = cleanMap(j.rehome);
    if (!roots || !rehome) throw new Error('wrong shape');
    const attempts = cleanAttempts(j.rehomeAttempts);
    return Object.keys(attempts).length ? { roots, rehome, rehomeAttempts: attempts } : { roots, rehome };
  } catch (e) {
    warn(`state file is corrupt, treating as empty: ${(e as Error).message}`);
    return emptyState();
  }
}

export interface StateIo {
  writeFileSync: typeof writeFileSync;
  renameSync: typeof renameSync;
}

/** Atomic: write a temp file in the same directory, then rename over the target. */
export function saveState(path: string, state: TaxState, io: StateIo = { writeFileSync, renameSync }): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    io.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    io.renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}
