import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.TEST_SUPABASE_URL;
const anon = process.env.TEST_SUPABASE_ANON_KEY;

const describeIntegration = url && anon ? describe : describe.skip;

describeIntegration('RLS integration (local supabase)', () => {
  let client: ReturnType<typeof createClient>;
  let sessionId: string;

  beforeAll(async () => {
    client = createClient(url!, anon!, { auth: { persistSession: false } });
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    sessionId = data.session!.user.id;
  });

  it('insert succeeds with session_id = auth.uid() and NO .select()', async () => {
    const { data: qs } = await client.rpc('random_published_questions', {
      p_difficulty: 'easy', p_category_slug: 'general', p_limit: 1,
    });
    expect(qs).toBeTruthy();
    expect((qs as unknown[]).length).toBeGreaterThan(0);
    const question = (qs as Array<{ id: string }>)[0]!;

    const { error } = await client.from('question_plays').insert({
      session_id: sessionId,
      question_id: question.id,
      chosen_option: 'test',
      is_correct: false,
      time_to_answer_ms: 1000,
      played_at: new Date().toISOString(),
    });
    expect(error).toBeNull();
  });

  it('insert is denied when session_id does not match auth.uid()', async () => {
    const { data: qs } = await client.rpc('random_published_questions', {
      p_difficulty: 'easy', p_category_slug: 'general', p_limit: 1,
    });
    const question = (qs as Array<{ id: string }>)[0]!;

    const { error } = await client.from('question_plays').insert({
      session_id: '00000000-0000-0000-0000-000000000000',
      question_id: question.id,
      chosen_option: 'test',
      is_correct: false,
      time_to_answer_ms: 1000,
      played_at: new Date().toISOString(),
    });
    expect(error).not.toBeNull();
  });

  it('SELECT on question_plays is denied', async () => {
    const { data, error } = await client.from('question_plays').select('*').limit(1);
    // Insert-only RLS: no SELECT policy means zero rows returned, no error.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('random_published_questions returns N rows at requested difficulty', async () => {
    const { data, error } = await client.rpc('random_published_questions', {
      p_difficulty: 'easy', p_category_slug: 'general', p_limit: 3,
    });
    expect(error).toBeNull();
    expect((data as unknown[]).length).toBeGreaterThan(0);
    expect((data as unknown[]).length).toBeLessThanOrEqual(3);
  });
});
