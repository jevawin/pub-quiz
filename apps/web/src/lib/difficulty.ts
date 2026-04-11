export type UiDifficulty = 'Easy' | 'Medium' | 'Hard';
export type DbDifficulty = 'easy' | 'normal' | 'hard';

const UI_TO_DB: Record<UiDifficulty, DbDifficulty> = {
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
  const v = UI_TO_DB[ui];
  if (!v) throw new Error(`Unknown UI difficulty: ${ui}`);
  return v;
}

export function dbToUiDifficulty(db: DbDifficulty): UiDifficulty {
  const v = DB_TO_UI[db];
  if (!v) throw new Error(`Unknown DB difficulty: ${db}`);
  return v;
}

export const UI_DIFFICULTIES: readonly UiDifficulty[] = ['Easy', 'Medium', 'Hard'];
