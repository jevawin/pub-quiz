# Pub Quiz — Web

The plain web quiz. Vite + React + TypeScript + Supabase, deployed to Cloudflare Pages.

## Local dev

1. Copy `.env.local.example` to `.env.local` and fill in:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` (public anon key — never the service role key)
2. `npm install`
3. `npm run dev` — serves on http://localhost:5173
4. `npm test` — vitest in watch mode
5. `npm run test:run` — single-shot test run for CI
6. `npm run build` — production build into `dist/`

## Deploy to Cloudflare Pages

Dashboard-driven (no wrangler.toml needed for v1):

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git.
2. Pick this repo, branch `main`.
3. Framework preset: **None** (Vite is not in the preset list at time of writing — manual config is fine).
4. Build settings:
   - **Root directory:** `apps/web`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
5. Environment variables (Production AND Preview):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. Save and deploy. First deploy takes ~2 minutes.
7. Pages assigns a `*.pages.dev` subdomain. That is the v1 URL.

## Verifying the deploy

- Open the `*.pages.dev` URL — setup screen renders.
- Deep-link `/play` — the SPA fallback (`public/_redirects`) serves `index.html`, the Play route's "no state" guard redirects you back to `/`.
- Play a full quiz of 5 questions. Check Supabase Studio → `question_plays` has new rows.

## Things NOT to do

- Never put the Supabase **service role** key in env vars or in the bundle. Only the anon key belongs here.
- Never add `VITE_*` secrets to `git` — `apps/web/.env.local` is gitignored for this reason.
- Never chain `.select()` onto `.insert()` on `question_plays` or `quiz_sessions` — insert-only RLS has no SELECT policy and the client will wrongly report a failure. See `apps/web/src/lib/plays.ts` for the correct pattern.
