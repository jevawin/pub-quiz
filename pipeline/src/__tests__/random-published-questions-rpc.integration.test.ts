import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Wave 0 — RED scaffolds (skipped without SUPABASE_TEST_URL).
// When the env var is present (Wave 4+), these tests exercise the new RPC.
// The RPC is called random_published_questions_v2 (name confirmed in Wave 4 migration).

const SUPABASE_TEST_URL = process.env.SUPABASE_TEST_URL ?? '';
const SUPABASE_TEST_SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_KEY ?? '';

describe.skipIf(!process.env.SUPABASE_TEST_URL)(
  'random_published_questions_v2 RPC — integration',
  () => {
    let supabase: SupabaseClient;
    let questionAId: string;
    let questionBId: string;
    let gkCategoryId: string;
    let scienceCategoryId: string;
    let moviesCategoryId: string;

    beforeEach(async () => {
      supabase = createClient(SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Fetch category IDs
      const { data: gk } = await supabase
        .from('categories')
        .select('id')
        .eq('slug', 'general-knowledge')
        .single();
      gkCategoryId = gk?.id;

      const { data: science } = await supabase
        .from('categories')
        .select('id')
        .eq('slug', 'science-and-nature')
        .single();
      scienceCategoryId = science?.id;

      const { data: movies } = await supabase
        .from('categories')
        .select('id')
        .eq('slug', 'movies-and-tv')
        .single();
      moviesCategoryId = movies?.id;

      // Seed question A: high observed_n=50, observed_score=80, estimate_score=20
      const { data: qA } = await supabase
        .from('questions')
        .insert({
          question_text: '__rpc_test_question_A__',
          correct_answer: 'Answer A',
          distractors: ['X', 'Y', 'Z'],
          explanation: 'Test only.',
          difficulty: 'normal',
          verification_score: 3,
          status: 'published',
        })
        .select('id')
        .single();
      questionAId = qA?.id;

      // question_categories for A: GK (estimate=20, observed_score=80, observed_n=50)
      await supabase.from('question_categories').insert([
        { question_id: questionAId, category_id: gkCategoryId, estimate_score: 20, observed_score: 80, observed_n: 50 },
        { question_id: questionAId, category_id: scienceCategoryId, estimate_score: 20, observed_score: 80, observed_n: 50 },
      ]);

      // Seed question B: low observed_n=5, observed_score=80, estimate_score=20
      const { data: qB } = await supabase
        .from('questions')
        .insert({
          question_text: '__rpc_test_question_B__',
          correct_answer: 'Answer B',
          distractors: ['X', 'Y', 'Z'],
          explanation: 'Test only.',
          difficulty: 'normal',
          verification_score: 3,
          status: 'published',
        })
        .select('id')
        .single();
      questionBId = qB?.id;

      // question_categories for B: GK (estimate=20, observed_score=80, observed_n=5 — below threshold)
      await supabase.from('question_categories').insert([
        { question_id: questionBId, category_id: gkCategoryId, estimate_score: 20, observed_score: 80, observed_n: 5 },
        { question_id: questionBId, category_id: moviesCategoryId, estimate_score: 20, observed_score: 80, observed_n: 5 },
      ]);
    });

    afterEach(async () => {
      for (const qid of [questionAId, questionBId]) {
        if (qid) {
          await supabase.from('question_categories').delete().eq('question_id', qid);
          await supabase.from('questions').delete().eq('id', qid);
        }
      }
    });

    it('uses observed_score when observed_n >= 30', async () => {
      // Question A: observed_n=50 (>=30), observed_score=80
      // Query score_min=70, score_max=100 → should return A
      const { data, error } = await supabase.rpc('random_published_questions_v2', {
        p_category_slug: 'science-and-nature',
        p_limit: 10,
        p_score_min: 70,
        p_score_max: 100,
      });
      expect(error).toBeNull();
      const ids = (data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).toContain(questionAId);
    });

    it('uses estimate_score when observed_n < 30', async () => {
      // Question B: observed_n=5 (<30), estimate_score=20
      // Query score_min=70, score_max=100 → should NOT return B (effective score is estimate=20)
      const { data, error } = await supabase.rpc('random_published_questions_v2', {
        p_category_slug: 'science-and-nature',
        p_limit: 10,
        p_score_min: 70,
        p_score_max: 100,
      });
      expect(error).toBeNull();
      const ids = (data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).not.toContain(questionBId);
    });

    it('filters by category slug', async () => {
      // Question B is only in movies-and-tv; query for science-and-nature should not return B
      const { data, error } = await supabase.rpc('random_published_questions_v2', {
        p_category_slug: 'science-and-nature',
        p_limit: 50,
        p_score_min: 0,
        p_score_max: 100,
      });
      expect(error).toBeNull();
      const ids = (data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).not.toContain(questionBId);
    });

    it('returns category_slug in result rows', async () => {
      const { data, error } = await supabase.rpc('random_published_questions_v2', {
        p_category_slug: 'science-and-nature',
        p_limit: 10,
        p_score_min: 0,
        p_score_max: 100,
      });
      expect(error).toBeNull();
      const rows = data as Array<Record<string, unknown>>;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row).toHaveProperty('category_slug');
        expect(typeof row.category_slug).toBe('string');
      }
    });
  }
);
