import { describe, it, expect } from 'vitest';
import { QuestionGeneratedSchema } from '../../lib/schemas';
import { validateHasGeneralKnowledge } from '../../lib/general-knowledge-guard';

// Wave 0 — RED scaffolds.
// These tests reference contracts that Wave 2 will implement.
// Expected failure mode: "Cannot find module" or "has no exported member"
// for the new fields on QuestionGeneratedSchema and for the guard module.

describe('QuestionGeneratedSchema — multi-category extensions', () => {
  it('accepts valid multi-category output', () => {
    const input = {
      question_text: 'What is the chemical symbol for gold?',
      correct_answer: 'Au',
      distractors: ['Ag', 'Fe', 'Cu'],
      explanation: 'Gold has the symbol Au from the Latin "aurum". It is a precious metal.',
      category_slugs: ['science-and-nature'],
      category_scores: { general_knowledge: 22, science_and_nature: 68 },
    };
    expect(() => QuestionGeneratedSchema.parse(input)).not.toThrow();
  });

  it('rejects empty category_slugs', () => {
    const input = {
      question_text: 'What is the chemical symbol for gold?',
      correct_answer: 'Au',
      distractors: ['Ag', 'Fe', 'Cu'],
      explanation: 'Gold has the symbol Au from the Latin "aurum".',
      category_slugs: [],
      category_scores: { general_knowledge: 22, science_and_nature: 68 },
    };
    expect(() => QuestionGeneratedSchema.parse(input)).toThrow();
  });

  it('rejects more than 3 non-GK slugs', () => {
    const input = {
      question_text: 'What is the chemical symbol for gold?',
      correct_answer: 'Au',
      distractors: ['Ag', 'Fe', 'Cu'],
      explanation: 'Gold has the symbol Au from the Latin "aurum".',
      category_slugs: ['science-and-nature', 'history', 'geography', 'music'],
      category_scores: { general_knowledge: 22, science_and_nature: 68 },
    };
    expect(() => QuestionGeneratedSchema.parse(input)).toThrow();
  });

  it('rejects score > 100', () => {
    const input = {
      question_text: 'What is the chemical symbol for gold?',
      correct_answer: 'Au',
      distractors: ['Ag', 'Fe', 'Cu'],
      explanation: 'Gold has the symbol Au from the Latin "aurum".',
      category_slugs: ['science-and-nature'],
      category_scores: { general_knowledge: 101, science_and_nature: 68 },
    };
    expect(() => QuestionGeneratedSchema.parse(input)).toThrow();
  });

  it('rejects score < 0', () => {
    const input = {
      question_text: 'What is the chemical symbol for gold?',
      correct_answer: 'Au',
      distractors: ['Ag', 'Fe', 'Cu'],
      explanation: 'Gold has the symbol Au from the Latin "aurum".',
      category_slugs: ['science-and-nature'],
      category_scores: { general_knowledge: -1, science_and_nature: 68 },
    };
    expect(() => QuestionGeneratedSchema.parse(input)).toThrow();
  });

  it('requires general_knowledge score — guard returns false when key missing', () => {
    const scores = { science_and_nature: 68 };
    expect(validateHasGeneralKnowledge(scores)).toBe(false);
  });

  it('requires general_knowledge score — guard returns true when key present', () => {
    const scores = { general_knowledge: 22, science_and_nature: 68 };
    expect(validateHasGeneralKnowledge(scores)).toBe(true);
  });

  it('rejects general-knowledge appearing in category_slugs (D-13: injected by pipeline, not agent)', () => {
    const input = {
      question_text: 'What is the chemical symbol for gold?',
      correct_answer: 'Au',
      distractors: ['Ag', 'Fe', 'Cu'],
      explanation: 'Gold has the symbol Au from the Latin "aurum".',
      category_slugs: ['general-knowledge', 'science-and-nature'],
      category_scores: { general_knowledge: 22, science_and_nature: 68 },
    };
    expect(() => QuestionGeneratedSchema.parse(input)).toThrow();
  });
});
