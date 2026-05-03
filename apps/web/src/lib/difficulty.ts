// Phase 999.8 Plan 05: difficulty is no longer a string enum stored on questions.
// Questions live in the question_categories join table with per-category numeric
// scores (0..100, lower = harder). UI difficulty buckets translate to score
// ranges that the new RPCs accept. Mirrors pipeline/src/lib/config.ts
// DIFFICULTY_BANDS — keep in sync if extracted to a shared package later.

export type UiDifficulty = 'Mixed' | 'Easy' | 'Medium' | 'Hard';

export interface ScoreRange {
  min: number;
  max: number;
}

const BANDS: Record<Exclude<UiDifficulty, 'Mixed'>, ScoreRange> = {
  Easy:   { min: 67, max: 100 },
  Medium: { min: 34, max: 66 },
  Hard:   { min: 0,  max: 33 },
};

/** Convert a UI difficulty selection to the score range to send to RPCs. */
export function uiToScoreRange(ui: UiDifficulty): ScoreRange {
  if (ui === 'Mixed') return { min: 0, max: 100 };
  return BANDS[ui];
}

export const UI_DIFFICULTIES: readonly UiDifficulty[] = ['Mixed', 'Easy', 'Medium', 'Hard'];
