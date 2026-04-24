import { describe, it, expect } from 'vitest';
import { CalibratorScoreSchema } from '../../lib/schemas';

// Wave 0 — RED scaffolds.
// CalibratorScoreSchema does not exist yet — Wave 2 adds it.
// Expected failure mode: "has no exported member 'CalibratorScoreSchema'"

describe('CalibratorScoreSchema — multi-category scores', () => {
  it('parses calibrator scores object', () => {
    const input = {
      scores: { general_knowledge: 45, science_and_nature: 68 },
      reasoning: 'Science question — most adults recognise the symbol but would hesitate.',
    };
    expect(() => CalibratorScoreSchema.parse(input)).not.toThrow();
  });

  it('rejects score out of range', () => {
    const tooHigh = {
      scores: { general_knowledge: 120 },
      reasoning: 'Out of range high',
    };
    expect(() => CalibratorScoreSchema.parse(tooHigh)).toThrow();

    const tooLow = {
      scores: { general_knowledge: -5 },
      reasoning: 'Out of range low',
    };
    expect(() => CalibratorScoreSchema.parse(tooLow)).toThrow();
  });

  it('allows all zeros', () => {
    const input = {
      scores: { general_knowledge: 0 },
      reasoning: '',
    };
    expect(() => CalibratorScoreSchema.parse(input)).not.toThrow();
  });

  it('requires at least one score', () => {
    const input = {
      scores: {},
      reasoning: 'No scores provided',
    };
    expect(() => CalibratorScoreSchema.parse(input)).toThrow();
  });
});
