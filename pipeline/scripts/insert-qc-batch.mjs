import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) { console.error('usage: insert-qc-batch.mjs <scores.json>'); process.exit(1); }

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const scored = JSON.parse(readFileSync(path, 'utf8'));

const slugs = [...new Set(scored.flatMap(q => q.rows.map(r => r.slug)))];
const { data: cats, error: catErr } = await sb.from('categories').select('id, slug').in('slug', slugs);
if (catErr) { console.error(catErr); process.exit(1); }
const slugToId = Object.fromEntries(cats.map(c => [c.slug, c.id]));

const missing = slugs.filter(s => !slugToId[s]);
if (missing.length) { console.error('missing slugs:', missing); process.exit(1); }

const rows = scored.flatMap(q => q.rows.map(r => ({
  question_id: q.id,
  category_id: slugToId[r.slug],
  estimate_score: r.estimate_score,
})));

const { error } = await sb.from('question_categories').insert(rows);
if (error) { console.error(error); process.exit(1); }
console.log('inserted', rows.length, 'rows for', scored.length, 'questions');
