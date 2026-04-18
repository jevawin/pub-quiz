# Deferred items

## Pre-existing test failures in `apps/web/src/lib/questions.test.ts`

7 tests unrelated to this quick task already fail on `main`:

- Tests reference the old RPC name `random_published_questions` — the code now uses `random_published_questions_excluding`.
- Mock for `./seen-store` is missing `getSeenIds` (test only returns `getViewCounts`).

Not fixed here per scope boundary. Should be addressed separately.
