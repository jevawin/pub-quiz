import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Paginate done-ids (Supabase default 1000 cap)
const done = new Set();
const { count: total } = await sb.from('question_categories').select('*', { count: 'exact', head: true });
for (let from = 0; from < (total ?? 0); from += 1000) {
  const { data } = await sb.from('question_categories').select('question_id').range(from, from + 999);
  for (const r of data) done.add(r.question_id);
}

// Fetch published, filter undone, take 50
const { data: qs } = await sb.from('questions')
  .select('id, question_text, correct_answer, distractors, category_id')
  .eq('status', 'published')
  .limit(done.size + 200);
const todo = qs.filter(q => !done.has(q.id)).slice(0, 50);

const catIds = [...new Set(todo.map(q => q.category_id))];
const { data: cats } = await sb.from('categories').select('id, slug').in('id', catIds);
const slugMap = Object.fromEntries(cats.map(c => [c.id, c.slug]));

console.log(JSON.stringify(
  todo.map(q => ({ id: q.id, q: q.question_text, a: q.correct_answer, d: q.distractors, slug: slugMap[q.category_id] })),
  null, 1
));
