// Wave 0 — RED scaffold for Phase 999.22 chain-tagging calibrator.
// `calibrateQuestionWithChain` does not exist yet — Wave 1 adds it.
// Expected failure mode: "has no exported member 'calibrateQuestionWithChain'".
//
// Contract: take an assigned slug, walk up the parent chain, request a per-tier
// score from the model, upsert one qc row per ancestor with INSERT ... ON CONFLICT
// DO NOTHING (insert-only — preserves existing scores per locked decision 5).
// GK row is OPTIONAL — only inserted when the calibrator deems Q pub-table-knowable
// (per locked decision 4); calibrator returns gk score >= GK_THRESHOLD.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub: import surface that Wave 1 must export.
// Test will fail at import time until Wave 1 adds the export.
import { calibrateQuestionWithChain, GK_THRESHOLD } from '../calibrator';
import { UsageStopError } from '../../lib/usage.js';

// Minimal types reused — actual types live in calibrator.ts.
type SbResult = { error: { message: string } | null };
const upsertCalls: Array<{ rows: unknown }> = [];

function makeFakeSupabase() {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: () => Promise.resolve({
            data: [
              { id: 'c-gaming', slug: 'gaming', parent_id: null },
              { id: 'c-vgf', slug: 'video-game-franchises', parent_id: 'c-gaming' },
              { id: 'c-gk', slug: 'general-knowledge', parent_id: null },
            ],
            error: null,
          }),
        };
      }
      if (table === 'question_categories') {
        return {
          // Insert with onConflict: ignore — captured for assertion.
          insert: vi.fn().mockImplementation((rows: unknown) => {
            upsertCalls.push({ rows });
            return Promise.resolve({ error: null } as SbResult);
          }),
          upsert: vi.fn().mockImplementation((rows: unknown) => {
            upsertCalls.push({ rows });
            return Promise.resolve({ error: null } as SbResult);
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

function makeFakeClaude(scores: Record<string, number>) {
  return vi.fn().mockResolvedValue({
    text: JSON.stringify({ scores, reasoning: 'test' }),
    rateLimit: null,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0,
  });
}

beforeEach(() => {
  upsertCalls.length = 0;
});

describe('calibrateQuestionWithChain — chain row emission', () => {
  it('emits one qc row per ancestor when assigned to a leaf', async () => {
    const supabase = makeFakeSupabase();
    const claude = makeFakeClaude({
      gaming: 25,
      video_game_franchises: 55,
      general_knowledge: 5, // below threshold → omitted
    });

    const out = await calibrateQuestionWithChain(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      {
        id: 'q-1',
        question_text: 'Test',
        correct_answer: 'A',
        distractors: ['B', 'C', 'D'],
        assigned_slugs: ['video-game-franchises'],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      claude as any,
      { claudeModelVerification: 'sonnet' },
    );

    expect(out.success).toBe(true);
    expect(upsertCalls.length).toBeGreaterThan(0);
    const inserted = upsertCalls.flatMap((c) => c.rows as Array<{ category_id: string; estimate_score: number }>);
    const insertedIds = inserted.map((r) => r.category_id).sort();
    expect(insertedIds).toEqual(['c-gaming', 'c-vgf'].sort());
  });

  it('skips GK row when score below threshold (locked decision 4)', async () => {
    const supabase = makeFakeSupabase();
    const claude = makeFakeClaude({
      gaming: 25,
      video_game_franchises: 55,
      general_knowledge: 3, // below GK_THRESHOLD
    });

    await calibrateQuestionWithChain(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      {
        id: 'q-1',
        question_text: 'Test',
        correct_answer: 'A',
        distractors: ['B', 'C', 'D'],
        assigned_slugs: ['video-game-franchises'],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      claude as any,
      { claudeModelVerification: 'sonnet' },
    );

    const inserted = upsertCalls.flatMap((c) => c.rows as Array<{ category_id: string }>);
    expect(inserted.map((r) => r.category_id)).not.toContain('c-gk');
  });

  it('inserts GK row when score >= GK_THRESHOLD', async () => {
    const supabase = makeFakeSupabase();
    const claude = makeFakeClaude({
      gaming: 25,
      video_game_franchises: 55,
      general_knowledge: 50, // above threshold
    });

    await calibrateQuestionWithChain(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      {
        id: 'q-1',
        question_text: 'Test',
        correct_answer: 'A',
        distractors: ['B', 'C', 'D'],
        assigned_slugs: ['video-game-franchises'],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      claude as any,
      { claudeModelVerification: 'sonnet' },
    );

    const inserted = upsertCalls.flatMap((c) => c.rows as Array<{ category_id: string }>);
    expect(inserted.map((r) => r.category_id)).toContain('c-gk');
  });

  it('GK_THRESHOLD is exposed and reasonable (10-30 range)', () => {
    expect(typeof GK_THRESHOLD).toBe('number');
    expect(GK_THRESHOLD).toBeGreaterThanOrEqual(10);
    expect(GK_THRESHOLD).toBeLessThanOrEqual(30);
  });

  it('returns success=false on Claude error', async () => {
    const supabase = makeFakeSupabase();
    const claude = vi.fn().mockRejectedValue(new Error('rate limit'));

    const out = await calibrateQuestionWithChain(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      {
        id: 'q-1',
        question_text: 'Test',
        correct_answer: 'A',
        distractors: ['B', 'C', 'D'],
        assigned_slugs: ['video-game-franchises'],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      claude as any,
      { claudeModelVerification: 'sonnet' },
    );

    expect(out.success).toBe(false);
    expect(out.error).toContain('rate limit');
    expect(upsertCalls.length).toBe(0);
  });

  it('rethrows UsageStopError instead of reporting success=false', async () => {
    const supabase = makeFakeSupabase();
    const claude = vi.fn().mockRejectedValue(new UsageStopError('budget'));

    await expect(
      calibrateQuestionWithChain(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase as any,
        {
          id: 'q-1',
          question_text: 'Test',
          correct_answer: 'A',
          distractors: ['B', 'C', 'D'],
          assigned_slugs: ['video-game-franchises'],
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        claude as any,
        { claudeModelVerification: 'sonnet' },
      ),
    ).rejects.toBeInstanceOf(UsageStopError);
    expect(upsertCalls.length).toBe(0);
  });
});
