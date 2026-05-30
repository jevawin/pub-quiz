// Feedback-fix helper. Run from pipeline/ so dotenv loads pipeline/.env.
//   node scripts/fb-fix.mjs get <qid>
//   node scripts/fb-fix.mjs patch <qid> '<json of changed fields>'
//   node scripts/fb-fix.mjs resolve <qid> <created_at_iso> '<note>'
//   node scripts/fb-fix.mjs cats <qid>           (question_categories rows)
//   node scripts/fb-fix.mjs setscore <qid> <category_id> <estimate_score>
//   node scripts/fb-fix.mjs playrate <qid>       (observed correct-rate from question_plays)
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const [cmd, qid, a, b] = process.argv.slice(2);
const die = (e) => { console.error(e); process.exit(1); };

if (cmd === 'get') {
  const { data, error } = await sb.from('questions')
    .select('id, question_text, correct_answer, distractors, fun_fact, status')
    .eq('id', qid).single();
  if (error) die(error);
  console.log(JSON.stringify(data, null, 2));
} else if (cmd === 'patch') {
  const fields = JSON.parse(a);
  if (fields.distractors && fields.distractors.length !== 3) die('distractors must be exactly 3');
  const { error } = await sb.from('questions').update(fields).eq('id', qid);
  if (error) die(error);
  const { data } = await sb.from('questions')
    .select('id, question_text, correct_answer, distractors, fun_fact').eq('id', qid).single();
  console.log('PATCHED\n' + JSON.stringify(data, null, 2));
} else if (cmd === 'fb') {
  const { data, error } = await sb.from('question_feedback')
    .select('created_at, feedback_text, resolved_at').eq('question_id', qid).order('created_at');
  if (error) die(error);
  console.log(JSON.stringify(data, null, 2));
} else if (cmd === 'resolve') {
  const { data, error } = await sb.from('question_feedback')
    .update({ resolved_at: new Date().toISOString(), resolved_note: b })
    .eq('question_id', qid).eq('created_at', a).is('resolved_at', null).select();
  if (error) die(error);
  console.log('RESOLVED rows:', data.length, JSON.stringify(data.map(r => r.created_at)));
} else if (cmd === 'cats') {
  const { data, error } = await sb.from('question_categories')
    .select('question_id, category_id, estimate_score, categories(slug, name)').eq('question_id', qid);
  if (error) die(error);
  console.log(JSON.stringify(data, null, 2));
} else if (cmd === 'setscore') {
  const { error } = await sb.from('question_categories')
    .update({ estimate_score: Number(b) }).eq('question_id', qid).eq('category_id', a);
  if (error) die(error);
  console.log('SET estimate_score=' + b + ' for', qid, a);
} else if (cmd === 'playrate') {
  const { data, error } = await sb.from('question_plays').select('is_correct').eq('question_id', qid);
  if (error) die(error);
  const n = data.length;
  const c = data.filter(r => r.is_correct).length;
  console.log(JSON.stringify({ plays: n, correct: c, rate: n ? +(c / n).toFixed(3) : null }));
} else {
  die('unknown cmd: ' + cmd);
}
