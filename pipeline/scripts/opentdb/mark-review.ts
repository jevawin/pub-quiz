// Mark staging rows as approved/rejected in bulk.
// - approved: keep + category_id set + no dup + no cat-mismatch flag + not US-centric
// - rejected: skip
// Everything else stays pending (uncertains + flagged keeps for later curation).

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const US_RX = /\b(American|U\.S\.|USA|NFL|NBA|MLB|NHL|Brooklyn|Wisconsin|Dodgers|Hollywood|Super Bowl|Madison|Mayan)\b/i;
const MM_RX = /closest|no perfect|no exact|no .* category|loose fit|no automotive|no math|no general|closest fit|closest match|closest available|no dedicated|no specific/i;

async function fetchAll() {
  const out: { id: string; claude_verdict: string; category_id: string | null; claude_reason: string | null; dup_of_question_id: string | null; question_text: string }[] = [];
  let from = 0;
  const pg = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('questions_staging')
      .select('id,claude_verdict,category_id,claude_reason,dup_of_question_id,question_text')
      .eq('source', 'opentdb')
      .eq('review_status', 'pending')
      .range(from, from + pg - 1);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data);
    if (data.length < pg) break;
    from += pg;
  }
  return out;
}

async function updateMany(ids: string[], status: 'approved' | 'rejected') {
  const chunk = 500;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const { error } = await supabase
      .from('questions_staging')
      .update({ review_status: status, reviewed_at: new Date().toISOString() })
      .in('id', slice);
    if (error) throw error;
  }
}

async function main() {
  const rows = await fetchAll();
  const approve: string[] = [];
  const reject: string[] = [];

  for (const r of rows) {
    if (r.claude_verdict === 'skip') { reject.push(r.id); continue; }
    if (r.claude_verdict !== 'keep') continue; // uncertain stays pending
    if (!r.category_id) continue; // hold
    if (r.dup_of_question_id) continue; // hold
    if (r.claude_reason && MM_RX.test(r.claude_reason)) continue; // hold mismatch
    if (US_RX.test(r.question_text)) continue; // hold US-centric
    approve.push(r.id);
  }

  console.log(`approve: ${approve.length}, reject: ${reject.length}, hold: ${rows.length - approve.length - reject.length}`);
  await updateMany(approve, 'approved');
  await updateMany(reject, 'rejected');
  console.log('done');
}

main().catch((e) => { console.error(e); process.exit(1); });
