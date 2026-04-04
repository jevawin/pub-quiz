# Requirements: Pub Quiz

**Defined:** 2026-04-04
**Core Value:** Great questions delivered through a clean, effortless interface — the content is the star, not the chrome around it.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Database & Infrastructure

- [ ] **DB-01**: Supabase PostgreSQL schema for questions, categories, wrong answers, explanations, sources, and difficulty ratings
- [ ] **DB-02**: Row-level security enforced from first migration — public read for published questions, service-role write for pipeline
- [ ] **DB-03**: Questions and answers cached locally on device — no per-question API calls (users can google answers anyway; cost minimization > answer hiding)
- [ ] **DB-04**: Anonymous auth session created on first app launch (Supabase anon key)

### Question Pipeline (Independent Service)

- [ ] **PIPE-01**: Pipeline runs as an independent cloud service, decoupled from the app — feeds Supabase, app reads from Supabase
- [ ] **PIPE-02**: Initial bulk seed run — high-frequency schedule (e.g. every 5m) for first 48h to build seed database, frequency depends on architecture and Claude plan costs
- [ ] **PIPE-03**: Ongoing daily scheduled update that adds new questions from new knowledge or newly discovered backdated sources
- [ ] **PIPE-04**: Category Agent — discovers and proposes categories/subcategories, seeded with ~12 core themes
- [ ] **PIPE-05**: Knowledge Agent — finds quality reference material per category (Wikipedia as primary source, supplemented by educational sites)
- [ ] **PIPE-06**: Questions Agent — generates multiple-choice questions with correct answer, 3 plausible wrong answers, explanation, and agent-estimated difficulty
- [ ] **PIPE-07**: Fact-Check Agent — independently verifies answers using RAG against external sources (not LLM-on-LLM), builds verification strength (0-3)
- [ ] **PIPE-08**: Wikipedia integration strategy — research and implement optimal method for accessing Wikipedia data (API, dumps, or structured data feeds)
- [ ] **PIPE-09**: Pipeline execution environment decided and implemented — devil's advocate all options: Claude Code Remote Triggers, GitHub Actions, Cloudflare Workers, Netlify/Vercel Functions, DigitalOcean, dedicated cron server. Must: run Claude-powered research on schedule with parameters, connect cleanly to Supabase and repo

### Quiz Core

- [ ] **QUIZ-01**: Multiple choice questions with 4 options (1 correct, 3 plausible distractors)
- [ ] **QUIZ-02**: Answer explanation shown after each question (2-3 sentences) — toggleable setting, not enforced
- [ ] **QUIZ-03**: Answer at your own pace (no timer in MVP — timer is a v2 enhancement)
- [ ] **QUIZ-04**: Score tracking per session with results summary screen
- [ ] **QUIZ-05**: Quick play — one-tap start, random category, mixed difficulty, 10 questions
- [ ] **QUIZ-06**: Solo play mode — select category and difficulty, configurable question count

### Categories

- [ ] **CAT-01**: Category browser with at least 2 levels of hierarchy
- [ ] **CAT-02**: Difficulty levels — Easy, Normal, Hard (agent-assigned, schema ready for crowd calibration)
- [ ] **CAT-03**: Start a quiz at any category level (tap category to play, or go deeper)

### Auth

- [ ] **AUTH-01**: Anonymous-first — user plays immediately on first launch, no signup wall
- [ ] **AUTH-02**: Anonymous session persists across app restarts on same device

### Design & UX

- [ ] **UX-01**: Editorial design system — typographic, spacious, content-first (Dark Sky / Unsplash / Apple Design Award quality)
- [ ] **UX-02**: One-tap visible actions preferred over hidden menus — quick play prominent on home screen
- [ ] **UX-03**: Friendly, fun, real tone of voice throughout the app
- [ ] **UX-04**: Light/dark mode support
- [ ] **UX-05**: No gamification mechanics — no sparkles, no daily boosts, no gambling-inspired UI
- [ ] **UX-06**: Clean, non-intrusive loading states (no interstitial ads, no forced waits)

### Platform

- [ ] **PLAT-01**: Cross-platform — iOS, Android, Web from single React Native + Expo codebase
- [ ] **PLAT-02**: Expo Dev Client (not Expo Go) — required for native modules (MMKV, Reanimated)

### Cost Management

- [ ] **COST-01**: Local question cache on app install — bulk download published questions, only check daily for new/updated questions (not per-session API calls)
- [ ] **COST-02**: Supabase usage monitoring — track API calls, database size, and connection counts with alerts before cost thresholds
- [ ] **COST-03**: Pipeline cost controls — rate limiting on agent runs, budget caps on Claude API usage, monitoring dashboard for pipeline spend
- [ ] **COST-04**: Architecture designed to minimize Supabase Realtime usage in v1 (no realtime needed for solo play — REST/PostgREST only)

## Cost Risk Register

| Risk | Worst Case | Mitigation |
|------|-----------|------------|
| **Supabase Realtime** | $11K/mo at 10K concurrent WebSocket connections (multiplayer) | v1 uses REST only, no Realtime. Multiplayer deferred. When added: Broadcast channels only, never Postgres Changes |
| **Supabase API calls** | High volume if every quiz session fetches from server | Cache questions locally on install + daily sync. Bulk fetch, not per-question. Edge Function caching headers |
| **Supabase database size** | Grows with questions + sources + user data | Monitor row counts. Archive old knowledge sources. pgvector embeddings are large — evaluate necessity |
| **Claude API (pipeline)** | Unbounded if agents run continuously | Daily scheduled runs, not always-on. Budget caps per run. Track tokens/cost per agent per day |
| **Expo EAS builds** | Free tier limited, paid plans for high volume | Use free tier during development. EAS Update for OTA patches (free). Only full builds for releases |
| **Supabase Auth** | 50K MAU on free tier | Anonymous sessions count as MAU. Monitor. Consider session cleanup for abandoned anonymous users |

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Quiz Enhancements

- **QUIZ-07**: Timer per question (15-20s default) with optional relaxed mode

### Categories & Content

- **CAT-04**: Deep nested categories (4 levels) with breadcrumb navigation
- **CAT-05**: Category icons and question counts displayed in browser

### Social & Multiplayer

- **SOCL-01**: Daily challenge — same 10 questions for all users each day, rotating categories
- **SOCL-02**: Pass-and-play multiplayer — single device, turn-based, no network needed
- **SOCL-03**: Join-via-code multiplayer — Kahoot-style, real-time sync via Supabase Realtime
- **SOCL-04**: Leaderboards — daily + all-time, friend-scoped (requires account)

### Accounts & Persistence

- **ACCT-01**: Optional account creation (upgrade from anonymous using identity linking, not signUp)
- **ACCT-02**: Personal stats and quiz history (requires account)
- **ACCT-03**: Cross-device sync of progress and stats

### Platform Enhancements

- **PLAT-03**: Offline question caching for play without connectivity
- **PLAT-04**: TV/presentation mode for pub quiz hosting on large screens

### Intelligence

- **INTEL-01**: Crowd-sourced difficulty calibration (track correct/incorrect ratios, blend with agent difficulty)
- **INTEL-02**: Custom quiz builder — pick categories, difficulty range, question count

### Monetization

- **MON-01**: Monetization model implemented (research during v1, implement in v2 — options: freemium with content packs, low-cost subscription, or minimal non-intrusive ads)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Aggressive/interstitial ads | Violates core design philosophy — the #1 complaint about every competitor |
| Gamification mechanics (streaks-as-rewards, loot boxes, daily boosts) | The entire point of this app is to reject these patterns |
| Pay-to-win mechanics | Destroys fairness, universally hated in competitor reviews |
| Real-time chat | High complexity, moderation burden, rarely works in trivia apps |
| Video questions | Storage/bandwidth costs prohibitive, defer indefinitely |
| User-generated questions (open submission) | Inconsistent quality (Kahoot's biggest problem). AI pipeline produces better, more consistent content |
| Push notification spam | Users uninstall over this. At most: opt-in daily challenge reminder |
| Speed-as-primary-mechanic | Research shows it undermines engagement and rewards reflexes over knowledge |
| OAuth login for v1 | Anonymous + email sufficient, OAuth adds complexity for marginal value |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DB-01 | Phase 1 | Pending |
| DB-02 | Phase 1 | Pending |
| DB-03 | Phase 8 | Pending |
| DB-04 | Phase 3 | Pending |
| PIPE-01 | Phase 1 | Pending |
| PIPE-02 | Phase 2 | Pending |
| PIPE-03 | Phase 2 | Pending |
| PIPE-04 | Phase 1 | Pending |
| PIPE-05 | Phase 1 | Pending |
| PIPE-06 | Phase 1 | Pending |
| PIPE-07 | Phase 1 | Pending |
| PIPE-08 | Phase 1 | Pending |
| PIPE-09 | Phase 1 | Pending |
| QUIZ-01 | Phase 7 | Pending |
| QUIZ-02 | Phase 7 | Pending |
| QUIZ-03 | Phase 7 | Pending |
| QUIZ-04 | Phase 7 | Pending |
| QUIZ-05 | Phase 7 | Pending |
| QUIZ-06 | Phase 7 | Pending |
| CAT-01 | Phase 6 | Pending |
| CAT-02 | Phase 6 | Pending |
| CAT-03 | Phase 6 | Pending |
| AUTH-01 | Phase 3 | Pending |
| AUTH-02 | Phase 3 | Pending |
| UX-01 | Phase 4 | Pending |
| UX-02 | Phase 5 | Pending |
| UX-03 | Phase 4 | Pending |
| UX-04 | Phase 4 | Pending |
| UX-05 | Phase 4 | Pending |
| UX-06 | Phase 4 | Pending |
| PLAT-01 | Phase 5 | Pending |
| PLAT-02 | Phase 5 | Pending |
| COST-01 | Phase 8 | Pending |
| COST-02 | Phase 8 | Pending |
| COST-03 | Phase 1 | Pending |
| COST-04 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 36 total
- Mapped to phases: 36
- Unmapped: 0

---
*Requirements defined: 2026-04-04*
*Last updated: 2026-04-04 after roadmap creation*
