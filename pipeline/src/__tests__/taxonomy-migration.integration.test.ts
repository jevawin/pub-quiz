import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Skipped unless SUPABASE_URL is set (same pattern as question-categories-trigger.integration.test.ts).
// Writes rows: run only against a disposable/test database.
const URL = process.env.SUPABASE_URL ?? '';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const tag = `__tx_${Date.now()}`;

describe.skipIf(!process.env.SUPABASE_URL)('taxonomy stage 2 migration — integration', () => {
  let db: SupabaseClient;
  const catIds: string[] = [];
  const questionIds: string[] = [];
  let gkId: string;

  async function mkCat(slug: string, parent: string | null, depth: number, extra: Record<string, unknown> = {}) {
    const { data, error } = await db
      .from('categories')
      .insert({ slug: `${tag}-${slug}`, name: slug, parent_id: parent, depth, ...extra })
      .select('id')
      .single();
    if (error) throw error;
    catIds.push(data!.id);
    return data!.id as string;
  }
  async function mkQuestion(status: string) {
    const { data, error } = await db
      .from('questions')
      .insert({
        question_text: `${tag} q`,
        correct_answer: 'x',
        distractors: ['a', 'b', 'c'],
        explanation: 't',
        difficulty: 'normal',
        verification_score: 0,
        status,
      })
      .select('id')
      .single();
    if (error) throw error;
    questionIds.push(data!.id);
    return data!.id as string;
  }

  beforeAll(async () => {
    db = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data } = await db.from('categories').select('id').eq('slug', 'general-knowledge').single();
    gkId = data!.id;
  });

  afterAll(async () => {
    if (questionIds.length) {
      await db.from('question_categories').delete().in('question_id', questionIds);
      await db.from('questions').delete().in('id', questionIds);
    }
    for (const id of [...catIds].reverse()) await db.from('categories').delete().eq('id', id);
  });

  it('allows 7 rows (6-deep chain + GK) and rejects a 9th', async () => {
    const chain: string[] = [];
    let parent: string | null = null;
    for (let d = 0; d < 6; d++) {
      parent = await mkCat(`chain${d}`, parent, d);
      chain.push(parent);
    }
    const q = await mkQuestion('pending');
    const rows = [...chain, gkId].map((category_id) => ({ question_id: q, category_id, estimate_score: 50 }));
    const ok = await db.from('question_categories').insert(rows);
    expect(ok.error).toBeNull();

    const extra = [await mkCat('x1', null, 0), await mkCat('x2', null, 0)];
    const bad = await db
      .from('question_categories')
      .insert(extra.map((category_id) => ({ question_id: q, category_id, estimate_score: 50 })));
    expect(bad.error?.message).toMatch(/cannot have more than 8/);
  });

  it('rejects a bogus hidden_reason', async () => {
    const { error } = await db
      .from('categories')
      .insert({ slug: `${tag}-bogus`, name: 'bogus', depth: 0, hidden_reason: 'bogus' });
    expect(error).not.toBeNull();
  });

  it('category_visibility: visible for child and parent, hidden child drops out', async () => {
    const parent = await mkCat('vparent', null, 0);
    const child = await mkCat('vchild', parent, 1);
    for (let i = 0; i < 10; i++) {
      const q = await mkQuestion('published');
      const { error } = await db.from('question_categories').insert([
        { question_id: q, category_id: child, estimate_score: 50 },
        { question_id: q, category_id: gkId, estimate_score: 50 },
      ]);
      expect(error).toBeNull();
    }
    const read = async (id: string) =>
      (await db.from('category_visibility').select('visible,distinct_published').eq('category_id', id).single()).data;
    expect((await read(child))?.visible).toBe(true);
    expect((await read(parent))?.visible).toBe(true);
    expect((await read(parent))?.distinct_published).toBe(10);

    await db.from('categories').update({ hidden_at: new Date().toISOString(), hidden_reason: 'trimmed' }).eq('id', child);
    expect((await read(child))?.visible).toBe(false);
  });
});
