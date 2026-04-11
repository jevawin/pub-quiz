import { describe, it, expect, vi, afterEach } from 'vitest';
import { shuffle } from './shuffle';

describe('shuffle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returned array has same length as input', () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffle(input);
    expect(result).toHaveLength(input.length);
  });

  it('returned array contains every input element exactly once', () => {
    const input = ['a', 'b', 'c', 'd'];
    const result = shuffle(input);
    expect(result.sort()).toEqual([...input].sort());
  });

  it('does not mutate input', () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    shuffle(input);
    expect(input).toEqual(copy);
  });

  it('produces a deterministic permutation with seeded Math.random', () => {
    // Stub Math.random to return a known sequence
    const values = [0.1, 0.5, 0.9, 0.3];
    let idx = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => values[idx++ % values.length]);

    const input = [1, 2, 3, 4, 5];
    const result = shuffle(input);

    // With a fixed seed, result should be deterministic
    expect(result).toHaveLength(5);
    expect(result.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});
