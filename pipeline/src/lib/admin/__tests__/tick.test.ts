import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTick } from '../cli.js';
import { processQueue } from '../queue.js';
import { makeFakeDb } from '../../taxonomy/__tests__/fake-db.js';
import type { TypedSupabaseClient } from '../../supabase.js';

type Row = Record<string, unknown>;
const cat = (slug: string, parent: string | null, depth: number): Row => ({
  id: `id-${slug}`, slug, name: slug, parent_id: parent ? `id-${parent}` : null, depth,
  hidden_at: null, hidden_reason: null, protected: false, created_by: 'seed',
});
const req = (id: number, action: string, payload: unknown): Row => ({
  id, action, payload, status: 'queued', result: null, run_id: null, created_at: `2026-10-31T00:00:0${id}Z`, done_at: null,
});
const seed = (reqs: Row[]) => ({
  categories: [cat('general-knowledge', null, 0), cat('food', null, 0), cat('cheese', 'food', 1), cat('french-cheese', 'cheese', 2), cat('brie', 'french-cheese', 3)],
  questions: [], question_categories: [], admin_requests: reqs,
});
const OUT = new Date('2026-10-31T08:00:00Z'); // GMT, outside 00:40-06:40
const IN = new Date('2026-10-31T02:00:00Z');
const deps = (now: Date, probe: () => Promise<null>) => ({ now: () => now, probe, env: {}, config: {} as never });
const row = (db: ReturnType<typeof makeFakeDb>, id: number) => db.tables.admin_requests.find((r) => r.id === id)!;

describe('runTick', () => {
  it('no merge queued -> probe never called', async () => {
    const db = makeFakeDb(seed([req(1, 'drop', { slugs: ['cheese'] })]));
    const probe = vi.fn(async () => null);
    const r = await runTick(db.client, deps(OUT, probe));
    expect(r.done).toBe(1);
    expect(probe).not.toHaveBeenCalled();
  });

  it('merge queued inside the window -> no probe, merge stays queued', async () => {
    const db = makeFakeDb(seed([req(1, 'merge', { slugs: ['brie'] })]));
    const probe = vi.fn(async () => null);
    const r = await runTick(db.client, deps(IN, probe));
    expect(r).toMatchObject({ done: 0, failed: 0 });
    expect(probe).not.toHaveBeenCalled();
    expect(row(db, 1).status).toBe('queued');
  });

  it('merge queued, unreadable usage -> merge stays queued, drop runs', async () => {
    const db = makeFakeDb(seed([req(1, 'merge', { slugs: ['brie'] }), req(2, 'drop', { slugs: ['cheese'] })]));
    const probe = vi.fn(async () => null);
    const r = await runTick(db.client, deps(OUT, probe));
    expect(probe).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ done: 1, failed: 0 });
    expect(row(db, 1).status).toBe('queued');
    expect(row(db, 2).status).toBe('done');
  });
});

describe('merge probe back-off (finding 4)', () => {
  it('a refused merge probe writes the back-off and the next tick does not probe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'admin-bo-'));
    const db = makeFakeDb(seed([req(1, 'merge', { slugs: ['brie'] })]));
    const probe = vi.fn(async () => null);
    const d = { now: () => OUT, probe, env: { ADMIN_STATE_DIR: dir }, config: {} as never };
    await runTick(db.client, d);
    expect(probe).toHaveBeenCalledTimes(1);
    const until = Number(readFileSync(join(dir, 'admin-probe-after'), 'utf8').trim());
    expect(until).toBe(Math.floor(OUT.getTime() / 1000) + 30 * 60);
    await runTick(db.client, d);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(row(db, 1).status).toBe('queued');
    // after the back-off expires the merge probes again
    const later = new Date(OUT.getTime() + 31 * 60_000);
    await runTick(db.client, { ...d, now: () => later });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('an expired back-off file does not block the probe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'admin-bo-'));
    writeFileSync(join(dir, 'admin-probe-after'), `${Math.floor(OUT.getTime() / 1000) - 1}\n`);
    const db = makeFakeDb(seed([req(1, 'merge', { slugs: ['brie'] })]));
    const probe = vi.fn(async () => null);
    await runTick(db.client, { now: () => OUT, probe, env: { ADMIN_STATE_DIR: dir }, config: {} as never });
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe('claim guard', () => {
  it('a row flipped to running between select and claim is left untouched', async () => {
    const db = makeFakeDb(seed([req(1, 'drop', { slugs: ['cheese'] })]));
    // Wrap the client: when our claim update (status -> running) arrives, another tick has already won it.
    const client = {
      from: (t: string) => {
        const q = db.client.from(t as never) as never as { update: (p: Row) => unknown };
        if (t !== 'admin_requests') return q;
        return new Proxy(q, {
          get(target, prop) {
            if (prop === 'update') {
              return (p: Row) => {
                if (p.status === 'running') row(db, 1).status = 'running';
                return target.update(p);
              };
            }
            return (target as never)[prop as never];
          },
        });
      },
    } as unknown as TypedSupabaseClient;
    const r = await processQueue(client, { now: () => OUT, maxRequests: 10 });
    expect(r).toEqual({ done: 0, failed: 0 });
    expect(row(db, 1).status).toBe('running');
    expect(db.tables.categories.find((c) => c.slug === 'cheese')!.hidden_reason).toBeNull();
  });
});
