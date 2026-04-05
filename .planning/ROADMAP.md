# Roadmap: Pub Quiz

## Overview

The build follows two parallel tracks: a question pipeline that runs independently in the cloud (Phases 1-2), and the quiz app itself (Phases 3-8). The pipeline is highest priority because without questions there is no product -- it starts first and runs in the background while the app is built. The app track flows from backend foundation through design system, navigation, category browsing, quiz gameplay, and finally local caching. Cost management requirements are woven into the phases where costs arise rather than isolated in a separate phase.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Question Pipeline -- Agents & Schema** - Build the 4-agent Claude pipeline and the Supabase schema it writes to
- [ ] **Phase 2: Question Pipeline -- Seed & Scheduling** - Run the initial high-frequency seed and establish ongoing daily schedule
- [ ] **Phase 3: Auth & App Backend** - Anonymous-first auth, app-side Supabase client, REST-only architecture
- [ ] **Phase 4: Design System** - Editorial design tokens, typography, primitives, light/dark mode
- [ ] **Phase 5: App Shell & Platform** - Expo Router navigation, cross-platform scaffold, home screen
- [ ] **Phase 6: Category Browser** - Hierarchical category browsing with play-at-any-level interaction
- [ ] **Phase 7: Quiz Engine & Play Modes** - Core quiz gameplay, quick play, solo play, scoring, results
- [ ] **Phase 8: Question Cache & Cost Management** - Local question cache, sync strategy, Supabase usage monitoring

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

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8
Note: Phases 1-2 (pipeline) and 3-4 (app foundation) can run in parallel since the pipeline is an independent service.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Question Pipeline: Agents & Schema | 0/4 | Planning complete | - |
| 2. Question Pipeline: Seed & Scheduling | 0/2 | Planning complete | - |
| 3. Auth & App Backend | 0/2 | Not started | - |
| 4. Design System | 0/3 | Not started | - |
| 5. App Shell & Platform | 0/2 | Not started | - |
| 6. Category Browser | 0/2 | Not started | - |
| 7. Quiz Engine & Play Modes | 0/3 | Not started | - |
| 8. Question Cache & Cost Management | 0/2 | Not started | - |

## Backlog

### Phase 999.1: Admin Review Queue for Score 1-2 Questions (BACKLOG)

**Goal:** Basic admin area in the app (or standalone tool) to review, approve/reject, and publish questions that scored below the auto-publish threshold (verification_score 1-2). Natural fit for Phase 2 when the app UI exists, or could be a simple standalone admin page.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)
