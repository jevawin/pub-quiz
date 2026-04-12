export type UiDifficulty = 'Mixed' | 'Easy' | 'Medium' | 'Hard';
export type DbDifficulty = 'easy' | 'normal' | 'hard';

const UI_TO_DB: Record<Exclude<UiDifficulty, 'Mixed'>, DbDifficulty> = {
  Easy: 'easy',
  Medium: 'normal',
  Hard: 'hard',
};

const DB_TO_UI: Record<DbDifficulty, UiDifficulty> = {
  easy: 'Easy',
  normal: 'Medium',
  hard: 'Hard',
};

export function uiToDbDifficulty(ui: UiDifficulty): DbDifficulty {
  if (ui === 'Mixed') throw new Error('Mixed difficulty has no single DB mapping — use uiToDbDifficulties instead');
  const v = UI_TO_DB[ui];
  if (!v) throw new Error(`Unknown UI difficulty: ${ui}`);
  return v;
}

/** Return all DB difficulties for a UI selection. Mixed → all three. */
export function uiToDbDifficulties(ui: UiDifficulty): DbDifficulty[] {
  if (ui === 'Mixed') return ['easy', 'normal', 'hard'];
  return [uiToDbDifficulty(ui)];
}

export function dbToUiDifficulty(db: DbDifficulty): UiDifficulty {
  const v = DB_TO_UI[db];
  if (!v) throw new Error(`Unknown DB difficulty: ${db}`);
  return v;
}

export const UI_DIFFICULTIES: readonly UiDifficulty[] = ['Mixed', 'Easy', 'Medium', 'Hard'];
