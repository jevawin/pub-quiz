// Decode URL-encoded OpenTDB records; drop T/F, date-sensitive wording, and
// intra-batch duplicates. Input: /tmp/opentdb/all.json. Output: /tmp/opentdb/filtered.json.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

type Raw = {
  category: string;
  type: 'multiple' | 'boolean';
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  correct_answer: string;
  incorrect_answers: string[];
};

type Filtered = Raw & {
  external_id: string;          // stable hash of question_text
  _reason_skipped?: string;
};

const dec = (s: string) => decodeURIComponent(s);
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const hashId = (s: string) => createHash('sha256').update(normalize(s)).digest('hex').slice(0, 16);

const DATE_SENSITIVE = /\b(as of|currently|recently|latest|newest|in 20\d\d|this year|last year)\b/i;

function main() {
  const raw: Raw[] = JSON.parse(readFileSync('/tmp/opentdb/all.json', 'utf8'));
  console.log(`loaded ${raw.length}`);

  const decoded: Raw[] = raw.map((q) => ({
    ...q,
    category: dec(q.category),
    question: dec(q.question),
    correct_answer: dec(q.correct_answer),
    incorrect_answers: q.incorrect_answers.map(dec),
  }));

  const seen = new Set<string>();
  const kept: Filtered[] = [];
  const dropped = { tf: 0, date: 0, dup: 0 };

  for (const q of decoded) {
    if (q.type === 'boolean') { dropped.tf++; continue; }
    if (DATE_SENSITIVE.test(q.question)) { dropped.date++; continue; }
    const id = hashId(q.question);
    if (seen.has(id)) { dropped.dup++; continue; }
    seen.add(id);
    kept.push({ ...q, external_id: id });
  }

  console.log(`kept: ${kept.length}`);
  console.log(`dropped: tf=${dropped.tf} date=${dropped.date} in-batch-dup=${dropped.dup}`);

  writeFileSync('/tmp/opentdb/filtered.json', JSON.stringify(kept, null, 0));
  console.log('wrote /tmp/opentdb/filtered.json');
}

main();
