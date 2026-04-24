---
phase: quick-260424-uju
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: []
autonomous: true
requirements: [UJU-01]
must_haves:
  truths:
    - "All 11 flagged questions have been corrected in the questions table"
    - "All 11 question_feedback rows have resolved_at set and resolved_note explaining the change"
    - "No feedback rows with resolved_at IS NULL remain for these questions"
  artifacts:
    - path: "(DB) questions table"
      provides: "Corrected question_text, correct_answer, and/or distractors for 11 rows"
    - path: "(DB) question_feedback table"
      provides: "resolved_at + resolved_note set on all 11 rows"
  key_links:
    - from: "question_feedback.question_id"
      to: "questions.id"
      via: "JOIN on question_id"
      pattern: "resolved_at IS NULL"
---

<objective>
Fix 11 questions flagged via user feedback. Edits are DB-only UPDATEs — no migration files, no app code changes.

Purpose: Keep the live question library accurate and free of grammar/fact errors.
Output: 11 corrected question rows, 11 feedback rows marked resolved.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Look up IDs for all 11 flagged questions</name>
  <files>(DB read — no files modified)</files>
  <action>
Run this query via `supabase db query --linked` to fetch all unresolved feedback rows plus their question content:

```sql
SELECT
  q.id            AS question_id,
  q.question_text,
  q.correct_answer,
  q.distractors,
  qf.id           AS feedback_id,
  qf.feedback_text
FROM question_feedback qf
JOIN questions q ON q.id = qf.question_id
WHERE qf.resolved_at IS NULL
ORDER BY qf.created_at;
```

Record the `question_id` and `feedback_id` UUID for each of the 11 rows. You need them for Task 2.

Also run this targeted check for issue 10 (Cheers) to confirm distractors exist and correct_answer is right:

```sql
SELECT id, question_text, correct_answer, distractors
FROM questions
WHERE question_text ILIKE '%everybody knows your name%';
```
  </action>
  <verify>Query returns at least 11 rows with non-null question_id and feedback_id values.</verify>
  <done>UUIDs recorded for all 11 flagged questions and their feedback rows.</done>
</task>

<task type="auto">
  <name>Task 2: Apply all 11 fixes and mark feedback resolved</name>
  <files>(DB writes — no files modified)</files>
  <action>
Execute the following UPDATEs in order via `supabase db query --linked`. Replace each `{question_id_N}` and `{feedback_id_N}` with the UUIDs from Task 1.

**Issue 1 — Sorcerer's → Philosopher's Stone**
```sql
UPDATE questions
SET question_text = REPLACE(question_text, 'Sorcerer''s Stone', 'Philosopher''s Stone')
WHERE id = '{question_id_1}';

UPDATE question_feedback
SET resolved_at = now(), resolved_note = 'Changed "Sorcerer''s Stone" to "Philosopher''s Stone" (UK title)'
WHERE id = '{feedback_id_1}';
```

**Issue 2 — Waluigi near-duplicate: reject the question**
```sql
UPDATE questions
SET status = 'rejected'
WHERE id = '{question_id_2}';

UPDATE question_feedback
SET resolved_at = now(), resolved_note = 'Question rejected: near-duplicate concern flagged by user'
WHERE id = '{feedback_id_2}';
```

**Issue 3 — "objects" → "particles" (mole)**
```sql
UPDATE questions
SET question_text = REPLACE(question_text, 'objects', 'particles')
WHERE id = '{question_id_3}';

UPDATE question_feedback
SET resolved_at = now(), resolved_note = 'Changed "objects" to "particles" — scientifically correct terminology for Avogadro''s number'
WHERE id = '{feedback_id_3}';
```

**Issue 4 — grammar fix "had" → "have" (John Tanner)**
```sql
UPDATE questions
SET question_text = REPLACE(question_text, ' had before turning into an undercover cop', ' have before turning into an undercover cop')
WHERE id = '{question_id_4}';

UPDATE question_feedback
SET resolved_at = now(), resolved_note = 'Fixed grammar: "had" → "have" in question text'
WHERE id = '{feedback_id_4}';
```

**Issue 5 — trailing space before ? (Reddit)**
```sql
UPDATE questions
SET question_text = REGEXP_REPLACE(question_text, '\s+\?', '?')
WHERE id = '{question_id_5}';

UPDATE question_feedback
SET resolved_at = now(), resolved_note = 'Removed trailing space before question mark'
WHERE id = '{feedback_id_5}';
```

**Issue 6 — Apollo 10 speed record: verify fact before updating**

First run a SELECT to read the current correct_answer:
```sql
SELECT id, question_text, correct_answer, distractors FROM questions WHERE id = '{question_id_6}';
```

Apollo 10 reached ~39,895 km/h (24,791 mph) on return from the Moon in May 1969. This remains the verified human spaceflight speed record as of 2026. No correction needed to fact. Update feedback only:
```sql
UPDATE question_feedback
SET resolved_at = now(), resolved_note = 'Fact verified: Apollo 10 speed record (~39,895 km/h) is accurate as of 2026. No question change needed.'
WHERE id = '{feedback_id_6}';
```

**Issue 7 — "Czech Republic" → "Czechia"**
```sql
UPDATE questions
SET correct_answer = 'Czechia',
    distractors = (
      SELECT jsonb_agg(
        CASE WHEN elem::text = '"Czech Republic"' THEN '"Czechia"'::jsonb ELSE elem END
      )
      FROM jsonb_array_elements(distractors) elem
    )
WHERE id = '{question_id_7}';

UPDATE question_feedback
SET resolved_at = now(), resolved_note = 'Updated "Czech Republic" to "Czechia" in correct_answer (and distractors if present)'
WHERE id = '{feedback_id_7}';
```

Note: The distractors UPDATE only changes entries that literally say "Czech Republic". If correct_answer was already "Czechia" or if "Czech Republic" didn't appear in distractors, the CASE is a no-op.

**Issue 8 — Beatles/Abbey Road: remove telegraph**
```sql
UPDATE questions
SET question_text = 'On which Beatles album cover do the band walk across a road?'
WHERE id = '{question_id_8}';

UPDATE question_feedback
SET resolved_at = now(), resolved_note = 'Reworded to remove "zebra crossing" which telegraphed the album cover — now uses generic "walk across a road"'
WHERE id = '{feedback_id_8}';
```

**Issue 9 — "Bowie" → "David Bowie" (Labyrinth)**
```sql
UPDATE questions
SET question_text = REPLACE(question_text, 'Bowie play', 'David Bowie play')
WHERE id = '{question_id_9}';

UPDATE question_feedback
SET resolved_at = now(), resolved_note = 'Prepended "David" to "Bowie" — full name used for clarity'
WHERE id = '{feedback_id_9}';
```

**Issue 10 — Cheers bar: verify answer and distractors**

Use the SELECT result from Task 1 to confirm correct_answer = 'Cheers' and distractors has 3 non-null entries. If correct_answer is 'Cheers' and distractors are populated, no data fix needed — mark resolved:
```sql
UPDATE question_feedback
SET resolved_at = now(), resolved_note = 'Verified: correct_answer is "Cheers" and 3 distractors present. No fix needed.'
WHERE id = '{feedback_id_10}';
```

If correct_answer is wrong or distractors are empty, fix accordingly before resolving.

**Issue 11 — Bowerbird "telegraphing" check**

Run a SELECT to read the current question_text and correct_answer:
```sql
SELECT id, question_text, correct_answer FROM questions WHERE id = '{question_id_11}';
```

"Elaborate decorated structures" describes bowerbird behaviour without naming it — this is acceptable question writing. The answer (bowerbird) is not in the question text. No change needed:
```sql
UPDATE question_feedback
SET resolved_at = now(), resolved_note = 'Reviewed: "elaborate decorated structures" describes behaviour without telegraphing the name "bowerbird". No change needed.'
WHERE id = '{feedback_id_11}';
```

After all updates, run a final verification query:
```sql
SELECT qf.id, qf.resolved_at, qf.resolved_note, q.question_text, q.status
FROM question_feedback qf
JOIN questions q ON q.id = qf.question_id
WHERE qf.resolved_at IS NOT NULL
  AND qf.resolved_at > now() - interval '10 minutes'
ORDER BY qf.resolved_at;
```

This should return 11 rows, all with resolved_at and resolved_note populated.
  </action>
  <verify>
Final SELECT returns 11 rows with resolved_at IS NOT NULL. Zero unresolved feedback rows remain for these questions.
  </verify>
  <done>
All 11 questions corrected (or confirmed accurate) and all 11 feedback rows marked resolved with descriptive notes. The Waluigi question has status='rejected'.
  </done>
</task>

</tasks>

<verification>
```sql
-- Confirm zero unresolved feedback remains for any of the 11 affected questions
SELECT COUNT(*)
FROM question_feedback qf
JOIN questions q ON q.id = qf.question_id
WHERE qf.resolved_at IS NULL
  AND q.question_text ILIKE ANY (ARRAY[
    '%Philosopher%Stone%', '%Sorcerer%Stone%',
    '%Waluigi%', '%mole%', '%John Tanner%',
    '%reddit%founded%', '%Apollo%speed%',
    '%beer%per capita%', '%Beatles%crossing%',
    '%Bowie%Goblin%', '%everybody knows your name%',
    '%Australian bird%builds%'
  ]);
-- Expect: 0
```
</verification>

<success_criteria>
- All 11 question_feedback rows have resolved_at set within this session
- All 11 resolved_note values describe what changed (or why no change was needed)
- Factual corrections applied: Philosopher's Stone, "particles", "Czechia", "David Bowie", Abbey Road rewording, Reddit spacing, John Tanner grammar
- Waluigi question status = 'rejected'
- Apollo 10 and bowerbird questions confirmed accurate, no text change needed
- Cheers question verified: correct_answer = 'Cheers', 3 distractors present
</success_criteria>

<output>
After completion, create `.planning/quick/260424-uju-fix-11-flagged-feedback-questions-and-ma/260424-uju-SUMMARY.md`
</output>
