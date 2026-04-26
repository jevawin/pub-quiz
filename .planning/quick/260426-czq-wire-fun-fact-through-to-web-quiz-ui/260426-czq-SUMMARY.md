---
phase: 260426-czq
plan: 01
subsystem: web-quiz
tags: [web, supabase, rpc, ui]
requires: []
provides: ["fun_fact rendered on web answer reveal"]
affects: ["random_published_questions_excluding RPC return signature"]
tech_stack:
  added: []
  patterns: ["Subdued italic 'Fun fact:' block under explanation on revealed + reviewing branches"]
key_files:
  created:
    - supabase/migrations/00024_rpc_return_fun_fact.sql
  modified:
    - apps/web/src/lib/questions.ts
    - apps/web/src/state/quiz.ts
    - apps/web/src/screens/Play.tsx
decisions:
  - "Mirrored 00015 verbatim with fun_fact appended (RETURNS TABLE + SELECT) — no other behaviour changed"
metrics:
  duration: ~5min
  completed: 2026-04-26
---

# Quick Task 260426-czq: Wire fun_fact through to web quiz UI Summary

One-liner: Added migration 00024 returning fun_fact from random_published_questions_excluding and rendered a subdued italic "Fun fact:" block under the explanation on Play.tsx revealed and reviewing branches.

## Files Changed

- supabase/migrations/00024_rpc_return_fun_fact.sql — new migration, CREATE OR REPLACE on random_published_questions_excluding adding fun_fact TEXT to RETURNS TABLE and q.fun_fact to SELECT list. count_available_questions left untouched.
- apps/web/src/lib/questions.ts — RpcRow gains fun_fact: string | null; toLoadedQuestion maps r.fun_fact ?? null.
- apps/web/src/state/quiz.ts — LoadedQuestion gains fun_fact: string | null after explanation.
- apps/web/src/screens/Play.tsx — both revealed and reviewing branches render the fun_fact block directly under the explanation.

## Migration Number

00024_rpc_return_fun_fact.sql

## Verification

- `npx tsc --noEmit` clean in apps/web
- `npx vitest run src/lib/questions.test.ts` — 12/12 passing
- Browser walkthrough: pending. The web app's `.env.local` points at the remote Supabase project (lgwrxaevtcxxwnnrpimm). Per the task constraints I did not push the migration. The currently running Vite preview talks to remote Supabase, which still returns the old RPC signature (no fun_fact column), so live rows render explanation only until migration 00024 is deployed. The render block is gated on `question.fun_fact &&`, so absence is invisible (no broken UI).

## Deploy Step (flagged)

Migration 00024 must be applied to the remote Supabase project after merge:

```
supabase link --project-ref lgwrxaevtcxxwnnrpimm
supabase db push
```

Once applied, every answer reveal in the web quiz will show "Fun fact: …" under the explanation (DB has 100% coverage on published questions).

## Deviations from Plan

None. The two code tasks executed exactly as written. Task 3 (checkpoint:human-verify) is the live-walkthrough gate; per the constraints I am not pushing the migration, so the human verifier owns the deploy + walkthrough.

## Self-Check: PASSED

- FOUND: supabase/migrations/00024_rpc_return_fun_fact.sql
- FOUND: commit b57e823 (Task 1)
- FOUND: commit be3a90a (Task 2)
- tsc clean, questions.test.ts green
