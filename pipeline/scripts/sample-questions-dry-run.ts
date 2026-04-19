/**
 * Dry-run sampler for Questions Agent. Calls Anthropic directly with the
 * committed SYSTEM_PROMPT against a fixed seed category. Does NOT write to
 * Supabase. Prints JSON to stdout.
 *
 * Usage:
 *   cd pipeline && npx tsx scripts/sample-questions-dry-run.ts "Video Game Franchises" 20
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from '../src/agents/questions.js';

const categoryName = process.argv[2] ?? 'Video Game Franchises';
const count = Number(process.argv[3] ?? '20');

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY missing');
  process.exit(1);
}

const claude = new Anthropic({ apiKey });

const userPrompt = `Category: ${categoryName}

Generate ${count} pub quiz questions about ${categoryName}. Use your own knowledge — write questions that are factually correct and would work in a real pub quiz.

Return as JSON with a "questions" array where each object has exactly these fields:
- "question_text": string (the question)
- "correct_answer": string
- "distractors": array of exactly 3 strings (wrong answers)
- "explanation": string (2-3 sentences)
- "difficulty": "easy" | "normal" | "hard"`;

async function main() {
  const response = await claude.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content.find((c) => c.type === 'text');
  if (!text || text.type !== 'text') {
    console.error('No text response');
    process.exit(1);
  }

  // Extract JSON (first { to last })
  const s = text.text;
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  const jsonStr = s.slice(start, end + 1);
  const parsed = JSON.parse(jsonStr);

  console.log(JSON.stringify({
    category: categoryName,
    usage: response.usage,
    questions: parsed.questions,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
