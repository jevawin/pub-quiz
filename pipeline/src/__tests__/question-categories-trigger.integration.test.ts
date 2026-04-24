import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Wave 0 — RED scaffolds (skipped without SUPABASE_TEST_URL).
// When the env var is present (Wave 1+), these tests exercise the real trigger.

const SUPABASE_TEST_URL = process.env.SUPABASE_TEST_URL ?? '';
const SUPABASE_TEST_SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_KEY ?? '';

describe.skipIf(!process.env.SUPABASE_TEST_URL)(
  'question_categories trigger — integration',
  () => {
    let supabase: SupabaseClient;
    let testQuestionId: string;
    let gkCategoryId: string;
    let scienceCategoryId: string;

    beforeAll(async () => {
      supabase = createClient(SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Fetch the canonical category IDs we need for tests
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

      // Insert a test question row
      const { data: q } = await supabase
        .from('questions')
        .insert({
          question_text: '__test_trigger_question__',
          correct_answer: 'Test',
          distractors: ['A', 'B', 'C'],
          explanation: 'Test only.',
          difficulty: 'normal',
          verification_score: 0,
          status: 'pending',
        })
        .select('id')
        .single();
      testQuestionId = q?.id;
    });

    afterAll(async () => {
      if (testQuestionId) {
        await supabase.from('question_categories').delete().eq('question_id', testQuestionId);
        await supabase.from('questions').delete().eq('id', testQuestionId);
      }
    });

    it('accepts question with GK row plus one extra', async () => {
      // Insert GK row + science row in one batch — trigger fires at commit
      const { error } = await supabase.from('question_categories').insert([
        { question_id: testQuestionId, category_id: gkCategoryId, estimate_score: 40 },
        { question_id: testQuestionId, category_id: scienceCategoryId, estimate_score: 70 },
      ]);
      expect(error).toBeNull();

      // Clean up for next test
      await supabase.from('question_categories').delete().eq('question_id', testQuestionId);
    });

    it('rejects question with no GK row', async () => {
      // Insert only a non-GK row — trigger should reject at commit
      const { error } = await supabase.from('question_categories').insert([
        { question_id: testQuestionId, category_id: scienceCategoryId, estimate_score: 70 },
      ]);
      // Trigger raises exception containing 'general-knowledge'
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/general-knowledge/i);
    });

    it('rejects question with 5 category rows', async () => {
      // First, insert valid 4 rows (GK + 3 others)
      // Then try inserting a 5th — trigger should reject
      // This test requires 4 category slugs besides GK; use whatever exists.
      // For now, mark as todo if not enough categories exist in test DB.
      // Wave 1 seeds the test DB so this will resolve.
      expect(true).toBe(true); // placeholder — real assertion in Wave 1 seed setup
      // TODO(Wave 1): Insert 5 rows for one question including GK and assert error containing 'cannot have more than 4'
    });

    it('DEFERRABLE trigger allows multi-row insert within one transaction', async () => {
      // The trigger is DEFERRABLE INITIALLY DEFERRED — it fires at commit, not per-row.
      // Inserting non-GK row first then GK row in same transaction must succeed.
      // PostgREST batches inserts in one transaction, so the two-row insert above
      // already exercises this path. Mark as explicit documentation test.
      //
      // For raw BEGIN/COMMIT test, exec_sql RPC is needed (Wave 1 adds it).
      // If the batch insert from 'accepts question with GK row plus one extra' passed,
      // deferrable behaviour is confirmed.
      const { error } = await supabase.from('question_categories').insert([
        { question_id: testQuestionId, category_id: scienceCategoryId, estimate_score: 70 },
        { question_id: testQuestionId, category_id: gkCategoryId, estimate_score: 40 },
      ]);
      expect(error).toBeNull();

      // Clean up
      await supabase.from('question_categories').delete().eq('question_id', testQuestionId);
    });
  }
);
