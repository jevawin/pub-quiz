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
