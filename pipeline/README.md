# Pub Quiz Pipeline

Setup checklist for running the question generation pipeline.

## Setup

1. Create a Supabase project at https://supabase.com/dashboard
2. Install the Supabase CLI: `npm install -g supabase` (or `brew install supabase/tap/supabase` on macOS)
3. Link to your remote project: `supabase link --project-ref <your-project-ref>` (find project ref in Supabase Dashboard > Project Settings > General)
4. Apply the migration: `supabase db push`
5. Apply seed data: `supabase db reset` (applies migrations + seed in local dev) or run `seed.sql` manually against remote
6. Generate TypeScript types (optional, replaces manual types): `npx supabase gen types typescript --linked > pipeline/src/lib/database.types.ts`
7. Set GitHub Actions secrets: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Dashboard > Project Settings > API for Supabase values)
8. Copy `pipeline/.env.example` to `pipeline/.env` and fill in values for local development
