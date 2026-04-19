// Promote approved rows from questions_staging into the live questions table.
// Inserts as status='published' with verification_score=2 (Claude-vetted, source-verified by OpenTDB).
// Sets questions_staging.review_status='imported' on success.

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data: approved, error } = await supabase
    .from('questions_staging')
    .select('id,category_id,question_text,correct_answer,distractors,difficulty,fun_fact')
    .eq('source', 'opentdb')
    .eq('review_status', 'approved')
    .limit(10000);
  if (error) throw error;
  if (!approved?.length) {
    console.log('no approved rows to promote');
    return;
  }
  console.log(`promoting ${approved.length} rows...`);

  const rows = approved.map((s) => ({
    category_id: s.category_id!,
    question_text: s.question_text,
    correct_answer: s.correct_answer,
    distractors: s.distractors,
    difficulty: s.difficulty!,
    fun_fact: s.fun_fact,
    verification_score: 2,
    status: 'published' as const,
    published_at: new Date().toISOString(),
  }));

  const chunkSize = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const stagingIds = approved.slice(i, i + chunkSize).map((s) => s.id);
    const { error: insErr } = await supabase.from('questions').insert(chunk);
    if (insErr) {
      console.error(`  insert chunk failed: ${insErr.message}`);
      continue;
    }
    const { error: markErr } = await supabase
      .from('questions_staging')
      .update({ review_status: 'imported' })
      .in('id', stagingIds);
    if (markErr) console.error(`  mark imported failed: ${markErr.message}`);
    inserted += chunk.length;
    console.log(`  ${inserted}/${rows.length}`);
  }

  console.log(`done. inserted ${inserted} rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
