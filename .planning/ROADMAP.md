# Roadmap: Pub Quiz

## Overview

The build follows two parallel tracks: a question pipeline that runs independently in the cloud (Phases 1-2), and the quiz app itself (Phases 3-8). The pipeline is highest priority because without questions there is no product -- it starts first and runs in the background while the app is built. The app track flows from backend foundation through design system, navigation, category browsing, quiz gameplay, and finally local caching. Cost management requirements are woven into the phases where costs arise rather than isolated in a separate phase.

## How to use this roadmap

This document is split into three tracks plus an archive:

- **A. Build Path — Long Game.** The planned milestone phases (1-8 + 2.x inserts). The actual product. Currently in prototype phase (2.2 web quiz).
- **B. Post-Launch Backlog.** System-level / future-feature ideas that depend on play volume, public launch, or post-MVP context. Park until after launch.
- **C. Prototype Iteration Backlog.** Current-state work while iterating on the web prototype before the proper app build. Quick fixes from feedback + library quality work. **New feedback-driven items go here.**
- **D. Archive.** Resolved, promoted, and superseded items, preserved for traceability.

**Phase numbering:**
- Integer phases (1, 2, 3): planned milestone work
- Decimal phases (2.1, 2.2): urgent insertions (marked INSERTED)
- 999.x: backlog items (live in B or C, never on the build path until promoted)

---

# A. Build Path — Long Game

The planned milestone phases. Pipeline (1, 2, 2.1) runs autonomously; app track (3-8) gates on prototype validation.

**Execution order:** 1 → 2 → 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 3 → 4 → 5 → 6 → 7 → 8

**Pipeline scope (locked 2026-04-28):** the scheduled pipeline (~£15/mo Anthropic cap) is for **new question generation only**. Retroactive passes over published questions go through manual workflows (quick tasks for flagged feedback; backlog 999.16 for systematic full-library QA). Anything else = pipeline-budget waste.

Note: Phases 1-2 (pipeline) and 3-4 (app foundation) can run in parallel since the pipeline is an independent service.

## Build phases at a glance

- [x] **Phase 1: Question Pipeline -- Agents & Schema** - Build the 4-agent Claude pipeline and the Supabase schema it writes to
- [x] **Phase 2: Question Pipeline -- Seed & Scheduling** - Run the initial high-frequency seed and establish ongoing daily schedule
- [x] **Phase 2.1: Question Pipeline -- QA Agent & Source Relevance** - QA Agent for question quality, Knowledge Agent source filtering (INSERTED)
- [ ] **Phase 2.2: Web Quiz v1 & Feedback Collection** - Plain web quiz on Cloudflare Pages, collects real play + feedback data to seed calibration (INSERTED) — **active, prototype phase**
- [ ] **Phase 2.3: Admin Dashboard v1 -- Library & Pipeline Inspection** - Internal web admin for library inspection, curation, and pipeline observability (INSERTED)
- [ ] **Phase 2.4: Multi-Category + Per-Category Percentage Difficulty** - Finish schema cleanup migration; promoted from 999.8 (PROMOTED)
- [ ] **Phase 2.5: OpenTDB Attribution** - Provenance column + About/Credits screen, CC BY-SA 4.0 compliance; promoted from 999.13 (PROMOTED)
- [ ] **Phase 3: Auth & App Backend** - Anonymous-first auth, app-side Supabase client, REST-only architecture
- [ ] **Phase 4: Design System** - Editorial design tokens, typography, primitives, light/dark mode
- [ ] **Phase 5: App Shell & Platform** - Expo Router navigation, cross-platform scaffold, home screen
- [ ] **Phase 6: Category Browser** - Hierarchical category browsing with play-at-any-level interaction
- [ ] **Phase 7: Quiz Engine & Play Modes** - Core quiz gameplay, quick play, solo play, scoring, results
- [ ] **Phase 8: Question Cache & Cost Management** - Local question cache, sync strategy, Supabase usage monitoring

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Question Pipeline: Agents & Schema | 4/4 | Shipped | - |
| 2. Question Pipeline: Seed & Scheduling | 2/2 | Shipped | - |
| 2.1 Question Pipeline: QA Agent & Source Relevance | 3/3 | Shipped | - |
| 2.2 Web Quiz v1 & Feedback Collection | 2/9 | Active — prototype phase | - |
| 2.3 Admin Dashboard v1 | 0/0 | Not started | - |
| 2.4 Multi-Category + % Difficulty (from 999.8) | 4/5 | Plan 05 pending backfill (260426-bkf) | - |
| 2.5 OpenTDB Attribution (from 999.13) | 0/2 | Not started | - |
| 3. Auth & App Backend | 0/2 | Not started | - |
| 4. Design System | 0/3 | Not started | - |
| 5. App Shell & Platform | 0/2 | Not started | - |
| 6. Category Browser | 0/2 | Not started | - |
| 7. Quiz Engine & Play Modes | 0/3 | Not started | - |
| 8. Question Cache & Cost Management | 0/2 | Not started | - |

## Phase Details

### Phase 1: Question Pipeline -- Agents & Schema
**Goal**: An autonomous pipeline produces verified quiz questions and writes them to Supabase, with the database schema ready for both pipeline writes and future app reads
**Depends on**: Nothing (independent cloud service, highest priority)
**Requirements**: DB-01, DB-02, PIPE-01, PIPE-04, PIPE-05, PIPE-06, PIPE-07, PIPE-08, PIPE-09, COST-03
**Success Criteria** (what must be TRUE):
  1. Supabase PostgreSQL schema exists with tables for questions, categories, wrong answers, explanations, sources, difficulty ratings, and pipeline jobs -- with RLS enforced on every table
  2. Category Agent can discover and propose new subcategories starting from the 12 seed themes
  3. Knowledge Agent can find and store reference material for a given category using Wikipedia
  4. Questions Agent can generate multiple-choice questions (1 correct + 3 plausible distractors) with explanations and difficulty ratings
  5. Fact-Check Agent can independently verify answers using RAG against external sources and assign verification strength scores (0-3)
**Plans**: 4 plans
**Research note**: Pipeline execution environment must be stress-tested during plan-phase -- evaluate Claude Code Remote Triggers, GitHub Actions, Cloudflare Workers, Netlify/Vercel Functions, DigitalOcean, dedicated cron server. See PIPE-09.
**Cost reference**: See Cost Risk Register in REQUIREMENTS.md for Claude API and pipeline cost risks. COST-03 (rate limiting, budget caps, monitoring) is delivered in this phase.

Plans:
- [x] 01-01-PLAN.md -- Supabase schema, RLS, seed data, pipeline project setup, shared libraries
- [x] 01-02-PLAN.md -- Category Agent and Knowledge Agent with Wikipedia integration
- [x] 01-03-PLAN.md -- Questions Agent and Fact-Check Agent
- [x] 01-04-PLAN.md -- Pipeline orchestrator and GitHub Actions workflow

### Phase 2: Question Pipeline -- Seed & Scheduling
**Goal**: The pipeline has produced a seed question database and runs on a sustainable daily schedule
**Depends on**: Phase 1
**Requirements**: PIPE-02, PIPE-03
**Success Criteria** (what must be TRUE):
  1. Initial seed run has populated 1000+ verified questions across the 12 core categories (high-frequency schedule for first 48 hours)
  2. Daily scheduled pipeline runs add new questions without manual intervention
  3. Pipeline cost per run is tracked and within budget caps established in Phase 1
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md -- Seed threshold check script, least-covered-first category selection, Questions Agent integration
- [x] 02-02-PLAN.md -- Seed pipeline GitHub Actions workflow with 30-min cron and threshold gate

### Phase 02.1: Question Pipeline -- QA Agent & Source Relevance (INSERTED)

**Goal:** Add a QA Agent (5th pipeline step) that reviews questions for natural language, category fit, difficulty calibration, distractor quality, and readability -- rewriting where fixable, rejecting when broken. Also improve Knowledge Agent with better Wikipedia search queries, Haiku-powered source relevance filtering, and fallback search terms. Move auto-publish from Fact-Check to QA Agent
**Requirements**: D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10
**Depends on:** Phase 2
**Plans:** 3/3 plans complete

Plans:
- [x] 02.1-01-PLAN.md -- Database migration, QA schemas, config, remove auto-publish from Fact-Check
- [x] 02.1-02-PLAN.md -- Knowledge Agent enhancements (hierarchy queries, Haiku relevance filtering, fallback search)
- [x] 02.1-03-PLAN.md -- QA Agent implementation and pipeline orchestrator wiring

### Phase 2.2: Web Quiz v1 & Feedback Collection (INSERTED)

**Goal:** A deliberately plain public web quiz, shareable with friends and family, that collects real per-question answer data and feedback. Exists to break out of the "tweak prompts blindly" loop by generating ground-truth data: who gets what right, how long they take, and which questions feel bad. Also serves as the first real dress rehearsal for Phases 3 + 7 — every piece of logic (Supabase anonymous auth, question fetch, quiz state machine, answer reveal, scoring) transfers directly to the native app.

**Depends on:** Phase 2.1 (enough published questions to play against — 309 is sufficient)

**Stack:**
- **Vite + React + React Router**, deployed to **Cloudflare Pages** (not Next.js, not Vercel — too plain to need SSR, and Cloudflare is already set up with wrangler)
- Supabase client in the browser, RLS-gated. Reuses existing project and tables.
- Anonymous Supabase auth on first load, session persisted in localStorage. No signup.
- Minimal styling — the point is to test questions, not design. Clean typography, system fonts are fine.

**User flow:**
1. Landing page: "Play a pub quiz" + three options:
   - Difficulty: Easy / Medium / Hard (maps to current tiers)
   - Number of questions: 5 / 10 / 15 / 20
   - Category: General, or pick one from a short list of top-level categories
2. Quiz: one question per screen, 4 options, tap to answer. Reveal shows correct/incorrect + explanation.
3. **Per-question feedback IS the "next question" button** — three buttons below the reveal:
   - 👍 Good — next question
   - 👎 Bad — next question
   - 🤔 Confusing — next question
   - Icons accompany text labels, never replace them (accessibility). One tap moves forward *and* logs feedback. Skipping feedback is fine — a fourth "Next →" button for no-opinion.
4. End of quiz: **score summary first**, then feedback second (people are honest once they've seen how they did):
   - Star rating or three faces for "how was that?"
   - Single optional free-text box — "anything to tell us?" — no prompts, no placeholder questions
5. Share button — copy link to landing page.

**Data captured per question play** (new `question_plays` table):
- question_id, session_id (anonymous user_id), chosen_option, is_correct, time_to_answer_ms, feedback_reaction (nullable: good/bad/confusing/null), played_at
- **time_to_answer_ms counts only active-tab time** — `document.visibilityState === 'visible'` AND `window` focused. Accumulate via `visibilitychange` + `focus`/`blur` events. Pause the counter on blur, resume on focus. Prevents "left tab open during lunch" noise.

**Data captured per session** (new `quiz_sessions` table):
- session_id, category, difficulty, num_questions, score, overall_rating (nullable 1-5), feedback_text (nullable), started_at, completed_at

**Feeds directly into:**
- **Backlog 999.8** (per-category percentage scores) — `observed_score` and `observed_n` columns get seeded from real `question_plays` data, displacing Calibrator estimates as samples grow
- **Backlog 999.2** (refinement from feedback) — the feedback_reaction field is exactly the signal that pipeline was always meant to consume
- **Phase 2.3** (admin dashboard) — the histograms and estimate-vs-observed gap views become meaningful the day this ships
- **Phases 3 + 7** — the Supabase client setup, anonymous auth flow, and quiz state machine are all directly reusable in the native app

**Key decisions for plan-phase:**
- Schema for `question_plays` and `quiz_sessions` — new migration, RLS lets any anonymous user insert their own rows and read nothing else
- Where the tier thresholds live (hardcoded in config for v1 — easy/medium/hard map to Calibrator's current tiers; swap to % bands when 999.8 lands)
- Question selection within a tier: random sample, or avoid recent-plays-by-session? Probably random for v1, session-aware later
- Whether to gate anything behind an invite code (no — friction kills feedback rate)
- Privacy copy — one line, "we log which answers you pick to improve questions, no personal data" — no cookie banner, no signup, nothing else

**Deliberately out of scope for v1:**
- Accounts, profiles, score history, leaderboards
- Visual polish — editorial design system is Phase 4, not here
- Mobile-specific anything — responsive is enough, native app is Phases 3-8
- Social sharing beyond copy-link
- Any gamification (streaks, XP, badges) — ever, per PROJECT.md anti-gamification stance

**Why now (before admin dashboard):** Data > tools. The admin dashboard is more valuable once there are real plays to inspect — shipping this first means 2.3 lands with histograms that actually say something. And the single biggest unknown in the project right now is "do our questions feel good to strangers?" — no amount of internal review answers that.

**Target size before sharing:** Current 309 questions is enough. Ship it.

**Requirements:** WEB-00, WEB-01, WEB-02, WEB-03, WEB-04, WEB-05, WEB-06, WEB-07, WEB-08, WEB-09, WEB-10, WEB-11, WEB-12, WEB-13, WEB-14
**Plans:** 9 plans

Plans:
- [x] 02.2-01-PLAN.md — Scaffold apps/web/ Vite + React + TS + vitest + Tailwind + shadcn/ui
- [ ] 02.2-02-PLAN.md — Supabase migrations: question_plays, quiz_sessions, random_published_questions RPC
- [ ] 02.2-03-PLAN.md — Supabase client, anonymous auth, difficulty translator, category config
- [ ] 02.2-04-PLAN.md — Active-tab timer, localStorage outbox, shuffle, quiz reducer state machine
- [x] 02.2-05-PLAN.md — Setup screen (/) with query-param pre-fill + fetchRandomQuestions RPC helper
- [ ] 02.2-06-PLAN.md — Play screen (/play): question, reveal, feedback buttons, live question_plays insert
- [ ] 02.2-07-PLAN.md — End screen (/done): score, three-face rating, feedback text, share URL
- [ ] 02.2-08-PLAN.md — RLS integration tests + happy-path e2e + VALIDATION.md population
- [ ] 02.2-09-PLAN.md — Cloudflare Pages deploy docs + human verify live URL

### Phase 2.3: Admin Dashboard v1 -- Library & Pipeline Inspection (INSERTED)

**Goal:** Internal web admin (separate Vite + React app on Cloudflare Pages, matching the Phase 2.2 stack) for inspecting the question library, curating content, and watching the pipeline. Replaces the current "open Supabase Studio and write SQL" workflow. Single hardcoded admin user, RLS-gated.

**Depends on:** Phase 2.2 (real play data makes histograms and feedback inbox meaningful)

**Scope (v1 — game-stats half deferred to 999.9b until the app ships):**
- Library: counts by category / score band / status, score-distribution histograms per category, search + filter, per-question detail view (question, options, sources, verification trail, calibration history)
- Curation: soft-delete / un-publish, edit any field with audit trail, bulk re-run Calibrator / re-fact-check, approve/reject the score 1-2 review queue (absorbs backlog 999.1)
- Pipeline observability: recent runs (agents, cost, duration, in/out per stage, rejections + reasons), cost-to-date vs `PIPELINE_BUDGET_USD`, top rejection reasons per agent, manual "run now" trigger

**Out of scope for v1 (deferred to 999.9b):** DAU / sessions / quizzes played, observed correct rate, estimate-vs-observed gap, user feedback inbox — none of this exists until the mobile app ships and starts logging plays.

**Key decisions for plan-phase:**
- Build as a sibling Next.js + Tremor app, not inside Expo. Wrong audience, wrong constraints, keeps the mobile bundle clean.
- Reads: PostgREST direct. Writes: Edge Functions only, so audit trail can't be bypassed. Deletes are soft (status → archived).
- Auth: reuse Supabase project, hardcoded admin user_id checked via RLS. No role system yet.
- Absorbs backlog **999.1** entirely. Touches **999.2** (will become its UI), **999.6** (surfaces agent rejection patterns), and **999.8** (the score histograms are how you'll catch Calibrator clustering).

**Why now (before the app phases):** Every session so far has lost time to "write SQL to see what's in the library". The penguin-skin question took manual rejection. The Calibrator distribution check was a one-off script. A v1 of this would have saved hours already and will keep saving them through every subsequent pipeline iteration.

**Requirements:** TBD
**Plans:** TBD

Plans:
- [ ] 02.2-01: TBD
- [ ] 02.2-02: TBD

### Phase 2.4: Multi-Category + Per-Category Percentage Difficulty (PROMOTED from 999.8)

**Goal:** Finish the multi-category + percentage-difficulty migration. 4/5 plans executed; only schema-cleanup migration (drop legacy `category_id`, `difficulty`, `calibration_percent`) and RPC + web client rewrite remain.
**Depends on:** 999.8 backfill complete (quick task 260426-bkf — ~600 questions still missing `question_categories` rows).
**Requirements:** D-01 through D-15 (locked decisions in 999.8-CONTEXT.md).

Plans:
- [x] 999.8-01 through 999.8-04 — see backlog history
- [ ] 999.8-05-PLAN.md — Migrations 00023/00024: drop old columns, rewrite RPCs, web client rewrite, smoke-test checkpoint

### Phase 2.5: OpenTDB Attribution — Provenance Column + About/Credits Screen (PROMOTED from 999.13)

**Goal:** CC BY-SA 4.0 compliance for the 2308 OpenTDB-origin questions. Two parts: (1) add `origin TEXT` column to `questions` and backfill 2308 rows with `origin = 'opentdb'`; (2) user-visible About/Credits screen showing "Some questions sourced from Open Trivia Database (opentdb.com), CC BY-SA 4.0". Internal prompt footer alone is not license-compliant.
**Depends on:** Nothing — can ship anytime, but blocks public app launch.
**Why promoted:** Compliance gate — must land before any public ship of Phase 2.2 web quiz or Phase 3+ native app.

Plans:
- [ ] 02.5-01: TBD — migration + backfill
- [ ] 02.5-02: TBD — About/Credits screen in apps/web

### Phase 3: Auth & App Backend
**Goal**: Users can launch the app and immediately have an anonymous session with a working Supabase connection -- no signup wall, no friction
**Depends on**: Phase 1 (Supabase project and schema exist)
**Requirements**: DB-04, AUTH-01, AUTH-02, COST-04
**Success Criteria** (what must be TRUE):
  1. Anonymous auth session is created automatically on first app launch with no user interaction required
  2. Anonymous session persists across app restarts on the same device (user is never asked to sign in again)
  3. Supabase client connects via REST/PostgREST only -- no Realtime connections in v1
  4. App-side RLS policies allow anonymous users to read published questions and categories
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

### Phase 4: Design System
**Goal**: A complete editorial design system exists as reusable primitives that enforce the anti-gamification aesthetic across all future UI work
**Depends on**: Nothing (design tokens are independent of backend)
**Requirements**: UX-01, UX-03, UX-04, UX-05, UX-06
**Success Criteria** (what must be TRUE):
  1. Design tokens define typography hierarchy, spacing scale, and muted color palette for both light and dark modes
  2. Reusable UI primitives (Button, Card, Typography, Loading) exist and render correctly on iOS, Android, and Web
  3. Tone of voice is friendly, fun, and real in all text content (loading states, empty states, labels)
  4. No gamification mechanics exist anywhere -- no sparkles, no bouncing animations, no glossy buttons, no gradient backgrounds
  5. Loading states are clean and non-intrusive (skeleton screens or subtle indicators, never interstitial)
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD
- [ ] 04-03: TBD

### Phase 5: App Shell & Platform
**Goal**: Users can launch a cross-platform app with navigation structure and a home screen that surfaces one-tap actions
**Depends on**: Phase 4 (design system), Phase 3 (auth/backend)
**Requirements**: PLAT-01, PLAT-02, UX-02
**Success Criteria** (what must be TRUE):
  1. App runs from a single codebase on iOS, Android, and Web via Expo
  2. Expo Dev Client is configured (not Expo Go) for native module support
  3. Home screen prominently displays quick play and category browsing as visible, one-tap actions -- no hidden menus
  4. Navigation structure supports the flows needed by subsequent phases (category browsing, quiz play, results)
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD

### Phase 6: Category Browser
**Goal**: Users can explore the category hierarchy and start a quiz at any level
**Depends on**: Phase 5 (app shell), Phase 3 (database with categories)
**Requirements**: CAT-01, CAT-02, CAT-03
**Success Criteria** (what must be TRUE):
  1. User can browse categories with at least 2 levels of hierarchy (e.g., Science > Physics)
  2. Difficulty levels (Easy, Normal, Hard) are displayed and selectable for each category
  3. User can tap any category at any level to start a quiz -- or tap deeper to narrow scope
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

### Phase 7: Quiz Engine & Play Modes
**Goal**: Users can play a complete quiz -- from question display through answer selection to results -- via quick play or category-based solo play
**Depends on**: Phase 6 (categories), Phase 5 (app shell)
**Requirements**: QUIZ-01, QUIZ-02, QUIZ-03, QUIZ-04, QUIZ-05, QUIZ-06
**Success Criteria** (what must be TRUE):
  1. User can tap quick play on the home screen and immediately start a 10-question random quiz
  2. User can select a category and difficulty, choose question count, and start a solo quiz
  3. Each question displays 4 options (1 correct, 3 distractors) and the user answers at their own pace (no timer)
  4. After answering, the user sees whether they were correct and can read a 2-3 sentence explanation (toggleable in settings)
  5. After the final question, the user sees a results summary with their score for the session
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD
- [ ] 07-03: TBD

### Phase 8: Question Cache & Cost Management
**Goal**: The app works efficiently by caching questions locally and monitoring backend costs to stay within budget
**Depends on**: Phase 7 (working quiz experience), Phase 3 (Supabase backend)
**Requirements**: DB-03, COST-01, COST-02
**Success Criteria** (what must be TRUE):
  1. Questions are cached locally on the device after initial download -- no per-question API calls during play
  2. App checks for new/updated questions daily (not per-session), minimizing Supabase API usage
  3. Supabase usage monitoring is in place with alerts before cost thresholds are exceeded (API calls, database size, connection counts)
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD

---

# B. Post-Launch Backlog

System-level work and future features that depend on play volume, public launch, or post-MVP context. **Do not promote without re-evaluating fit** — most of these items need data or infrastructure that doesn't exist yet.

## Index

- **999.2** — Question Refinement from User Feedback (automated pipeline; needs play volume)
- **999.6** — Style Guide Update Agent with Approval Gate (automated; needs 500-question batch cadence + canonical style guide)
- **999.7** — SMS Daily Question Premium Feature (monetisation; needs app launched)
- **999.9b** — Admin Dashboard — Game Stats & Player Feedback (depends on app shipping with play data)
- **999.12** — Birth Decade Filter for Era-Appropriate Questions (UX feature; post-MVP)
- **999.14** — Review Wikipedia Sourcing Step Value in Pipeline (audit; do once pipeline is stable)

### Phase 999.2: Question Refinement from User Feedback (BACKLOG)

**Goal:** Automated pipeline that continuously reviews user feedback (correct answer rates, sentiment scores, written feedback) and refines questions -- adjusting difficulty labels, rewriting confusing questions, re-categorising, and retiring poor performers. Target: easy mode converges to ~80% correct rate, categories feel right, questions feel polished.
**Why post-launch:** Needs the input data (play counts, observed correct rate, written feedback at scale). 2.2 web quiz is the prototype that starts producing this data; meaningful refinement requires post-launch volume.
**Requirements:** TBD
**Plans:** 0 plans

### Phase 999.6: Style Guide Update Agent with Approval Gate (BACKLOG)

**Goal:** Repeatable agent that analyses batches of ~500 new questions and proposes updates to the question writing style guide. Triggered automatically when 500 new questions accumulate. Reads the existing style guide first, then looks for new patterns, category-specific insights, or calibration shifts in the latest batch. Produces a PROPOSED-UPDATE.md diff — never overwrites the original gold standard directly. Updates require human approval before merging into the canonical style guide. Related to 999.2 (user feedback refinement) — as user feedback data becomes available, the style guide agent should incorporate correctness rates and user sentiment alongside question analysis.
**Why post-launch:** Needs the 500-question batch cadence (post-2.2 ship rate) plus the canonical style guide formalised first. Could be revisited once 999.19 (format standardisation) lands, since 999.19 produces the canonical rules this agent would maintain.
**Requirements:** TBD
**Plans:** 0 plans

### Phase 999.7: SMS Daily Question Premium Feature (BACKLOG)

**Goal:** Premium feature that sends one pub quiz question per day via SMS. Player receives the question, replies with their answer (A/B/C/D), gets the result + fun fact back. Relies on the Enrichment Agent's `fun_fact` field — each message is a standalone question + answer + fun fact that works without app context. Potential monetisation as a paid subscription (e.g. £1/mo). Needs: SMS provider integration (Twilio/similar), subscriber management, question selection logic (avoid repeats, vary categories), opt-in/opt-out, billing. Related to 999.2 (user feedback) — SMS reply data is a feedback signal for question quality.
**Why post-launch:** Monetisation feature; needs paying users + app-launched context. SMS infrastructure cost not justified pre-launch.
**Requirements:** TBD
**Plans:** 0 plans

### Phase 999.9b: Admin Dashboard — Game Stats & Player Feedback (BACKLOG)

**Goal:** Second half of the admin dashboard (v1 shipped as Phase 2.3). Adds the player-data views that only become meaningful once the mobile app ships and starts logging plays: DAU / sessions / quizzes played, per-question observed correct rate + sample size, gap between estimate and observed score (the questions where the Calibrator was most wrong are the most interesting), per-category play volume and average score, user feedback inbox (flagged questions, written reports, sentiment).
**Depends on:** Phase 2.3 (admin shell exists), Phase 2.2 (feedback collection plumbing already in place from the web quiz), Phase 7 (native app ships and adds more play volume).
**Why post-launch:** Stats views are empty until the native app generates volume. Build with real data, not synthetic.
**Requirements:** TBD
**Plans:** 0 plans

### Phase 999.12: Birth Decade Filter for Era-Appropriate Questions (BACKLOG)

**Goal:** Player picks the decade they were born in (e.g. 1970s, 1980s, 1990s) during onboarding or per-quiz; question selection biases toward era-appropriate general knowledge (music, TV, events, brands, culture from that decade ±10 years). Goal: questions feel "of your time" — a 1985-born player isn't asked about 1960s Motown B-sides unless they opt in. Needs: decade tag on questions (`era_decade` or `era_range` field), agent-side era tagging during generation, runtime filter/boost in quiz selection (soft weighting, not hard filter, so cross-era general knowledge still appears). Optional UX: "play my decade" quick mode on home screen.
**Why post-launch:** UX feature, not core. Needs the native app + onboarding flow (Phases 5-7) to land first.
**Requirements:** TBD
**Plans:** 0 plans

### Phase 999.14: Review Wikipedia Sourcing Step Value in Pipeline (BACKLOG)

**Goal:** Audit whether the Knowledge Agent (Wikipedia sourcing) step earns its cost and complexity. The step fetches Wikipedia content per category to ground the Questions Agent — but native pipeline questions may not be meaningfully better than questions generated without a Wikipedia source, and the step adds latency, token cost, and a failure mode (bad source → bad questions). Review questions: (1) do questions with a Wikipedia source score higher in QA than those without? (2) are there categories where Wikipedia sourcing is actively harmful (too encyclopaedic, too detailed, pulls comprehension-framing)? (3) would a curated few-shot examples approach (already partially done via STYLE-GUIDE.md) be sufficient to replace it? Outcome: keep as-is, make sourcing optional per category depth, or remove and rely on model knowledge + style guide. Relates to 999.4 (prompt tone) — Wikipedia sourcing may be the root cause of the comprehension-framing problem even after prompt tightening.
**Why post-launch:** Audit; pipeline is currently working. Defer until cost / quality pressure makes it worth doing, or until 999.16 + 999.19 surface enough data to compare sourced vs unsourced quality.
**Requirements:** TBD
**Plans:** 0 plans

---

# C. Prototype Iteration Backlog

Current-state work. The web prototype (Phase 2.2) is the testbed; this section is where feedback-driven iterations and library-quality work live until the prototype is solid enough to commit to the proper build (Phase 3+).

**Add new feedback-driven items here.** Use the date-prefix slug convention (e.g. `260503-xxx`) for tactical fixes; reserve `999.x` numbers for phase-sized items.

## C1. Active quick tasks (this week)

Small, current-state-appropriate fixes triggered directly by recent feedback. Pure prompt edits or single-file tweaks. Execute with `/gsd-quick`.

### 260427-prm: Agent prompt nudges (PENDING)

**Goal:** Three small Questions Agent prompt edits in one commit:
1. Cap "year of creation/release" question density (feedback `17e9f94e`: "too many questions about year of creation").
2. British English bias (feedback `cbdfa600`: "Soccer is understood but should it be football?") — favour "football" over "soccer", "lift" over "elevator", etc.
3. Expand acronyms on first use (feedback `ced3bb1b`: "some questions about acronyms might need a bit of context") — e.g. "FBI (Federal Bureau of Investigation)".
**Why now:** Pure prompt edit, zero infra cost, addresses three feedback signals at once. Feeds future style-guide updater (999.6).

### 260428-fact: Tighten Enrichment Agent fun_fact prompt (PENDING)

**Goal:** Three "badly worded fun fact" reports in two days (`f2285df6`, `d8e55749`, plus eggplant grammar `09f0fd8b`). Pattern is bigger than per-question rewrites — Enrichment Agent prompt needs tightening. Investigate the prompt in `pipeline/src/agents/enrichment.ts` (or wherever fun_fact generation lives), tighten constraints: complete sentences, grammatical agreement, no "is/are" mismatches, must add new info beyond the question, max 1 sentence or 2 short ones. Sample-test against 20 questions before merging.
**Why now:** Quality compounds. Cheaper to fix the agent than rewrite individual facts forever.

### 260426-bkf: Resume 999.8 calibration backfill to completion (PENDING — HUMAN ACTION)

**Goal:** Phase 999.8 Plan 04 is checkpointed awaiting human-driven Claude Code agent backfill. Latest commit `ef93e7a` reports 2250/2848 (79%). ~600 questions still missing question_categories rows. Plan 05 (drop old columns: `category_id`, `difficulty`, `calibration_percent`) is blocked until `still_missing = 0`.
**Action:** Open a fresh Claude Code agent session and paste the prompt in `.planning/phases/999.8-multi-category-per-category-percentage-difficulty-backlog/999.8-04-SUMMARY.md` ("Checkpoint: Task 3 Awaiting Human Action"). Work in batches of 50, commit per batch, run the verification SQL when complete.
**Why now:** Unblocks Phase 2.4 plan 05 (the schema cleanup migration). Subscription-paid (no API spend cap risk).

## C2. Library quality work (sequenced)

Phase-sized iterations on the question library. Run in order — 999.18 first (UI bundle, browser-verifiable), then 999.19 (whole-library audit kills bulk skew), then 999.16 (per-row sweep over what's left).

### Phase 999.18: UI Polish Bundle — Hover/Touch States, Loading State, Cat Picker (BACKLOG)

**Goal:** Tighten Play/Setup/cat-picker UI based on recurring overall-feedback complaints. Mobile-first; remove hover affordance entirely (not useful on touch, bleeds onto answer/Next buttons).

**Scope:**
1. Remove all `:hover` styles app-wide (or convert to `@media (hover: hover)` guards if any need to stay for desktop pointer users — review case-by-case).
2. Fix lingering touch state on Next button (stays dark green after tap) and on answer buttons (last answer pre-highlighted, highlight on scroll).
3. Add disabled + loading state on Next/Submit. Loader = Lucide `BrainCog` (or composed `Brain`+`Cog`) with cog rotating clockwise + brain rotating anti-clockwise. Pair with cycling "thinking" verb every 3s, randomised per load. Verb list (lock during exec, ~12-15 terms): Pontificating, Postulating, Hypothesising, Speculating, Ruminating, Cogitating, Deliberating, Contemplating, Pondering, Mulling, Reasoning, Conjecturing, Theorising, Reflecting, Surmising, Inferring, Deducing, Musing, Synthesising, Reckoning, Philosophising, Devising, Wondering, Analysing, Computing, Processing. British -ising spellings.
4. Cat picker modal: close X to top-right corner, no overlap with title.
5. Browser verify: golden path on iOS Safari + Chrome desktop.

**Plans:** 0 plans

### Phase 999.19: Library Theme-Skew & Question-Format Standardisation Audit (BACKLOG)

**Goal:** Whole-library distribution + grammatical-structure audit. Distinct from 999.16 (per-row QA review). Two complementary passes:

**Pass A — Theme-skew audit:**
- Count questions per fine-grained theme within each category (e.g. Overwatch / year-of-creation / Van Gogh).
- Flag any theme exceeding N% of category total (N TBD during exec; likely 5-10%).
- Most skew expected from OpenTDB import bulk.
- Output: report ranked by over-representation. Manually rebalance — reject or rewrite the excess.

**Pass B — Question-format standardisation:**
- Pass over all questions; collate distinct phrasings of equivalent question-shapes (e.g. "What year was X released" vs "In what year was X released" vs "When was X released").
- Group variants; agree canonical format per shape with user.
- Rewrite outliers to canonical. Capture rules in 999.16 style guide for future generation/QA passes.

**Why both in one phase:** both are whole-library audits run on the same data scan. Cheaper to do together.
**Why before 999.16:** kills bulk skew first, so per-row sweep doesn't waste cycles on questions destined for delete or rewrite.

**Plans:** 0 plans

### Phase 999.16: Manual Conversational QA Pass on Question Library (BACKLOG)

**Goal:** Systematic human + Claude review of every question in the library (focus: 2307 OpenTDB imports first, then native pipeline output as it grows). Each session reviews a batch (~25-30 questions) in a table format: question, correct answer, distractors, fun_fact. Claude flags suspect items + proposes rewrites; user approves/edits/rejects. Applied via service-role PATCH; resolved questions stamped with `qa_passed_at`.

**Why manual:** Pipeline budget (~£15/mo Anthropic cap) is reserved for new question generation. Retroactive passes don't earn their slot. Manual catches:
- Subtle factual errors (e.g. McCartney/Lennon name swap caught 2026-04-28)
- Grammar/style issues (capitalisation, verb agreement, who-vs-which)
- Awkward phrasing that auto-grading misses
- Distractor quality (e.g. answer leakage, implausible options)

**Scale & cadence:** ~80 sessions to clear OpenTDB at 30/session. Realistic across weeks, not days. Run alongside everyday work as a recurring quick task; rebuild quality floor before public launch.

**Workflow:**
1. Fetch next batch of unreviewed questions ordered by `created_at` (or random sample)
2. Claude renders table with all relevant fields
3. Claude proposes flag/keep/rewrite per row
4. User approves/edits/rejects
5. Apply approved changes; mark `qa_passed_at`
6. Track progress: % of library reviewed, batches/week

**Depends on:** Tracking columns from quick task 260424-tla (already shipped — `qa_passed_at` exists).
**Replaces:** 999.15 / former Phase 2.6 (Haiku batch via pipeline — abandoned to keep pipeline focused on new generation).

**Plans:** 0 plans

## C3. Adding new items

When new feedback or prototype-iteration ideas surface during testing, add them here:

- **Tactical (single fix, prompt edit, small UI tweak):** new entry under **C1** with date-prefix slug `YYMMDD-xxx` (e.g. `260510-foo`). Execute via `/gsd-quick`.
- **Phase-sized (whole-library work, multi-step UI bundle):** new entry under **C2** with next free `999.x` number.
- **System-level / post-launch:** add to **section B** instead.

When a C-section item lands, move it to the **D. Archive** with a `RESOLVED YYYY-MM-DD via <quick-task-slug>` marker.

---

# D. Archive — Resolved, Promoted & Superseded

Preserved for traceability. The canonical commit/date list lives in `.planning/STATE.md` "Quick Tasks Completed".

## D1. Resolved backlog phases

### Phase 999.3: Improve Category Agent Prompt for Pub Quiz Suitability (RESOLVED 2026-04-19 via quick 260419-pma)

**Goal:** Tighten the Category Agent system prompt to favour categories that work in a real pub quiz. Add criteria: would a quizmaster say this out loud, would 3+ people at a table have a chance, avoid academic/technical categories. Current prompt is too vague ("avoid overly niche topics").
**Resolution:** Depth-aware rule added to pipeline/src/agents/category.ts — strict at depth 0/1 (rejects Thermodynamics, Epistemology, Macroeconomics), permissive at depth 2/3 (keeps niche leaves like Quidditch). Commit `c257dfc`.

### Phase 999.4: Improve Questions Agent Prompt for Pub Quiz Tone (RESOLVED 2026-04-19 via quick 260419-pma)

**Goal:** Rewrite the Questions Agent system prompt so generated questions feel like real pub quiz questions, not Wikipedia comprehension tests. Questions should test general knowledge people might actually know, not "according to the reference material, what does paragraph 3 say". Favour "would you hear this in a pub" over "what does the source text say".
**Resolution:** Tone section + comprehension-framing ban + answer-in-question ban added to pipeline/src/agents/questions.ts SYSTEM_PROMPT. Commits `794a422` (initial), `fa8158a` (answer-in-question ban after user flagged GTA/Dark Souls leakage). Verified via 20-sample live dry-run: tone shift confirmed, Q9/Q15-style leakage eliminated. User approved.

### Phase 999.5: OpenTDB Seed Data Import and Prompt Examples (RESOLVED 2026-04-19)

**Goal:** Use Open Trivia Database (opentdb.com, CC BY-SA 4.0, ~4000 questions with categories and difficulty levels) as either seed data for the question database or as few-shot examples in the Questions Agent prompt to teach pub quiz tone.
**Resolution:** Both approaches satisfied. (1) 2308 questions bulk-imported and published (commit `2453a51`), 739 held in staging. (2) STYLE-GUIDE.md built from OpenTDB analysis, referenced from Questions Agent prompt footer (`questions.ts:100`). User-facing attribution + provenance column tracked in 999.13 (now 2.5).

### ~~Phase 999.10: Fix Duplicate Local Migration 00011 Files~~ (RESOLVED 2026-04-19)

**Status:** Resolved before execution. The conflicting `00011_questions_staging.sql` was never tracked in git and is no longer on disk. Canonical staging migration lives at `00018_questions_staging.sql` (commit `2453a51`). Local migrations 00001–00018 all have unique version prefixes. Closed out by quick task `260419-oig` — see `.planning/quick/260419-oig-fix-duplicate-local-migration-00011-file/260419-oig-SUMMARY.md`.

### Phase 999.11: Pipeline Test Suite Drift Repair (RESOLVED 2026-04-19 via quick 260419-oxa)

**Goal:** Pipeline test suite has 7 failing tests that drifted during recent agent tightening commits. Production pipeline works but tests no longer match agent behaviour, so regressions are invisible.
**Resolution:** Fixed in quick task 260419-oxa (commit 8c0e007). All 7 tests repaired test-side; zero agent code changes. Final: 94/94 passing.

### Phase 999.17: Manual Feedback Inbox Sweep — May 2026 batch (RESOLVED 2026-05-03 via 260503-kxb)

**Resolution:** All 13 rows resolved via DB-only `supabase db query --linked` UPDATEs. 7 question rewrites applied (00356aeb / 87d46d3f / 3f39d670 / c59f2a01 / 082aaa09 / e9ebf25a / 90422fe9), 6 marked no-action with cross-references to 999.16 / 999.18 / 999.19. Open inbox count: 0. Detail in `.planning/quick/260503-kxb-fix-13-open-question-feedback-items/260503-kxb-SUMMARY.md`.

## D2. Promoted to build path

### Phase 999.8: Multi-Category + Per-Category Percentage Difficulty (PROMOTED → Phase 2.4 on 2026-04-26)

**Goal:** Replace single-category + easy/medium/hard with multi-category tagging where each category carries its own "estimated % of that audience who'd get it right" score. Difficulty tiers become a runtime grouping over the score (e.g. hard 0-33, medium 34-66, easy 67-100), tunable without re-scoring questions. As real answer data accumulates, the same percentage field gets refined from observed correct rates — same metric end-to-end, no easy/medium/hard ↔ percentage translation layer.

Example shape:
```
q: what element has a single proton in its nucleus?
a: hydrogen
category_scores: [{ "science_and_nature": 68 }, { "general_knowledge": 22 }]
```
68% of science-interested players get it; 22% of the general pub.

Implications worked through during plan-phase:
- **Schema**: `question_categories(question_id, category_id, estimate_score, observed_score, observed_n)` join table replaces single category_id + difficulty enum.
- **Always require a `general_knowledge` score** on every question.
- **Cap categories per question at 1-3** (plus mandatory general_knowledge).
- **Sample size matters**: store `observed_n` alongside `observed_score`. Use estimate until n ≥ ~30, then switch (or Bayesian-blend).
- **Calibrate to the right audience**: "% of players who *chose to play this category*", not "% interested in the topic".
- **Quiz-time selection rule**: when playing "Science", only show questions tagged science, ranked by science_score.
- **Calibrator agent rewrite**: produces a score per assigned category + general_knowledge.
- **Questions agent**: proposes the category set + per-category scores at generation time.
- **Migration path** for existing 309 published questions: one Calibrator run with the new prompt reseeds the whole library.
- **Backlog 999.2** feeds directly into this — observed correct rate replaces the estimate over time, same field.

**Requirements:** D-01 through D-15 (locked decisions from 999.8-CONTEXT.md)
**Plans:** 4/5 plans executed

Plans:
- [x] 999.8-01-PLAN.md — Wave 0 test scaffolds (schema, agents, slug converter, observed-score, RPC)
- [x] 999.8-02-PLAN.md — Migration 00022: question_categories table, CHECKs, DEFERRABLE trigger, RLS, types
- [x] 999.8-03-PLAN.md — Pipeline rewrites: slug converter, GK guard, schemas, DIFFICULTY_BANDS, Questions + Calibrator agents
- [x] 999.8-04-PLAN.md — Backfill script, nightly observed-score job + GH Actions cron, human checkpoint to run backfill
- [ ] 999.8-05-PLAN.md — Migrations 00023/00024: drop old columns + rewrite RPCs, web client rewrite, human smoke-test checkpoint (now tracked under Phase 2.4; blocked on 260426-bkf)

### Phase 999.13: OpenTDB Attribution — Provenance Column + About/Credits Screen (PROMOTED → Phase 2.5 on 2026-04-26)

See Phase 2.5 above. Original entry kept for history.

## D3. Superseded

### Phase 999.15: Retroactive QA + Fact-Check Pass on 2308 OpenTDB Imports (SUPERSEDED 2026-04-28 by 999.16)

**Status:** Originally promoted to Phase 2.6 on 2026-04-26 (Haiku batch via pipeline). Demoted 2026-04-28 — pipeline budget is for new question generation only. Replaced by **999.16** (manual conversational QA pass).

### Phase 999.15-original: Retroactive QA + Fact-Check Pass (HISTORIC)

**Goal:** The 2308 OpenTDB-imported questions (verification_score=2) bypassed Fact-Check and QA Agents — `fact_checked_at` and `qa_passed_at` are NULL. Run Fact-Check + QA in batches over all score=2 questions: rewrites fix tone/grammar/localisation, rejections remove bad ones, passes stamp the tracking columns and promote score to 3. Batch nightly via the existing scheduled pipeline to avoid cost spikes (~$23 total at ~$0.01/question). Fact-Check first (Q+A accuracy), then QA (pub quiz tone, distractors). Questions failing either step → status='rejected'.
**Status:** Archived under 999.15 above. Approach abandoned (pipeline-budget waste); see 999.16 for replacement.

## D4. Resolved quick-task specs (preserved)

These specs lived inline in the prior roadmap; their resolutions are tracked in `.planning/STATE.md` and individual `.planning/quick/<slug>/SUMMARY.md` files.

### 260428-fdb: Fix 6 open question_feedback items (RESOLVED 2026-04-28 via 260428-rfe)

**Resolution:** All 6 rewrites applied via service-role PATCH. `question_feedback` rows marked resolved with notes; open inbox count = 0.

### 260428-fdb-original: Fix 6 open question_feedback items (HISTORIC)

**Goal:** 6 reports collected 2026-04-27/28. Mix of question grammar and fun_fact quality.
1. `f2285df6` (qid `09aa4f7e…`) — "I'm not sure this fact makes sense"
2. `b17185e1` (qid `aed6cc1d…`) — "Badly worded"
3. `19e7b757` (qid `22aeee49…`) — "Keyboard not capitalised here"
4. `09f0fd8b` (qid `f746e6a0…`) — "'Is found in eggplant seeds' the chemical is singular"
5. `d8e55749` (qid `291ffce3…`) — "Confusing fact badly written"
6. `d9c362dd` (qid `3267b640…`) — "Shouldn't it be 'who of the following' because they're people?"

### 260428-end-toggle: Show/hide facts toggle on Round summary (RESOLVED 2026-04-28 via 260428-tao)

**Resolution:** Toggle shipped on End Round summary AND mirrored in Play screen header (right of "Question N of M", left of Exit). State persisted via sessionStorage so the preference carries between Play and End within a tab. Final design defaults to **ON** (flipped from original "default hidden" after preview iteration). Solid neutral-600 colour matching Exit button; state communicated via Eye/EyeOff icon + strikethrough on the "Facts" label.

### 260427-qol: UI QoL tweaks — icons, colours, polish (RESOLVED 2026-04-28)

**Resolution:** Shipped via merge `5927771` and palette unification `a9a50dd`. Lock icon on Lock In, ArrowRight on Next (right side, green), Lightbulb-prefixed blue callout for fun_fact, green Play / Play Again, coloured rating-state styling on End feedback faces, "Submit feedback" + Send icon, "Anything to tell us?" → "Feedback?", consistent palette tiers (`-50` faded / `-600` brand / `-700` hover / `-800` text).

### 260427-spt: Fix sport category filter bug (RESOLVED 2026-04-26 via 260426-ow2)

**Goal:** Session feedback `2ddac7cc` (2026-04-20): "Selected sport and got other subjects, but no sport". Investigate `fetchRandomQuestions` RPC + category filter path.
**Resolution:** Migration 00025 filters via `question_categories` with legacy fallback. Commit `731785c`.

### 260427-dup: Within-session question dedup (RESOLVED 2026-04-26 via 260426-pxh)

**Goal:** Session feedback `f65afa50` ("2 Van Gogh questions back-to-back wasn't ideal") and `ef374940` ("half the questions were repeats"). Track shown question_ids per session; exclude from subsequent picks within session.
**Resolution:** Drop stale-repeat fallback + greedy category interleave. Commit `1b7b54c`.

### 260427-end: End-of-quiz review screen (RESOLVED 2026-04-27 via 260427-uf1)

**Goal:** Per-question recap on End screen + show/hide facts toggle (feedback `116dc5a9`).
**Resolution:** Round summary shipped. Commit `3902d79`. Toggle later landed via 260428-tao.

### 260426-fct: Wire fun_fact into web quiz UI (RESOLVED 2026-04-26 via 260426-czq)

**Goal:** Update RPC to return `fun_fact`, extend `LoadedQuestion` types, render on reveal.
**Resolution:** Migration 00024 + types + reveal render. Commit `be3a90a`.

### 260426-fdb: Fix 3 open question_feedback items (RESOLVED 2026-04-26)

**Resolution:** All three actioned. Items 1 + 2 (question rewrites) shipped in commit `ddd6359`. Item 3 (focus-state UI bug) shipped in commit `b4ca9f0` — answer buttons switched to `focus-visible:` so mouse clicks no longer leave a ring. `question_feedback` inbox confirmed empty as of 2026-04-26.

### 260426-q15: Confirm scope of 999.15 retroactive QA pass (RESOLVED 2026-04-28)

**Resolution:** Refocused Phase 2.6 from full QA + fact-check to grammar+style-only pass per user direction (2026-04-28): "facts are solid; theme of poor grammar in OpenTDB questions". Cost estimate dropped from £23 to ~£10 Haiku-only. q15 closed; the broader retroactive-pass approach was then itself superseded by 999.16 manual review.
