import { describe, it, expect } from 'vitest';
import { uiToScoreRange, UI_DIFFICULTIES } from './difficulty';

describe('uiToScoreRange', () => {
  it('Mixed -> full range', () => {
    expect(uiToScoreRange('Mixed')).toEqual({ min: 0, max: 100 });
  });

  it('Easy -> 67..100', () => {
    expect(uiToScoreRange('Easy')).toEqual({ min: 67, max: 100 });
  });

  it('Medium -> 34..66', () => {
    expect(uiToScoreRange('Medium')).toEqual({ min: 34, max: 66 });
  });

  it('Hard -> 0..33', () => {
    expect(uiToScoreRange('Hard')).toEqual({ min: 0, max: 33 });
  });
});

describe('UI_DIFFICULTIES', () => {
  it('lists all four UI buckets in order', () => {
    expect(UI_DIFFICULTIES).toEqual(['Mixed', 'Easy', 'Medium', 'Hard']);
  });
});
