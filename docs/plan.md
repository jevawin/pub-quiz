# Pub Quiz App — Project Plan

## Context
Building a clean, ad-free pub quiz app with a large AI-generated question database. The app runs on iOS, Android, and Web from a single codebase. A pipeline of Claude-powered agents runs autonomously in the cloud to continuously build and verify a question database.

## Decisions Made
- **Frontend**: React Native + Expo (cross-platform: iOS, Android, Web)
- **Backend**: Supabase (PostgreSQL + Auth + Edge Functions)
- **Agent Pipeline**: Claude Code Remote Triggers (runs on Anthropic's cloud, no infra needed)
- **Design Tools**: Google Stitch or Figma
- **Auth**: Anonymous-first, optional account creation
- **Difficulty**: Agent-assigned initially, refined by crowd data over time
- **Multiplayer**: Both join-via-code and shared-screen/pass-and-play modes
- **Features**: Solo play, multiplayer, daily challenge, custom quiz builder

---

## Phase 1: Foundation (Supabase Schema + Agent Pipeline)
*Goal: Get questions accumulating in the DB while we build the app.*

### 1A: Supabase Schema Design
Set up the database tables and relationships:

```
categories
  id, name, slug, parent_id (nullable, for subcategories), description, icon, created_at

knowledge_sources
  id, category_id (nullable — null = general), url, title, content_summary, 
  source_type (wikipedia, article, reference), status (pending, processed, failed), created_at

questions
  id, text, answer, explanation, difficulty_agent (1-5), difficulty_crowd (nullable float),
  times_answered (int, default 0), times_correct (int, default 0),
  verification_strength (0-3), status (draft, verified, published, rejected),
  created_at, updated_at

question_categories (many-to-many)
  question_id, category_id

question_wrong_answers (for multiple choice)
  id, question_id, text, is_plausible_rank (1-3)

question_sources (verification trail)
  id, question_id, knowledge_source_id, verification_note

daily_challenges
  id, date (unique), question_ids (array), theme_description
```

Row-level security: public read for published questions, service-role write for agents.

### 1B: Agent Pipeline — Claude Code Remote Triggers
Four agents, each a scheduled remote trigger, staggered:

**1. Category Agent** (runs daily at 00:00 UTC)
- Reads existing categories from Supabase
- Researches trending/interesting quiz themes online
- Proposes new categories or subcategories
- Inserts new categories with status metadata
- Seed with ~12 core themes: Science, History, Geography, Movies & TV, Music, Gaming, Sports, Food & Drink, Literature, Art & Design, Technology, Nature & Animals

**2. Knowledge Agent** (runs every 6h, offset: +2h from category)
- Picks categories that have few knowledge sources
- Searches for quality reference material (Wikipedia, educational sites, notable lists)
- Summarises and stores sources in knowledge_sources table
- Labels each source as category-specific or general
- Targets breadth first, depth later

**3. Questions Agent** (runs every 6h, offset: +4h from category)
- Reads unprocessed knowledge sources
- Generates quiz questions with:
  - One correct answer
  - Three plausible wrong answers (for multiple choice)
  - A brief explanation of the answer
  - Agent-estimated difficulty (1-5)
  - Category assignments
- Inserts with status='draft', verification_strength=0
- Aims for variety: mix of factual, date-based, "who said", "which X", true/false

**4. Fact-Check Agent** (runs every 6h, offset: +6h from category)  
- Picks draft questions with verification_strength < 3
- For each question, searches for independent sources that confirm the answer
- Each confirming source increments verification_strength (max 3)
- 1 source = weak, 2 = medium, 3 = strong → status='verified'
- If conflicting info found → status='rejected' with note
- Links sources in question_sources table

**Staggered schedule (UTC)**:
- 00:00 — Category Agent
- 02:00, 08:00, 14:00, 20:00 — Knowledge Agent
- 04:00, 10:00, 16:00, 22:00 — Questions Agent  
- 06:00, 12:00, 18:00, 00:00 — Fact-Check Agent

Each trigger prompt includes the Supabase URL + service role key and uses curl/scripts to interact with the DB.

### 1C: Claude Skills (local development agents)
Build reusable Claude skills in `.claude/skills/` for local development use:
- `generate-questions` — manually trigger question generation for a specific category
- `audit-questions` — review question quality, flag duplicates, check answer accuracy
- `seed-category` — bootstrap a new category with initial knowledge + questions

---

## Phase 2: App Foundation (React Native + Expo)
*Goal: App shell with navigation, design system, and question display.*

### 2A: Project Setup
- `npx create-expo-app pub-quiz --template tabs` (Expo Router with tabs)
- TypeScript, ESLint, Prettier
- Expo Router for file-based navigation (works on all platforms)
- `@supabase/supabase-js` for data access

### 2B: Design System
- Design in Stitch or Figma first
- Implement as reusable components: `QuestionCard`, `AnswerButton`, `CategoryChip`, `ScoreDisplay`, `Timer`
- Light/dark mode from the start
- No ads, no gamification bloat — clean, readable typography, generous spacing

### 2C: Core Screens
1. **Home** — Featured categories, daily challenge entry, quick play
2. **Category Browser** — Grid/list of categories with icons, question counts
3. **Quiz Play** — Question display, answer selection, timer (optional), score tracking
4. **Results** — Score summary, correct/incorrect review, share option
5. **Profile** (optional account) — Stats, streaks, history

### 2D: Supabase Client Integration
- Anonymous session on first launch (Supabase anon key)
- Fetch published questions by category, difficulty, count
- Cache questions locally for offline play (AsyncStorage or expo-sqlite)
- Optional sign-up flow to persist progress across devices

---

## Phase 3: Gameplay Features

### 3A: Solo Play
- Select category + difficulty + question count
- Timed or untimed mode
- Score tracking with personal bests
- Streak counter (consecutive correct answers)

### 3B: Daily Challenge
- Curated set of 10 questions across mixed categories
- Same questions for all users each day
- Generated by a dedicated Daily Challenge Agent (or an Edge Function that picks from verified questions)
- Leaderboard (requires account)

### 3C: Multiplayer — Join via Code (Kahoot-style)
- Host creates a room → gets a 6-character code
- Players join on their own devices
- Real-time sync via Supabase Realtime (WebSocket channels)
- Host controls pace (next question), everyone sees results live
- Scoreboard between rounds

### 3D: Multiplayer — Shared Screen
- One device acts as the display
- Players buzz in or take turns
- Simpler implementation — no networking, just local state
- Great for actual pub settings with a TV/projector

### 3E: Custom Quiz Builder
- Pick categories, difficulty range, question count
- Save custom quizzes for reuse
- Share quiz configs via link/code

---

## Phase 4: Polish & Launch

### 4A: Crowd Difficulty Calibration
- Track `times_answered` and `times_correct` per question
- Compute `difficulty_crowd = 1 - (times_correct / times_answered)` scaled to 1-5
- Blend with agent difficulty: weight shifts toward crowd as sample size grows

### 4B: Offline Support
- Cache question packs for offline play
- Sync scores when back online

### 4C: Platform-Specific Polish
- iOS: Haptic feedback, native share sheet
- Android: Material You theming, back gesture handling
- Web: Responsive layout, keyboard shortcuts, SEO for daily challenge

### 4D: App Store Submission
- iOS App Store + Google Play Store + Web deployment (Expo EAS)
- Privacy policy (minimal data collection — no ads, no tracking)

---

## Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Frontend | React Native + Expo (TypeScript) |
| Navigation | Expo Router |
| Backend | Supabase (PostgreSQL, Auth, Realtime, Edge Functions) |
| Agent Pipeline | Claude Code Remote Triggers |
| Build/Deploy | Expo EAS (iOS/Android builds + web deploy) |
| Design | Google Stitch or Figma |
| State Management | React Context + React Query (TanStack Query) for server state |
| Offline Cache | expo-sqlite or AsyncStorage |

---

## Immediate Next Steps (what we build in this session)
1. Initialize the Expo project with TypeScript + Expo Router
2. Set up Supabase project and create the schema (SQL migration)
3. Create the 4 agent trigger prompts and schedule them as Remote Triggers
4. Create local Claude skills for manual question management
5. Write CLAUDE.md with all project conventions
