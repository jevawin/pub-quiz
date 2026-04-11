import { describe, it, expect } from 'vitest';
import { uiToDbDifficulty, dbToUiDifficulty, type UiDifficulty } from './difficulty';

describe('difficulty translator', () => {
  it('converts UI labels to DB values', () => {
    expect(uiToDbDifficulty('Easy')).toBe('easy');
    expect(uiToDbDifficulty('Medium')).toBe('normal');
    expect(uiToDbDifficulty('Hard')).toBe('hard');
  });

  it('converts DB values to UI labels', () => {
    expect(dbToUiDifficulty('easy')).toBe('Easy');
    expect(dbToUiDifficulty('normal')).toBe('Medium');
    expect(dbToUiDifficulty('hard')).toBe('Hard');
  });

  it('throws on unknown UI difficulty', () => {
    expect(() => uiToDbDifficulty('bogus' as UiDifficulty)).toThrow(
      'Unknown UI difficulty: bogus',
    );
  });
});
