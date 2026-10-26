# Pub Quiz Pipeline

Setup checklist for running the question generation pipeline.

## Setup

1. Create a Supabase project at https://supabase.com/dashboard
2. Install the Supabase CLI: `npm install -g supabase` (or `brew install supabase/tap/supabase` on macOS)
3. Link to your remote project: `supabase link --project-ref <your-project-ref>` (find project ref in Supabase Dashboard > Project Settings > General)
4. Apply the migration: `supabase db push`
5. Apply seed data: `supabase db reset` (applies migrations + seed in local dev) or run `seed.sql` manually against remote
6. Generate TypeScript types (optional, replaces manual types): `npx supabase gen types typescript --linked > pipeline/src/lib/database.types.ts`
7. Set the GitHub Actions secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Dashboard > Project Settings > API) for the workflows that still run there. Question generation no longer uses an API key: it runs on a self-hosted machine through `claude -p` on the owner's Claude account, so no `ANTHROPIC_API_KEY` is needed. The GitHub generation workflows are disabled, and the observed-score refresh (`npm run refresh:observed-scores`) now runs from that machine as well.
8. Copy `pipeline/.env.example` to `pipeline/.env` and fill in values for local development
