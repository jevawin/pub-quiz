---
phase: quick-260426-pxh
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/src/lib/questions.ts
  - apps/web/src/lib/questions.test.ts
autonomous: true
requirements:
  - DUP-01
  - DUP-02
must_haves:
  truths:
    - "A 20-question quiz never serves the same question_id twice"
    - "Two questions from the same root category are not adjacent when alternatives exist"
    - "When the unseen pool is too small to fill the quiz, the user is informed (not silently served stale repeats)"
  artifacts:
    - path: apps/web/src/lib/questions.ts
      provides: "fetchRandomQuestions returns deduped, category-interleaved questions"
    - path: apps/web/src/lib/questions.test.ts
      provides: "Unit tests for dedupe and interleave logic"
  key_links:
    - from: fetchRandomQuestions
      to: dedupeAndPickFreshest
      via: "Set<string> on row.id guarantees no duplicate IDs in returned batch"
    - from: fetchRandomQuestions
      to: interleaveByCategory
      via: "Post-pick reorder so same category_slug rarely lands back-to-back"
---

<objective>
Fix the within-session repeat-question bug surfaced by session feedback (f65afa50, ef374940). Trace the question-loading flow, harden the dedupe so a single quiz cannot contain repeated question_ids under any path (including the short-pool fallback), and add light topic-adjacency mitigation so two same-category questions don't land back-to-back when alternatives exist.

Purpose: The user reported "half the questions were repeats" and "two Van Gogh questions in a row." Existing code dedupes within a batch via a Set, but the short-pool fallback at line 162 silently refetches without seen-exclusion, which is the most plausible source of the perceived repeats. There is no category-adjacency logic at all today.

Output: A patched `fetchRandomQuestions` that (a) guarantees ID uniqueness in the returned array via a single authoritative Set check at the end, (b) interleaves results by category_slug to break adjacency, and (c) returns a shorter quiz rather than serving stale repeats when the pool runs dry.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@apps/web/src/lib/questions.ts
@apps/web/src/lib/seen-store.ts
@apps/web/src/screens/Setup.tsx
@apps/web/src/state/quiz.ts

Key observations from tracing the flow:

1. Questions are fetched **once, upfront** via `fetchRandomQuestions` in `Setup.onPlay`, then handed to Play via router state. There is no lazy per-question fetch — within-session dedup is therefore implicit in the single batch.

2. The single batch is already deduped: `dedupeAndPickFreshest` uses a `Set<string>` keyed on `row.id` across all sub-batches before slicing to `n`. So the easiest source of within-session repeats is **not** the happy path.

3. **The actual culprit is the fallback at lines 162–169**: when `limited.length < n` after server-side seen-exclusion, the code silently refetches *without* `excludeIds`. This pulls cross-session seen questions back into the pool. The user perceives these as "repeats" because they answered them in a previous session — even though within the *current* session each ID still appears once. The Setup pool warning exists but is easy to miss.

4. **Topic adjacency** (Van Gogh-style): `dedupeAndPickFreshest` sorts by view-count then shuffles within each tier. Same-category questions can cluster. Cheap fix: after final pick, run a greedy interleave that pulls the next-best item whose category_slug differs from the previous emitted item.

5. The migration 00024 RPC `random_published_questions_excluding` already accepts `p_exclude_ids UUID[]` — server side is fine, no DB work needed.

<interfaces>
From apps/web/src/state/quiz.ts:
```typescript
export type LoadedQuestion = {
  id: string;
  question_text: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
  fun_fact: string | null;
  category_slug: string;
};
```

From apps/web/src/lib/seen-store.ts:
```typescript
export function recordView(questionId: string): void;
export function getSeenIds(): string[];
export function getViewCounts(ids: string[]): Record<string, number>;
```

From apps/web/src/lib/questions.ts (current export):
```typescript
export async function fetchRandomQuestions(
  uiDifficulty: UiDifficulty,
  categorySlugs: string[],
  n: number,
): Promise<LoadedQuestion[]>;
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Harden dedupe and drop the silent stale-repeat fallback</name>
  <files>apps/web/src/lib/questions.ts, apps/web/src/lib/questions.test.ts</files>
  <behavior>
    - Test 1: Given two RPC sub-batches that share an ID, dedupeAndPickFreshest returns each ID at most once.
    - Test 2: Given over-fetched rows that include a duplicate, the final returned array from fetchRandomQuestions has no duplicate `id` values (assert via `new Set(rows.map(r => r.id)).size === rows.length`).
    - Test 3: When the unseen pool yields fewer than `n` rows, fetchRandomQuestions returns the short array (length < n) rather than refetching without excludeIds. No call is made with `p_exclude_ids: []` after a successful seen-excluded call.
  </behavior>
  <action>
    Edit `apps/web/src/lib/questions.ts`:

    1. Add a final authoritative dedupe step at the end of `fetchRandomQuestions`, just before mapping to LoadedQuestion. Use `new Set<string>()` on `row.id`. This is belt-and-braces — `dedupeAndPickFreshest` already does it, but a second pass after any future code paths is cheap insurance and makes the within-session guarantee explicit.

    2. **Remove the stale-repeat fallback** at current lines 162–169 (the `if (limited.length < n && excludeIds.length > 0)` block that refetches with `excludeIds: []`). Setup already shows a pool-size warning before the user clicks Play (`poolWarning` in Setup.tsx). Returning a shorter quiz is honest; serving cross-session repeats while pretending they're fresh is what the user complained about. The `actualCount` machinery in Setup.onPlay already handles short returns ("Use the actual number of questions returned as the authoritative count").

    3. Keep the existing single retry behaviour ONLY if `excludeIds.length === 0` already (i.e. fresh user, server just returned too few — no harm). In practice this means: if `limited.length === 0`, throw the existing "No questions found" error; otherwise return what we have.

    4. Create `apps/web/src/lib/questions.test.ts` with the three behaviours above. Mock `supabase.rpc` to control RPC return rows. Mock `getSeenIds` and `getViewCounts` from `./seen-store`. Use the existing test runner (vitest, per repo convention — check `apps/web/package.json` if unsure).

    Reason for change: The fallback was a well-intentioned safety net ("repeats preferred to a short quiz") but the user's feedback explicitly says repeats are the worse outcome. Per the task brief "feedback ef374940 suggests repeats happen anyway" — this is the path that produces them.
  </action>
  <verify>
    <automated>cd apps/web && pnpm test --run src/lib/questions.test.ts</automated>
  </verify>
  <done>
    Tests pass. `fetchRandomQuestions` no longer calls the RPC with empty `p_exclude_ids` as a fallback. Returned array has no duplicate IDs.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Interleave by category_slug to break topic adjacency</name>
  <files>apps/web/src/lib/questions.ts, apps/web/src/lib/questions.test.ts</files>
  <behavior>
    - Test 1: Given an input array `[A1, A2, B1, C1, A3]` (where letter is category_slug), the interleaved output never has two same-letter items adjacent when an alternative exists. Acceptable output: `[A1, B1, A2, C1, A3]`.
    - Test 2: When ALL items share the same category (e.g. user picked one category), interleave is a no-op and order is preserved.
    - Test 3: Length and set of IDs is preserved (no drops, no dupes introduced).
  </behavior>
  <action>
    Add a pure helper `interleaveByCategory(rows: RpcRow[]): RpcRow[]` to `apps/web/src/lib/questions.ts`.

    Algorithm (greedy, O(n²) which is fine for n ≤ 20):
    ```
    const out: RpcRow[] = [];
    const remaining = [...rows];
    let lastSlug: string | null = null;
    while (remaining.length > 0) {
      // Prefer the first item whose category_slug !== lastSlug.
      let pickIdx = remaining.findIndex(r => r.category_slug !== lastSlug);
      // If none differ (all remaining share lastSlug), just take the first.
      if (pickIdx === -1) pickIdx = 0;
      const [picked] = remaining.splice(pickIdx, 1);
      out.push(picked!);
      lastSlug = picked!.category_slug;
    }
    return out;
    ```

    Wire it into `fetchRandomQuestions` AFTER `dedupeAndPickFreshest` slices to `n`, but BEFORE the final dedupe-and-map step from Task 1. Order: dedupe → pick freshest → slice n → interleave → final-dedupe sanity → map.

    This addresses feedback f65afa50 ("two Van Gogh questions one after the other"). It is a best-effort mitigation: if the user picks one category, interleave does nothing — which is correct, the user asked for that. The task brief flagged this as in-scope only if cheap; this is cheap.

    Add the three test cases above to `questions.test.ts`. Test 1 should use mixed slugs; Test 2 should use a single slug; Test 3 should assert `new Set(out.map(r => r.id)).size === input.length`.
  </action>
  <verify>
    <automated>cd apps/web && pnpm test --run src/lib/questions.test.ts</automated>
  </verify>
  <done>
    Tests pass. A 20-question Mixed-difficulty all-categories quiz visibly alternates categories rather than clustering.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    - Within-session dedup hardened: a final Set-based pass guarantees no duplicate question_ids in any returned quiz batch.
    - Stale-repeat fallback removed: when the unseen pool is too small, the quiz is shorter rather than silently serving cross-session repeats. The Setup pool-size warning already prepares the user for this.
    - Category interleave: same-category questions are no longer adjacent when alternatives exist.
  </what-built>
  <how-to-verify>
    1. Run the web app: `cd apps/web && pnpm dev`.
    2. Open the app, clear seen memory if present (Setup screen footer link), select All categories, Mixed difficulty, 20 questions, click Play.
    3. Play through all 20 questions. Note category labels at each step.
    4. Confirm: no question_text repeats; same category does not appear in back-to-back questions (some clustering is acceptable if the random pool is heavily skewed, but the obvious "two Van Goghs in a row" case should not occur).
    5. Optional pool-warning check: select a niche single category with a small pool (check Setup pill counts), set count to 20. Confirm Setup shows a pool warning. Click Play. Confirm the quiz starts with the actual available count (e.g. 8 questions) shown as "Question 1 of 8" — not silently padded to 20 with repeats.
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
- `pnpm test --run src/lib/questions.test.ts` passes (all 6 tests from Tasks 1–2).
- TypeScript compiles: `cd apps/web && pnpm tsc --noEmit`.
- Manual play-through of a 20-question Mixed quiz: no repeated question_ids, no two same-category questions adjacent.
</verification>

<success_criteria>
- A 20-question quiz never contains the same question_id twice (asserted by test + manual play).
- The fallback that silently refetched without seen-exclusion is gone; short pools yield short quizzes.
- Same-category questions do not land back-to-back when alternatives exist in the batch.
- No DB migrations, no schema changes — all work is in `apps/web/src/lib/questions.ts` plus its test file.
</success_criteria>

<output>
After completion, create `.planning/quick/260426-pxh-260427-dup-within-session-question-dedup/260426-pxh-SUMMARY.md` summarising the diagnosis (the fallback was the real culprit, not missing exclude-id plumbing), the two code changes, and any nuances (e.g. interleave is best-effort, single-category quizzes are unaffected by it).
</output>
