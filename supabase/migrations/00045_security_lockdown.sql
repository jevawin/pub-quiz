-- 00045 security lockdown (2026-11-11, applied live via the Supabase MCP as security_lockdown_2026_11_11).
-- Advisor ERRORs fixed: questions_staging had RLS off (anon could read/edit/delete all ~3.8k rows);
-- category_visibility was a SECURITY DEFINER view. Grants trimmed to what the site actually uses
-- (public reads + insert-only telemetry); service/secret keys bypass RLS and are unaffected.
-- Verified after: anon view counts identical (631 categories / 363 visible / 6,711 published), RPCs OK,
-- anonymous play insert 201 + save_quiz_session 204, every internal table 401 for the publishable key.

-- 1. Staging: RLS on, no public access (pipeline uses the service key, which bypasses RLS).
alter table public.questions_staging enable row level security;

-- 2. Internal/admin tables: no grants at all for the public roles (already RLS-blocked; defence in depth).
revoke all on public.questions_staging, public.admin_notes, public.admin_requests, public.category_aliases,
  public.category_changes, public.category_flags, public.pipeline_runs, public.question_rules, public.sources,
  public.sweep_proposals, public.sweep_runs from anon, authenticated;

-- 3. Public-read tables: read only.
revoke insert, update, delete, truncate, references, trigger on public.categories, public.questions,
  public.question_categories, public.category_visibility from anon, authenticated;

-- 4. Write-only telemetry tables: insert only (site never reads them back; inserts use no .select()).
revoke select, update, delete, truncate, references, trigger on public.question_feedback, public.question_plays,
  public.question_recategorisations, public.quiz_sessions from anon, authenticated;

-- 5. View runs with the caller's rights, so RLS applies (results unchanged: it only counts published rows).
alter view public.category_visibility set (security_invoker = on);

-- 6. Pin search_path on the 3 flagged functions.
alter function public.enforce_question_categories_rules() set search_path = public;
alter function public.admin_hide_question(uuid, text, text) set search_path = public;
alter function public.admin_unhide_question(uuid, text) set search_path = public;
