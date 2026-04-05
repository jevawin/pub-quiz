import { z } from 'zod';

// Category Agent output schemas
export const CategoryProposalSchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  parent_slug: z.string(),
});

export type CategoryProposal = z.infer<typeof CategoryProposalSchema>;

export const CategoryBatchSchema = z.object({
  categories: z.array(CategoryProposalSchema),
});

export type CategoryBatch = z.infer<typeof CategoryBatchSchema>;

// Questions Agent output schemas
export const QuestionGeneratedSchema = z.object({
  question_text: z.string(),
  correct_answer: z.string(),
  distractors: z.array(z.string()).length(3),
  explanation: z.string(),
  difficulty: z.enum(['easy', 'normal', 'hard']),
});

export type QuestionGenerated = z.infer<typeof QuestionGeneratedSchema>;

export const QuestionBatchSchema = z.object({
  questions: z.array(QuestionGeneratedSchema),
});

export type QuestionBatch = z.infer<typeof QuestionBatchSchema>;

// Fact-Check Agent output schemas
export const FactCheckResultSchema = z.object({
  question_id: z.string().uuid(),
  is_correct: z.boolean(),
  verification_score: z.number().int().min(0).max(3),
  reasoning: z.string(),
});

export type FactCheckResult = z.infer<typeof FactCheckResultSchema>;

export const FactCheckBatchSchema = z.object({
  results: z.array(FactCheckResultSchema),
});

export type FactCheckBatch = z.infer<typeof FactCheckBatchSchema>;

// QA Agent output schemas
export const QaResultSchema = z.object({
  question_id: z.string().uuid(),
  passed: z.boolean(),
  action: z.enum(['pass', 'rewrite', 'reject']),
  natural_language_score: z.number().min(0).max(10),
  category_fit_score: z.number().min(0).max(10),
  difficulty_calibration_score: z.number().min(0).max(10),
  distractor_quality_score: z.number().min(0).max(10),
  rewritten_question_text: z.string().optional(),
  rewritten_distractors: z.array(z.string()).length(3).optional(),
  rewritten_explanation: z.string().optional(),
  recalibrated_difficulty: z.enum(['easy', 'normal', 'hard']).optional(),
  reasoning: z.string(),
});

export type QaResult = z.infer<typeof QaResultSchema>;

export const QaBatchSchema = z.object({
  results: z.array(QaResultSchema),
});

export type QaBatch = z.infer<typeof QaBatchSchema>;
