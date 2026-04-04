# Architecture Research

**Domain:** Cross-platform quiz app with AI content pipeline
**Researched:** 2026-04-04
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                    │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
│  │   iOS App    │  │ Android App  │  │   Web App    │                   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                   │
│         └──────────────────┼──────────────────┘                         │
│                    ┌───────┴────────┐                                    │
│                    │  Expo Router   │                                    │
│                    │  (App Shell)   │                                    │
│                    └───────┬────────┘                                    │
│         ┌──────────────────┼──────────────────┐                         │
│  ┌──────┴──────┐  ┌───────┴───────┐  ┌───────┴───────┐                  │
│  │  TanStack   │  │  React        │  │  expo-sqlite  │                  │
│  │  Query      │  │  Context      │  │  (Offline     │                  │
│  │  (Server    │  │  (UI State)   │  │   Cache)      │                  │
│  │   State)    │  │               │  │               │                  │
│  └──────┬──────┘  └───────────────┘  └───────┬───────┘                  │
│         │                                     │                         │
│         │  ┌──────────────────────────────┐    │                         │
│         └──┤  Supabase Client SDK         ├───┘                         │
│            │  (singleton, auth-aware)     │                              │
│            └──────────────┬───────────────┘                              │
└───────────────────────────┼─────────────────────────────────────────────┘
                            │ HTTPS / WebSocket
┌───────────────────────────┼─────────────────────────────────────────────┐
│                    SUPABASE LAYER                                        │
│                            │                                            │
│  ┌─────────────────────────┴─────────────────────────────┐               │
│  │                   API Gateway                          │               │
│  │         (PostgREST + Realtime + Auth)                  │               │
│  └──┬──────────────┬──────────────┬──────────────┬───────┘               │
│     │              │              │              │                       │
│  ┌──┴──────┐  ┌────┴─────┐  ┌────┴─────┐  ┌────┴──────┐                │
│  │ Auth    │  │ PostgREST│  │ Realtime │  │ Edge      │                │
│  │ (Anon + │  │ (REST    │  │ (WS for  │  │ Functions │                │
│  │ Email)  │  │  API)    │  │ multi-   │  │ (Webhooks │                │
│  │         │  │          │  │ player)  │  │ + Cron)   │                │
│  └─────────┘  └────┬─────┘  └────┬─────┘  └────┬──────┘                │
│                     │             │              │                       │
│  ┌──────────────────┴─────────────┴──────────────┴───────┐               │
│  │                   PostgreSQL                           │               │
│  │                                                        │               │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐          │               │
│  │  │ categories │ │ questions  │ │ sessions   │          │               │
│  │  │ (tree)     │ │ + answers  │ │ + scores   │          │               │
│  │  └────────────┘ └────────────┘ └────────────┘          │               │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐          │               │
│  │  │ users      │ │ daily_     │ │ pipeline_  │          │               │
│  │  │ + profiles │ │ challenges │ │ jobs       │          │               │
│  │  └────────────┘ └────────────┘ └────────────┘          │               │
│  │                                                        │               │
│  │  pg_cron + pg_net (schedule Edge Function calls)       │               │
│  │  RLS policies (row-level security on all tables)       │               │
│  └────────────────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                     AI CONTENT PIPELINE                                  │
│                  (runs independently of client)                         │
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │
│  │  Category    │───>│  Knowledge   │───>│  Questions   │               │
│  │  Agent       │    │  Agent       │    │  Agent       │               │
│  │  (weekly)    │    │  (daily)     │    │  (daily)     │               │
│  └──────────────┘    └──────────────┘    └──────┬───────┘               │
│                                                  │                      │
│                                          ┌───────┴──────┐               │
│                                          │  Fact-Check  │               │
│                                          │  Agent       │               │
│                                          │  (daily,     │               │
│                                          │   staggered) │               │
│                                          └──────────────┘               │
│                                                                         │
│  Trigger: Claude Code CLI headless mode (-p flag)                       │
│  Schedule: pg_cron -> Edge Function webhook -> Claude Code dispatch     │
│  OR: External cron (GitHub Actions / cloud scheduler)                   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Expo Router (App Shell) | File-based routing, layout nesting, auth guards | `app/` directory with route groups `(auth)`, `(main)`, `(quiz)` |
| TanStack Query | Server state: fetching, caching, background sync of questions/categories | Custom hooks per domain: `useQuestions()`, `useCategories()`, `useDailyChallenge()` |
| React Context | UI-only state: current quiz progress, theme, selected answers | Lightweight providers; no server data here |
| expo-sqlite | Offline question cache, local score history | SQLite DB as read-cache; synced from Supabase on connectivity |
| Supabase Client SDK | Single entry point for all backend communication | Singleton instance, auth-aware, shared across hooks |
| Supabase Auth | Anonymous sessions, optional email upgrade | Anonymous-first; `signInAnonymously()` on first launch, link to email later |
| PostgREST | CRUD for questions, categories, scores, profiles | Auto-generated REST from Postgres schema; secured by RLS |
| Supabase Realtime | Multiplayer quiz synchronization | Broadcast channels per game room; Presence for player tracking |
| Edge Functions | Pipeline trigger webhooks, daily challenge generation, score aggregation | Deno-based serverless functions; "fat function" pattern |
| PostgreSQL | All persistent data, pipeline job queue, cron scheduling | Core tables + `pipeline_jobs` queue table + pg_cron + pg_net |
| AI Agents | Content generation: categories, knowledge, questions, fact-checking | Claude Code headless mode, triggered on schedule |

## Recommended Project Structure

```
pub-quiz/
├── app/                          # Expo Router routes (ONLY routes here)
│   ├── _layout.tsx               # Root layout: providers, fonts, splash
│   ├── index.tsx                 # Home / quick play
│   ├── (auth)/                   # Auth route group
│   │   ├── _layout.tsx           # Auth guard layout
│   │   ├── sign-in.tsx
│   │   └── sign-up.tsx
│   ├── (main)/                   # Authenticated routes
│   │   ├── _layout.tsx           # Tab navigation layout
│   │   ├── index.tsx             # Dashboard / quick play
│   │   ├── categories/
│   │   │   ├── index.tsx         # Category browser (top level)
│   │   │   └── [slug].tsx        # Category detail (any depth via slug)
│   │   ├── daily.tsx             # Daily challenge
│   │   ├── leaderboard.tsx
│   │   └── profile.tsx
│   ├── (quiz)/                   # Quiz session routes (full-screen, no tabs)
│   │   ├── _layout.tsx           # Minimal quiz layout (no nav chrome)
│   │   ├── [sessionId].tsx       # Active quiz play
│   │   └── results/
│   │       └── [sessionId].tsx   # Quiz results
│   └── (multiplayer)/            # Multiplayer routes
│       ├── _layout.tsx
│       ├── join.tsx              # Join via code
│       ├── host.tsx              # Host a game
│       └── lobby/
│           └── [roomId].tsx      # Game lobby + live play
├── components/                   # Reusable UI components
│   ├── ui/                       # Design system primitives
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Typography.tsx
│   │   └── ...
│   ├── quiz/                     # Quiz-specific components
│   │   ├── QuestionCard.tsx
│   │   ├── AnswerOption.tsx
│   │   ├── ProgressBar.tsx
│   │   └── ExplanationSheet.tsx
│   ├── categories/               # Category browsing components
│   │   ├── CategoryTree.tsx
│   │   ├── Breadcrumbs.tsx
│   │   └── CategoryCard.tsx
│   └── multiplayer/              # Multiplayer components
│       ├── PlayerList.tsx
│       ├── ScoreBoard.tsx
│       └── JoinCodeInput.tsx
├── hooks/                        # Custom React hooks
│   ├── queries/                  # TanStack Query hooks (server state)
│   │   ├── use-questions.ts
│   │   ├── use-categories.ts
│   │   ├── use-daily-challenge.ts
│   │   ├── use-leaderboard.ts
│   │   └── use-profile.ts
│   ├── mutations/                # TanStack mutation hooks
│   │   ├── use-submit-answer.ts
│   │   ├── use-start-quiz.ts
│   │   └── use-join-room.ts
│   └── use-offline-cache.ts      # expo-sqlite sync hook
├── lib/                          # Core library code
│   ├── supabase.ts               # Supabase client singleton
│   ├── database.ts               # expo-sqlite setup
│   ├── auth.ts                   # Auth helpers
│   └── constants.ts              # App constants
├── providers/                    # React Context providers
│   ├── AuthProvider.tsx          # Auth state + anonymous session
│   ├── QuizSessionProvider.tsx   # Active quiz state machine
│   └── ThemeProvider.tsx         # Theme / design tokens
├── services/                     # Business logic (no React dependency)
│   ├── quiz-engine.ts            # Quiz flow logic, scoring
│   ├── offline-sync.ts           # SQLite <-> Supabase sync
│   └── category-tree.ts          # Category hierarchy traversal
├── types/                        # TypeScript types
│   ├── database.ts               # Generated from Supabase schema
│   ├── quiz.ts                   # Quiz domain types
│   └── navigation.ts             # Route params
├── supabase/                     # Supabase project files
│   ├── functions/                # Edge Functions
│   │   ├── trigger-pipeline/     # Webhook to trigger agent runs
│   │   ├── generate-daily/       # Daily challenge assembly
│   │   └── _shared/              # Shared Edge Function code
│   ├── migrations/               # Database migrations
│   └── seed.sql                  # Seed data (initial categories)
└── agents/                       # AI agent definitions
    ├── category-agent.md         # Category Agent system prompt
    ├── knowledge-agent.md        # Knowledge Agent system prompt
    ├── questions-agent.md        # Questions Agent system prompt
    ├── fact-check-agent.md       # Fact-Check Agent system prompt
    └── pipeline.sh               # Pipeline orchestration script
```

### Structure Rationale

- **app/:** Routes only. Expo Router convention -- no business logic, no components. Route groups `(auth)`, `(main)`, `(quiz)`, `(multiplayer)` keep navigation concerns separated and enable per-group layouts (tabs for main, minimal chrome for quiz play).
- **components/:** Organized by domain, not by type. `ui/` for design system primitives, then domain folders (`quiz/`, `categories/`, `multiplayer/`) for feature-specific components.
- **hooks/queries/ and hooks/mutations/:** Separates TanStack Query hooks from other hooks. Each hook wraps a single Supabase query, making server state management predictable and testable.
- **lib/:** Framework-agnostic utilities. The Supabase client singleton lives here, not in a hook, because Edge Functions and services also need it.
- **providers/:** Thin React Context wrappers for UI state only. Server state lives in TanStack Query, not Context.
- **services/:** Pure business logic with no React imports. The quiz engine, offline sync, and category tree logic can be unit-tested without rendering components.
- **agents/:** Agent system prompts and orchestration scripts live in the repo for version control and iteration alongside the schema they target.

## Architectural Patterns

### Pattern 1: Anonymous-First Auth with Progressive Enhancement

**What:** Every user starts with an anonymous Supabase session. No signup wall. Account creation is offered later for persistence, leaderboards, and cross-device sync.
**When to use:** First app launch, before any server interaction.
**Trade-offs:** Simplifies onboarding dramatically, but anonymous sessions create orphan data if users never upgrade. Supabase handles anonymous-to-authenticated linking natively.

**Example:**
```typescript
// lib/auth.ts
import { supabase } from './supabase';

export async function ensureSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    // First launch: create anonymous session
    await supabase.auth.signInAnonymously();
  }
  return session;
}

export async function upgradeToEmail(email: string, password: string) {
  // Link anonymous session to email account
  // Preserves all existing data (scores, history)
  const { data, error } = await supabase.auth.updateUser({
    email,
    password,
  });
  return { data, error };
}
```

### Pattern 2: TanStack Query as Server State Layer with Realtime Invalidation

**What:** All Supabase data flows through TanStack Query hooks. Supabase Realtime subscriptions do not manage state directly -- they trigger `invalidateQueries` to let TanStack Query refetch and cache the latest data.
**When to use:** All server data access -- questions, categories, scores, profiles.
**Trade-offs:** Adds a layer of indirection over raw Supabase calls, but provides automatic caching, background refetch, stale-while-revalidate, and offline support via `persistQueryClient`. Prevents the dual-state-management trap of having both TanStack Query cache and Realtime state.

**Example:**
```typescript
// hooks/queries/use-questions.ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useEffect } from 'react';

export function useQuestions(categorySlug: string, difficulty?: number) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['questions', categorySlug, difficulty],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('questions')
        .select('*, answers(*)')
        .eq('category_slug', categorySlug)
        .eq('status', 'verified')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 min -- questions don't change often
  });

  // Realtime: invalidate on new questions (from pipeline)
  useEffect(() => {
    const channel = supabase
      .channel('questions-updates')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'questions',
        filter: `category_slug=eq.${categorySlug}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['questions', categorySlug] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [categorySlug]);

  return query;
}
```

### Pattern 3: Offline Cache with SQLite as Read-Through Cache

**What:** expo-sqlite stores a subset of questions and categories locally. On launch or connectivity change, sync from Supabase. When offline, serve from SQLite. The network is an async side effect, not a blocker.
**When to use:** Question data for offline play, category tree for browsing.
**Trade-offs:** Adds complexity of two data sources. Keep it simple: SQLite is a read-only cache of server data, never the source of truth for questions. Only user-generated data (in-progress quiz answers) writes to SQLite first.

**Example:**
```typescript
// services/offline-sync.ts
import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('pubquiz.db');

export async function syncQuestions(categorySlug: string) {
  const { data } = await supabase
    .from('questions')
    .select('id, question_text, difficulty, category_slug, answers(*)')
    .eq('category_slug', categorySlug)
    .eq('status', 'verified');

  if (!data) return;

  db.execSync('BEGIN TRANSACTION');
  for (const q of data) {
    db.runSync(
      'INSERT OR REPLACE INTO questions (id, text, difficulty, category, answers_json) VALUES (?, ?, ?, ?, ?)',
      [q.id, q.question_text, q.difficulty, q.category_slug, JSON.stringify(q.answers)]
    );
  }
  db.execSync('COMMIT');
}

export function getOfflineQuestions(categorySlug: string, limit = 20) {
  return db.getAllSync(
    'SELECT * FROM questions WHERE category = ? ORDER BY RANDOM() LIMIT ?',
    [categorySlug, limit]
  );
}
```

### Pattern 4: Three-Layer Pipeline Architecture (Collect -> Queue -> Process)

**What:** The AI content pipeline uses Supabase's cron + queue + Edge Functions pattern. pg_cron triggers Edge Functions on schedule. Edge Functions enqueue work into a `pipeline_jobs` table. Claude Code agents (headless mode) pick up jobs, generate content, and write results back to Postgres.
**When to use:** All AI content generation -- categories, knowledge, questions, fact-checking.
**Trade-offs:** Decouples scheduling from execution. Pipeline jobs are durable (survive failures). But adds complexity of a job queue table and status tracking. Worth it because AI generation is slow and unreliable -- you need retry semantics.

**Pipeline flow:**
```
pg_cron (every 6 hours)
    |
    v
Edge Function: trigger-pipeline
    |
    v
INSERT INTO pipeline_jobs (type: 'generate-questions', category: 'Science > Physics', status: 'pending')
    |
    v
External scheduler (GitHub Actions cron / cloud scheduler)
    |
    v
claude -p "You are the Questions Agent. Pick up pending jobs from pipeline_jobs..."
    |
    v
Agent reads pending jobs -> generates questions -> writes to questions table -> marks job complete
```

## Data Flow

### Quiz Play Flow (Solo)

```
[User taps "Quick Play"]
    |
    v
[QuizSessionProvider] creates session state (local)
    |
    v
[useQuestions hook] -> TanStack Query -> Supabase PostgREST -> questions table
    |                                                             |
    |  (offline?)                                                 |
    +---------> expo-sqlite cache -> return cached questions       |
    |                                                             |
    v  (online)                                                   v
[QuestionCard] renders question + answer options        RLS: only verified
    |                                                   questions returned
    v
[User taps answer]
    |
    v
[QuizSessionProvider] updates local state (score, progress)
    |
    v
[After final question]
    |
    v
[useSubmitScore mutation] -> Supabase -> quiz_sessions table
    |
    v
[Results screen] shows score, explanations, option to share
```

### Multiplayer Flow

```
[Host creates room]
    |
    v
[Edge Function or direct insert] -> game_rooms table (status: 'lobby')
    |
    v
[Host gets room code] -> shares with players
    |
    v
[Players join via code]
    |
    v
[Supabase Realtime: Presence] -> all clients see player list
    |
    v
[Host starts game]
    |
    v
[Realtime Broadcast] -> all clients receive "game_started" + question set
    |
    v
[Each player answers locally] -> submit via mutation
    |
    v
[Database trigger] -> aggregates votes into game_scores (hides individual answers)
    |
    v
[Realtime Broadcast] -> all clients receive round results
    |
    v
[Repeat per question] -> [Final scores broadcast] -> [Results screen]
```

### AI Pipeline Flow

```
[pg_cron: every 6 hours]
    |
    v
[Edge Function: check-pipeline-needs]
    |
    ├── Categories below threshold? -> enqueue category-generation job
    ├── Categories missing knowledge? -> enqueue knowledge-gathering job
    ├── Categories with < N questions? -> enqueue question-generation job
    └── Unverified questions exist? -> enqueue fact-check job
    |
    v
[pipeline_jobs table] (status: pending, type, payload, created_at)
    |
    v
[External scheduler: e.g., GitHub Actions cron, every 2 hours]
    |
    v
[Claude Code headless: `claude -p "..." --allowedTools ...`]
    |
    ├── Category Agent: reads pending category jobs
    │   -> proposes subcategories -> writes to categories table (status: draft)
    │   -> marks job complete
    │
    ├── Knowledge Agent: reads pending knowledge jobs
    │   -> gathers reference material -> writes to category_knowledge table
    │   -> marks job complete
    │
    ├── Questions Agent: reads pending question jobs
    │   -> generates questions + answers + explanations
    │   -> writes to questions table (status: draft)
    │   -> marks job complete
    │
    └── Fact-Check Agent: reads pending fact-check jobs
        -> independently verifies answers
        -> updates questions (status: verified | rejected, verification_notes)
        -> marks job complete
```

### State Management

```
┌─────────────────────────────────────────────┐
│              State Architecture              │
│                                              │
│  ┌─────────────────────┐                     │
│  │   TanStack Query    │ ← Server state      │
│  │   (questions,       │   (cached, synced)   │
│  │    categories,      │                     │
│  │    scores, profile) │                     │
│  └──────────┬──────────┘                     │
│             │ invalidateQueries              │
│  ┌──────────┴──────────┐                     │
│  │  Supabase Realtime  │ ← Trigger only      │
│  │  (multiplayer,      │   (no direct state)  │
│  │   pipeline updates) │                     │
│  └─────────────────────┘                     │
│                                              │
│  ┌─────────────────────┐                     │
│  │   React Context     │ ← UI state only     │
│  │   (quiz progress,   │   (ephemeral)        │
│  │    theme, answers)  │                     │
│  └─────────────────────┘                     │
│                                              │
│  ┌─────────────────────┐                     │
│  │   expo-sqlite       │ ← Offline cache     │
│  │   (questions,       │   (read-through)     │
│  │    categories)      │                     │
│  └─────────────────────┘                     │
└─────────────────────────────────────────────┘
```

### Key Data Flows

1. **Question fetch:** Component -> TanStack Query hook -> (cache hit? serve) -> Supabase REST -> PostgreSQL (RLS filtered) -> cache + render. Offline fallback: expo-sqlite.
2. **Quiz submission:** Local state accumulates answers -> mutation hook -> Supabase insert -> triggers score calculation -> invalidates leaderboard queries.
3. **Multiplayer sync:** Broadcast channel per room -> all state changes pushed to all clients -> each client processes locally -> submit answers individually -> aggregated results broadcast.
4. **Pipeline content:** Cron -> Edge Function -> job queue -> Claude Code agent -> writes to DB (draft status) -> Fact-Check Agent promotes to verified -> new questions appear in client queries on next fetch.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-1k users | Supabase free/pro tier handles everything. Single PostgreSQL instance. SQLite cache optional but nice for UX. Pipeline runs a few times daily. |
| 1k-100k users | Enable Supabase connection pooling (PgBouncer). Add indexes on questions by category+status+difficulty. Increase pipeline frequency for popular categories. Consider Supabase CDN for static assets. |
| 100k+ users | Supabase Enterprise or migrate to dedicated Postgres. Read replicas for question serving (read-heavy workload). Consider pre-computing daily challenges. Rate-limit multiplayer room creation. Question cache at CDN edge. |

### Scaling Priorities

1. **First bottleneck: Question query performance.** This is a read-heavy app. Add composite index on `(category_slug, status, difficulty)` from day one. With proper indexes and RLS, PostgreSQL handles this well to ~50k users on Supabase Pro.
2. **Second bottleneck: Multiplayer Realtime connections.** Each active multiplayer room holds open WebSocket connections. Supabase Realtime has connection limits per project. At scale, limit concurrent rooms or batch game state updates. This is a later concern -- multiplayer is not MVP.
3. **Third bottleneck: Pipeline throughput.** As categories grow, the pipeline needs to generate more content. Solution: parallelize agent runs (multiple Claude Code instances) and prioritize popular categories.

## Anti-Patterns

### Anti-Pattern 1: Supabase Realtime as State Manager

**What people do:** Use Realtime subscriptions to directly update component state, creating a parallel state management system alongside TanStack Query.
**Why it's wrong:** Dual state sources cause sync bugs, stale data, and make offline behavior unpredictable. Realtime has no built-in cache or retry semantics.
**Do this instead:** Realtime triggers `queryClient.invalidateQueries()`. TanStack Query remains the single source of truth for all server data. Realtime is a notification mechanism, not a state store.

### Anti-Pattern 2: Fat Route Files

**What people do:** Put business logic, data fetching, and complex UI directly in Expo Router route files.
**Why it's wrong:** Route files become untestable monoliths. Expo Router may re-mount routes on navigation, causing unexpected refetches and state loss.
**Do this instead:** Route files are thin orchestrators: import a page component, wrap with providers if needed, pass route params. All logic lives in hooks, services, and components.

### Anti-Pattern 3: Storing Quiz Session State on Server

**What people do:** Write every answer to Supabase as the user plays, treating the server as the source of truth for in-progress quizzes.
**Why it's wrong:** Creates unnecessary network dependency during gameplay. Adds latency between questions. Breaks offline play entirely.
**Do this instead:** Quiz session state lives in React Context (or a local state machine) during play. Only the final result is submitted to Supabase. For multiplayer, individual answers go through Realtime Broadcast, not database writes per answer.

### Anti-Pattern 4: Single Monolith Agent

**What people do:** Build one AI agent that handles all pipeline tasks (categories + knowledge + questions + fact-checking).
**Why it's wrong:** Single point of failure. Context window bloat. Can't run steps in parallel. A failure in fact-checking blocks question generation.
**Do this instead:** Four independent agents with clear boundaries. Each reads from and writes to specific tables. Pipeline jobs table acts as the coordination mechanism. Agents can run independently and at different frequencies.

### Anti-Pattern 5: Client-Side Category Tree Computation

**What people do:** Fetch all categories and build the tree hierarchy in the client.
**Why it's wrong:** As the category tree grows (hundreds to thousands of nodes), this becomes slow and memory-intensive on mobile devices.
**Do this instead:** Store categories with a `parent_id` column and use PostgreSQL recursive CTEs or `ltree` extension for tree queries. Fetch only the current level + immediate children. Breadcrumb path can be a materialized column.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Supabase | Client SDK (singleton) | Initialize once in `lib/supabase.ts`. Use `@supabase/supabase-js`. Auto-refresh tokens. |
| Claude API (via agents) | Claude Code CLI headless mode | Agents run as `claude -p "prompt" --allowedTools supabase-mcp` or similar. Not called from client. |
| Expo EAS | Build and deploy pipeline | `eas build`, `eas submit`, `eas update` for OTA updates. |
| Expo Notifications | Push notifications for daily challenge | `expo-notifications` + Supabase Edge Function to trigger. Defer to later phase. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Client <-> Supabase | REST (PostgREST) + WebSocket (Realtime) | All through Supabase Client SDK. RLS enforces security. |
| Edge Functions <-> PostgreSQL | Direct Postgres connection (via Supabase client in Deno) | Edge Functions can bypass RLS with service role key for pipeline operations. |
| Agents <-> PostgreSQL | Supabase REST API or MCP server | Agents authenticate with service role key. Read pipeline_jobs, write content tables. |
| Agents <-> Each other | No direct communication | Coordination through pipeline_jobs table only. Each agent is independent. |
| Offline cache <-> Server state | Sync service (background) | On connectivity change or app foreground, sync popular categories. |

## Build Order (Dependencies)

The following build order reflects real technical dependencies:

1. **Database schema + RLS policies** -- Everything depends on this. Categories, questions, users, sessions tables. RLS from day one.
2. **Supabase Auth (anonymous)** -- Required before any data access (RLS depends on auth).
3. **Supabase client singleton + TanStack Query setup** -- Foundation for all data access.
4. **Category tree (schema + queries + UI)** -- Questions belong to categories; can't build question UI without categories.
5. **Questions display + quiz engine** -- Core gameplay loop. Can seed with manual questions initially.
6. **AI pipeline (agents + job queue)** -- Can be developed in parallel with UI once schema exists. Replaces manual question seeding.
7. **Offline cache (expo-sqlite)** -- Enhancement layer on top of working online flow.
8. **Daily challenge** -- Requires questions + scheduling (pg_cron).
9. **Multiplayer (Realtime)** -- Requires working quiz engine + auth. Most complex client feature.
10. **Leaderboards + profiles** -- Requires account upgrade flow + score history.

## Sources

- [Supabase Expo React Native Quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/expo-react-native)
- [Expo Documentation: Using Supabase](https://docs.expo.dev/guides/using-supabase/)
- [Supabase Edge Functions Architecture](https://supabase.com/docs/guides/functions/architecture)
- [Processing Large Jobs with Edge Functions, Cron, and Queues](https://supabase.com/blog/processing-large-jobs-with-edge-functions)
- [Supabase Cron (pg_cron)](https://supabase.com/docs/guides/cron)
- [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Expo Router Core Concepts](https://docs.expo.dev/router/basics/core-concepts/)
- [Expo App Folder Structure Best Practices](https://expo.dev/blog/expo-app-folder-structure-best-practices)
- [Supabase Realtime Multiplayer Features](https://supabase.com/blog/supabase-realtime-with-multiplayer-features)
- [Supaquiz: Multiplayer Quiz with Supabase](https://github.com/yallurium/supaquiz)
- [Multiplayer Quiz Game with Supabase (DevelopersIO)](https://dev.classmethod.jp/en/articles/vercel-supabase-realtime-multiplayer-quiz-game/)
- [Expo SQLite Guide for Offline-First Apps](https://medium.com/@aargon007/expo-sqlite-a-complete-guide-for-offline-first-react-native-apps-984fd50e3adb)
- [Expo Local-First Architecture Guide](https://docs.expo.dev/guides/local-first/)
- [Offline-First Expo App with Drizzle ORM and SQLite](https://medium.com/@detl/building-an-offline-first-production-ready-expo-app-with-drizzle-orm-and-sqlite-f156968547a2)
- [TanStack Query + Supabase Integration](https://makerkit.dev/blog/saas/supabase-react-query)
- [Claude Code Headless Mode (Programmatic)](https://code.claude.com/docs/en/headless)
- [Claude Code Scheduled Tasks Guide](https://claudefa.st/blog/guide/development/scheduled-tasks)

---
*Architecture research for: Cross-platform pub quiz app with AI content pipeline*
*Researched: 2026-04-04*
