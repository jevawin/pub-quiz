# Project Research Summary

**Project:** Pub Quiz App
**Domain:** Cross-platform trivia app with AI content pipeline (iOS, Android, Web)
**Researched:** 2026-04-04
**Confidence:** HIGH

## Executive Summary

This is a cross-platform pub quiz app built with Expo SDK 55 (React Native 0.83) and Supabase as the backend-as-a-service. The defining architectural challenge is that the app has two independent systems that must work together: a client-side quiz experience and a server-side AI content pipeline that continuously generates, fact-checks, and populates questions using a 4-agent Claude Code pipeline. Experts build this type of product by getting the data model and content pipeline right first, then layering the quiz experience on top -- because without a reliable question bank, there is no product.

The recommended approach is to use Expo Router for file-based navigation, Supabase for auth (anonymous-first), database (PostgreSQL with RLS), and realtime (Broadcast for multiplayer), with TanStack Query managing all server state and Zustand managing client state. The stack research strongly recommends Zustand over the React Context approach originally specified in the project plan, because quiz flows involve frequent state updates (timers, answer selections, scores) that cause unnecessary re-renders with Context. The editorial, anti-gamification design philosophy is the primary differentiator -- no competitor combines high design quality with deep category hierarchies, answer explanations, and an ad-free experience. NativeWind 4.1 (Tailwind for React Native) enables this design system without the bloat of manual StyleSheet management.

The top risks are: (1) AI-generated questions shipping with wrong answers, which destroys user trust instantly -- mitigated by RAG-backed fact-checking with source citations and verification strength scores; (2) Supabase RLS misconfiguration exposing the entire question bank (including correct answers) to the client -- mitigated by enabling RLS on every table from the first migration and using Edge Functions for answer checking; (3) anonymous-to-authenticated user migration losing data -- mitigated by using Supabase identity linking (`updateUser()`) rather than `signUp()` for account creation. All three risks must be addressed in the very first development phase.

## Key Findings

### Recommended Stack

The stack is Expo-centric with Supabase as the sole backend. This eliminates custom server code entirely -- PostgREST handles CRUD, Edge Functions handle server logic, and Realtime handles multiplayer. State management splits cleanly: TanStack Query for server state (questions, categories, scores), Zustand for client state (quiz session, UI, preferences). Two storage layers serve different needs: react-native-mmkv for fast key-value access (settings, tokens) and expo-sqlite for structured question data that needs querying (offline cache). See STACK.md for full details.

**Core technologies:**
- **Expo SDK 55 + React Native 0.83**: Cross-platform framework with managed workflow, EAS builds, OTA updates
- **Supabase (PostgreSQL + Auth + Realtime + Edge Functions)**: All-in-one backend; RLS for security, Broadcast for multiplayer, anonymous auth for zero-friction onboarding
- **TanStack Query 5.x + Zustand 5.x**: Server state and client state respectively; never overlap, never conflict
- **NativeWind 4.1**: Tailwind CSS for React Native; utility-first styling that maps directly to an editorial design system
- **expo-sqlite**: Offline question cache with SQL query capability for "give me 10 unseen medium Science questions"
- **react-native-reanimated 4.3**: UI-thread animations at 120fps; required for the polished editorial aesthetic
- **Claude Code (headless mode)**: 4-agent pipeline for autonomous question generation; fallback to GitHub Actions cron if scheduled tasks remain unstable

**Critical version constraints:** NativeWind 4.1 requires Tailwind CSS 3.x (not 4.x). Reanimated 4.x requires New Architecture (enabled by default in Expo 55). Do NOT use Moti (abandoned), NativeWind v5 (pre-release), or AsyncStorage (deprecated in practice).

### Expected Features

See FEATURES.md for the full competitive analysis and dependency graph.

**Must have (table stakes -- users expect these):**
- Multiple choice questions with plausible distractors
- Category selection and difficulty levels
- Answer explanations after every question (QuizzLand proved this drives retention)
- Quick play (one-tap start, zero friction)
- Solo play with score tracking
- Timer per question (15-20 seconds)
- Anonymous-first auth (play immediately, no signup wall)
- Cross-platform (iOS + Android; web is secondary)

**Should have (differentiators -- competitive advantage):**
- Editorial design quality (Apple Design Award tier; the unoccupied territory in trivia)
- Deep nested categories (4 levels; e.g., Entertainment > Books > Harry Potter > Quidditch)
- AI-generated question pipeline at scale (no competitor does this well for solo play)
- Daily challenge (same questions for everyone; Wordle retention model)
- Offline question caching (respects users on commutes/flights)
- Ad-free gameplay (every competitor's #1 complaint is ads)
- Custom quiz builder (pick categories, difficulty, count)
- Pass-and-play multiplayer (no network needed; perfect for actual pub settings)

**Defer (v2+):**
- Join-via-code multiplayer (Kahoot-style; requires realtime infra, host/player UX)
- Leaderboards (requires account system + sufficient user base)
- Crowd-sourced difficulty calibration (requires thousands of answers per question)
- Monetization implementation (research model during v1.x; QuizUp's lesson: premature monetization kills)
- TV/presentation mode

**Anti-features (deliberate exclusions):** Streak rewards, loot boxes, interstitial ads, push notification spam, pay-to-win, speed-as-primary-mechanic, user-generated questions. These are the gamification patterns this app exists to reject.

### Architecture Approach

The architecture is a three-layer system: (1) Expo Router client app with file-based routing and route groups for auth/main/quiz/multiplayer flows, (2) Supabase backend providing PostgreSQL, Auth, PostgREST, Realtime, and Edge Functions, (3) independent AI content pipeline using Claude Code agents triggered by pg_cron and external schedulers. The client never touches the agent infrastructure. See ARCHITECTURE.md for the full system diagram, project structure, and data flow diagrams.

**Major components:**
1. **Expo Router App Shell** -- file-based routing with route groups `(auth)`, `(main)`, `(quiz)`, `(multiplayer)`; thin route files that delegate to components and hooks
2. **TanStack Query + Supabase Client** -- all server data flows through query hooks; Realtime subscriptions trigger `invalidateQueries()` rather than managing state directly
3. **Quiz Engine (services/quiz-engine.ts)** -- pure business logic with no React dependency; quiz session state lives locally during play, only final scores submit to server
4. **Offline Cache (expo-sqlite)** -- read-through cache of questions and categories; SQLite is never the source of truth, only a local mirror for offline play
5. **AI Content Pipeline** -- 4 independent agents (Category, Knowledge, Questions, Fact-Check) coordinated through a `pipeline_jobs` queue table in PostgreSQL; agents read pending jobs, generate content, write results back
6. **Edge Functions** -- server-side answer checking (protects correct answers from client), daily challenge generation, pipeline trigger webhooks, score aggregation

**Key patterns:** Anonymous-first auth with progressive enhancement. TanStack Query as single source of truth for server state (Realtime is a notification mechanism, not a state store). SQLite as read-through cache. Three-layer pipeline (cron -> queue -> process). Quiz session state is local-only during play.

### Critical Pitfalls

See PITFALLS.md for the full list with recovery strategies and phase mapping.

1. **AI hallucination in questions** -- LLMs hallucinate 3-18% of the time; a single wrong answer destroys trust in the entire bank. Mitigate: Fact-Check Agent must use RAG with source citations, not just parametric knowledge. Add `verification_strength` scores. Restrict early categories to well-known facts. Ship user reporting with fast review loop.

2. **RLS disabled or misconfigured** -- 170+ Supabase apps found with exposed databases in 2025. Mitigate: enable RLS in the same migration that creates each table, no exceptions. Never expose `correct_answer` to the client; use an Edge Function for answer checking. Index all RLS policy columns.

3. **Anonymous-to-authenticated data loss** -- using `signUp()` instead of `updateUser()` for account creation creates a new user ID and orphans all anonymous data. Mitigate: use identity linking exclusively. Design all tables with `user_id` foreign keys from day one. Write integration tests covering the full anonymous -> play -> sign up -> verify data flow.

4. **Question deduplication failure at scale** -- "What is the capital of France?" and "Which city serves as France's capital?" are different strings but the same question. Mitigate: store embeddings (pgvector) for each question; reject new questions above 0.85 cosine similarity. Track user question history to never serve repeats.

5. **Correct answers exposed to client** -- if `correct_answer` is in the Supabase query response, users can inspect network requests to cheat. Mitigate: RLS policy hides the column; Edge Function handles answer checking server-side. Rate-limit to 1 submission per question per user.

## Implications for Roadmap

Based on combined research, the build order follows real technical dependencies. The AI pipeline and database schema are prerequisites for everything else -- without questions, there is no product.

### Phase 1: Foundation (Database + Auth + Supabase Setup)
**Rationale:** Everything depends on the data model and auth. RLS must be correct from day one (Pitfall 2). Anonymous auth pattern must be correct from the start because it determines the entire user data model (Pitfall 3). This phase establishes the security and data foundations that are expensive to change later.
**Delivers:** PostgreSQL schema (categories, questions, answers, users, sessions, pipeline_jobs), RLS policies on all tables, anonymous auth flow, Supabase client singleton, Edge Function for answer checking.
**Addresses:** Anonymous-first auth (table stakes), category data model (foundation for browsing).
**Avoids:** RLS misconfiguration (Pitfall 2), anonymous data loss (Pitfall 3), correct answer exposure (Pitfall 5).

### Phase 2: AI Content Pipeline
**Rationale:** Without questions, the quiz experience cannot be built or tested. The pipeline is the engine that makes the entire product viable. Must include embedding-based deduplication from the start (Pitfall 4) and RAG-backed fact-checking (Pitfall 1).
**Delivers:** 4-agent pipeline (Category, Knowledge, Questions, Fact-Check), pipeline_jobs queue, pgvector embeddings for dedup, verification_strength scoring, seed question database (1000+ questions).
**Addresses:** AI question pipeline (P1 feature), question explanations (table stakes), deep category tree population.
**Avoids:** AI hallucination (Pitfall 1), question deduplication failure (Pitfall 4).

### Phase 3: Design System + UI Foundation
**Rationale:** The editorial design IS the differentiator. It cannot be bolted on later -- it must be the foundation for all UI work. Cross-platform testing must start here (Pitfall 5 from PITFALLS.md). NativeWind 4.1 + Reanimated 4.3 provide the styling and animation foundations.
**Delivers:** Design tokens (typography, spacing, color), NativeWind config, UI primitives (Button, Card, Typography), cross-platform CI matrix (iOS, Android, Web), Expo Router app shell with route groups.
**Addresses:** Editorial design (core differentiator), cross-platform support (table stakes).
**Avoids:** Cross-platform UI breakage (Pitfall 5 from PITFALLS.md).

### Phase 4: Core Quiz Experience (Solo Play)
**Rationale:** The core gameplay loop. Depends on schema (Phase 1), questions (Phase 2), and UI primitives (Phase 3). This is the feature set that validates the product.
**Delivers:** Quick play, category browsing (2 levels), difficulty selection, question display with timer, answer submission (via Edge Function), explanation reveal, session scoring and results screen.
**Addresses:** Solo play, quick play, category selection, multiple choice + explanations, timer, score tracking -- all P1 table stakes features.
**Avoids:** Storing quiz session state on server (Architecture anti-pattern 3); difficulty miscalibration (Pitfall 7 -- bias toward easier questions initially, treat AI difficulty as provisional).

### Phase 5: Offline + Daily Challenge + Custom Quiz
**Rationale:** Enhancement layer on top of a working online experience. Offline caching (expo-sqlite) gives the app a significant advantage over competitors. Daily challenge adds a Wordle-style retention mechanic with minimal incremental complexity (it is solo play with constraints).
**Delivers:** Offline question caching by category, sync-on-reconnect, daily challenge with timezone-aware scheduling (pg_cron + Edge Function), custom quiz builder (category + difficulty + count selection).
**Addresses:** Offline caching, daily challenge, custom quiz builder -- all P2 differentiators.
**Avoids:** Empty categories shown to users (hide categories with insufficient questions).

### Phase 6: Accounts + Profiles + Pass-and-Play
**Rationale:** Account creation is deferred until there is something worth persisting. Pass-and-play multiplayer requires no network infrastructure and is perfect for the pub quiz setting.
**Delivers:** Optional account creation (anonymous upgrade via identity linking), persistent stats and history, pass-and-play multiplayer mode on a single device, personal profile.
**Addresses:** Account creation, personal stats, pass-and-play multiplayer -- P2 features.
**Avoids:** Anonymous data loss on account creation (Pitfall 3 -- integration tested in Phase 1, fully exercised here).

### Phase 7: Join-via-Code Multiplayer
**Rationale:** Requires working quiz engine, auth, and Supabase Realtime. Most complex client feature. Needs its own cost model before launch (Pitfall 6). Deferred until the solo experience is validated.
**Delivers:** Room creation, join-via-code, real-time player tracking (Presence), synchronized question display (Broadcast), live scoring, host controls.
**Addresses:** Join-via-code multiplayer (P3).
**Avoids:** Realtime cost explosion (Pitfall 6 -- use Broadcast not Postgres Changes; model costs before launch).

### Phase 8: Leaderboards + Crowd Calibration + Monetization
**Rationale:** Requires sufficient user base for meaningful leaderboards and crowd-sourced difficulty data. Monetization research should happen during earlier phases, but implementation belongs here.
**Delivers:** Friend-scoped and daily leaderboards, Elo/IRT difficulty calibration from real answer data, monetization implementation (likely freemium with content packs or subscription).
**Addresses:** Leaderboards, crowd calibration, monetization -- all P3 features.
**Avoids:** Leaderboard score manipulation (server-side score calculation only).

### Phase Ordering Rationale

- **Database and auth first** because every subsequent phase depends on them, and security mistakes here (RLS, anonymous auth) are the most expensive to fix retroactively.
- **Pipeline before UI** because the quiz experience cannot be tested without real questions. The pipeline can be developed in parallel with UI work once the schema exists, but it is the harder technical problem and should start earlier.
- **Design system before features** because the editorial aesthetic is the product's core differentiator. Building features on unstyled primitives and "skinning" them later always produces inferior results.
- **Solo play before multiplayer** because solo is the primary use case (most trivia sessions are solo), multiplayer adds significant complexity and cost, and the solo experience validates the product independently.
- **Accounts deferred** because anonymous-first means accounts are an upgrade, not a prerequisite. Gating features behind accounts too early contradicts the zero-friction philosophy.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (AI Pipeline):** RAG integration for fact-checking, pgvector setup for embeddings, Claude Code headless mode orchestration, and fallback scheduling (GitHub Actions) if Claude Code Scheduled Tasks remain unstable. This is the most novel technical challenge.
- **Phase 5 (Offline + Daily):** expo-sqlite sync patterns, conflict resolution for offline answers, timezone handling for daily challenges.
- **Phase 7 (Multiplayer):** Supabase Realtime cost modeling, Broadcast vs Postgres Changes architecture, host-disconnect recovery, concurrent room limits.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** Supabase setup, RLS, anonymous auth -- well-documented with official quickstarts and guides.
- **Phase 3 (Design System):** NativeWind 4.1 + Reanimated 4.3 -- established patterns, good documentation.
- **Phase 4 (Solo Play):** Standard quiz app patterns; TanStack Query + Supabase is well-documented.
- **Phase 6 (Accounts + Pass-and-Play):** Supabase identity linking is documented; pass-and-play is local-only state.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions confirmed via npm/official changelogs. Expo 55 + Supabase is a well-trodden path. Only uncertainty: Claude Code Scheduled Tasks stability (known bug, fallback identified). |
| Features | HIGH | Competitor analysis covers 6+ apps with user review data. Feature priorities align with dependency analysis. Anti-features are well-justified by competitor failures. |
| Architecture | HIGH | Patterns sourced from official Supabase docs, Expo guides, and working open-source examples (Supaquiz). Three-layer pipeline pattern from Supabase's own blog. |
| Pitfalls | HIGH | Core pitfalls (RLS, anonymous auth, hallucination) confirmed by multiple independent sources including Supabase's own security documentation and real-world incident data (170+ exposed apps). |

**Overall confidence:** HIGH

### Gaps to Address

- **Claude Code Scheduled Tasks stability:** Known HTTP 500 errors on the triggers API as of April 2026. Plan for GitHub Actions cron as a fallback. Validate stability before depending on cloud scheduling.
- **RAG implementation for Fact-Check Agent:** Research identified the need but not the specific implementation. Need to determine: which authoritative sources, how to integrate retrieval into the agent prompt, and how to handle categories where authoritative sources are sparse.
- **Monetization model:** Research identified that premature monetization kills (QuizUp) and no monetization also kills. The specific model (subscription vs content packs vs freemium tier) needs user research and competitive pricing analysis before Phase 8.
- **Difficulty calibration algorithm:** Elo/IRT is recommended conceptually but the specific implementation (which IRT model, how many responses before switching from AI estimate to crowd estimate) needs technical research during Phase 4-5 planning.
- **Question volume targets per category:** How many questions per category is "enough" before exposing it to users? The 1000+ seed target for launch is a starting point but per-category minimums need definition.

## Sources

### Primary (HIGH confidence)
- Expo SDK 55 changelog, Expo Router docs, Expo app folder structure best practices
- Supabase documentation: RLS, anonymous auth, identity linking, Realtime, Edge Functions, cron
- npm package registries: supabase-js 2.101.x, TanStack Query 5.96.x, Zustand 5.0.12, Reanimated 4.3.0, NativeWind 4.1.x, MMKV 4.3.0
- Supabase Realtime benchmarks and cost discussions
- AI hallucination statistics 2026 (SuprMind research report)

### Secondary (MEDIUM confidence)
- Competitor reviews and analysis: Trivia Crack (ComplaintsBoard), QuizzLand (trivia-app-reviews), LearnClash, Sporcle, Kahoot alternatives
- QuizUp post-mortem analyses (Buildd, Quizzy Blog)
- Supabase PostgREST v14 throughput improvements (discussion thread)
- Claude Code Scheduled Tasks documentation and known issues

### Tertiary (LOW confidence)
- Monetization strategies for trivia apps (general freemium literature, not trivia-specific validation)
- IRT/Elo difficulty calibration for trivia (conceptual recommendation, no trivia-specific implementation guide found)

---
*Research completed: 2026-04-04*
*Ready for roadmap: yes*
