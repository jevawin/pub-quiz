import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadState, saveState } from '../state.js';

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'tax-state-')); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('state file', () => {
  it('missing file = empty, no warning', () => {
    const w: string[] = [];
    expect(loadState(join(dir, 'none.json'), (m) => w.push(m))).toEqual({ roots: {}, rehome: {} });
    expect(w).toEqual([]);
  });
  it('corrupt or wrong-shape file = empty with a warning', () => {
    const w: string[] = [];
    writeFileSync(join(dir, 'bad.json'), '{nope');
    expect(loadState(join(dir, 'bad.json'), (m) => w.push(m))).toEqual({ roots: {}, rehome: {} });
    writeFileSync(join(dir, 'shape.json'), JSON.stringify({ roots: [] }));
    expect(loadState(join(dir, 'shape.json'), (m) => w.push(m))).toEqual({ roots: {}, rehome: {} });
    expect(w).toHaveLength(2);
  });
  it('round-trips and drops entries with bad timestamps', () => {
    const p = join(dir, 'ok', 'state.json');
    saveState(p, { roots: { a: '2026-10-01T00:00:00.000Z' }, rehome: { b: '2026-10-02T00:00:00.000Z' } });
    expect(loadState(p, () => {})).toEqual({ roots: { a: '2026-10-01T00:00:00.000Z' }, rehome: { b: '2026-10-02T00:00:00.000Z' } });
    writeFileSync(p, JSON.stringify({ roots: { a: 'junk', c: '2026-10-03T00:00:00Z' }, rehome: {} }));
    expect(loadState(p, () => {}).roots).toEqual({ c: '2026-10-03T00:00:00Z' });
  });
  it('write is atomic: a failed rename leaves the old file intact and no temp file', () => {
    const p = join(dir, 'atomic.json');
    saveState(p, { roots: { a: '2026-10-01T00:00:00.000Z' }, rehome: {} });
    const before = readFileSync(p, 'utf8');
    expect(() =>
      saveState(p, { roots: { a: '2030-01-01T00:00:00.000Z' }, rehome: {} }, {
        writeFileSync, renameSync: () => { throw new Error('crash before rename'); },
      }),
    ).toThrow('crash');
    expect(readFileSync(p, 'utf8')).toBe(before);
    expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);
    saveState(p, { roots: {}, rehome: {} }, { writeFileSync, renameSync });
    expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });
});
