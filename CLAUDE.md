<!-- GSD:project-start source:PROJECT.md -->
## Project

**Pub Quiz**

A clean, beautifully designed pub quiz app with a massive AI-generated question database spanning deeply nested categories — from general knowledge down to niche topics like Quidditch. Runs on iOS, Android, and Web from a single React Native + Expo codebase. A pipeline of Claude-powered agents continuously builds, verifies, and expands the question library autonomously.

**Core Value:** Great questions delivered through a clean, effortless interface — the content is the star, not the chrome around it.

### Constraints

- **Tech stack**: React Native + Expo (cross-platform), Supabase (PostgreSQL + Auth + Realtime + Edge Functions), Claude Code Remote Triggers (agent pipeline)
- **Design tools**: Google Stitch or Figma for UI design, component.gallery for pattern inspiration
- **State management**: React Context + TanStack Query for server state
- **Offline cache**: expo-sqlite or AsyncStorage
- **Build/Deploy**: Expo EAS
- **Auth model**: Anonymous-first, optional account creation for persistence
- **Difficulty**: Agent-assigned initially, refined by crowd data over time
- **Monetization**: TBD — requires research. Quality app > revenue. Options under consideration: paid app (£2.99), freemium with packs/subscription (£1/mo), pay-per-pack, or minimal non-intrusive ads
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Expo SDK | 55 | App framework, build tooling, native APIs | The standard for cross-platform React Native. SDK 55 (Feb 2026) ships React Native 0.83 with React 19.2. Managed workflow eliminates native config. EAS handles builds/submissions. No reason to eject. |
| React Native | 0.83 (via Expo 55) | Cross-platform UI runtime | Bundled with Expo 55. New Architecture enabled by default. Do not pin separately -- Expo manages this. |
| Expo Router | 4.x (via Expo 55) | File-based navigation | Ships with Expo 55. File-based routing with typed routes, deep linking, guarded groups for auth flows, and web SSR support. Replaces manual React Navigation config. |
| Supabase | 2.101.x (supabase-js) | Backend-as-a-service: PostgreSQL, Auth, Realtime, Edge Functions, Storage | All-in-one backend eliminates custom server code. Row-level security for auth. Realtime Broadcast + Presence for multiplayer. Edge Functions for server logic. PostgREST v14 delivers ~20% throughput improvement. |
| TypeScript | 5.x (via Expo) | Type safety | Non-negotiable for a codebase this size. Expo 55 ships TypeScript support out of the box. |
### State Management
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Zustand | 5.0.12 | Client state (quiz session, UI state, user preferences) | Replaces React Context for client state. Selective subscriptions prevent re-render cascades. 2KB, zero boilerplate, works perfectly with React Native. The PROJECT.md suggests React Context but Zustand is the better choice -- Context causes unnecessary re-renders in quiz flows where answer state changes frequently. |
| TanStack Query | 5.96.x (@tanstack/react-query) | Server state (questions, categories, leaderboards) | Caching, background refetching, optimistic updates, offline support. Handles all Supabase data fetching. The right tool for server state -- do not put API data in Zustand. |
### Storage & Offline
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| expo-sqlite | 55.0.x | Offline question cache, category tree | Questions have relational structure (question -> answers, question -> categories). SQLite handles complex queries (e.g., "give me 10 medium-difficulty Science questions I haven't seen"). expo-sqlite ships with Expo, zero config. |
| react-native-mmkv | 4.3.0 | Key-value storage (preferences, auth tokens, small state) | 30x faster than AsyncStorage for simple reads/writes. Use for user preferences, session tokens, feature flags. Do NOT use for question data -- it has no query capabilities. |
### Styling & Design
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| NativeWind | 4.1.x | Utility-first styling (Tailwind CSS for React Native) | Production-stable as of 4.1. Consistent cross-platform styling. Utility classes keep component files clean. Supports animations, media queries, dark mode. Perfect for the editorial design system -- typography scales and spacing tokens map directly to Tailwind config. |
| expo-font | 55.x | Custom typography | Config plugin embeds fonts at build time (no async loading flicker). Critical for the editorial/typographic design philosophy. Use Inter or a similar high-quality sans-serif as the base; a serif for accent headings. |
### Animation
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| react-native-reanimated | 4.3.0 | Core animation engine (UI thread animations) | Runs on UI thread at 120fps. Required for gesture-driven interactions (swiping answers, transitions). Reanimated 4.x requires New Architecture (which Expo 55 enables by default). |
### Realtime & Multiplayer
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Supabase Realtime (Broadcast) | via supabase-js | Multiplayer quiz synchronization | Sub-100ms latency. Ephemeral messages for quiz events (question reveal, answer submission, timer sync). No additional infrastructure. |
| Supabase Realtime (Presence) | via supabase-js | Player tracking in lobbies | Shows who's in a quiz room, handles join/leave. Built into the same channel as Broadcast. |
### AI Agent Pipeline
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Claude Code Scheduled Tasks | Current | Autonomous question generation pipeline | Cloud-based cron scheduling runs agents against your repo on Anthropic's infrastructure. No self-hosted infra needed. Supports the 4-agent pipeline (Category, Knowledge, Questions, Fact-Check). |
| Supabase Edge Functions | via Supabase | Agent-to-database bridge | Agents call Edge Functions to write generated questions to PostgreSQL. Edge Functions validate and sanitize before insertion. Keeps the database interaction server-side. |
### Build & Deploy
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Expo EAS Build | Current | Cloud builds for iOS/Android | Handles signing, building, and submitting to stores. No local Xcode/Android Studio needed for CI. |
| Expo EAS Update | Current | OTA updates | Push JS bundle updates without store review. Critical for fixing quiz bugs quickly. |
| Expo EAS Submit | Current | App store submission | Auto-submit successful builds to App Store / Google Play. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| expo-secure-store | 55.x | Encrypted storage for auth tokens | Always -- store Supabase JWT tokens here, not in MMKV or AsyncStorage |
| expo-haptics | 55.x | Tactile feedback | On correct/incorrect answer reveal. Subtle, not gamified. |
| expo-image | 55.x | Optimized image loading | Category images, any visual questions. Replaces react-native Image. |
| expo-splash-screen | 55.x | Splash screen control | Hold splash until fonts + initial data loaded. |
| expo-constants | 55.x | App config/environment variables | Access Supabase URL, API keys at runtime. |
| date-fns | 4.x | Date manipulation | Daily challenge date logic, leaderboard time windows. Lightweight, tree-shakeable. |
| zod | 3.x | Runtime validation | Validate Supabase responses, form inputs, agent-generated question data. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| Expo Dev Client | Development builds with native modules | Required for MMKV and Reanimated during dev |
| TypeScript strict mode | Catch bugs at compile time | Enable `strict: true` in tsconfig |
| ESLint + Prettier | Code consistency | Use expo's built-in ESLint config as base |
| Supabase CLI | Local development, migrations, type generation | `supabase gen types typescript` generates DB types from schema |
## Installation
# Create project
# Core dependencies
# State & data
# Storage
# Styling
# Utilities
# Dev dependencies
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Zustand | React Context (PROJECT.md suggestion) | Never for this app. Context re-renders all consumers on any state change. Quiz UI has frequent state updates (timers, selections, scores). Zustand's selective subscriptions are essential. |
| Zustand | Jotai | If you prefer atomic state (individual atoms vs stores). Both are fine; Zustand has larger ecosystem and more React Native examples. |
| expo-sqlite | WatermelonDB | If you need automatic sync between local SQLite and a remote database. Overkill here -- TanStack Query handles sync. |
| expo-sqlite | Drizzle ORM + expo-sqlite | If the team prefers typed SQL over raw queries. Worth evaluating in Phase 1 -- adds type-safe queries but another dependency. |
| NativeWind | Tamagui | If you want a full component library with built-in animations. NativeWind is lighter and gives more design control for a custom editorial aesthetic. |
| NativeWind | StyleSheet.create (vanilla) | Never for this project. Manual styles bloat component files and make design system consistency harder. |
| Supabase | Firebase | If you need ML Kit, Analytics, or Crashlytics built-in. Supabase's PostgreSQL + RLS + Edge Functions are better for this domain. Firebase's NoSQL (Firestore) is a poor fit for relational question data. |
| Claude Code Scheduled Tasks | GitHub Actions + Claude API | If scheduled tasks remain unstable. GitHub Actions is a reliable cron alternative. Agents run as scripts calling the Anthropic API. More setup, more control. |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| AsyncStorage | Deprecated in spirit. Slow, synchronous bridge, no encryption. | react-native-mmkv for KV, expo-sqlite for structured data |
| Moti | Last updated 12+ months ago (v0.30.0). Likely abandoned. Depends on Reanimated but may break with Reanimated 4.x. | react-native-reanimated directly (v4.3.0) |
| React Navigation (manual setup) | Expo Router wraps React Navigation with file-based routing. Manual setup is unnecessary boilerplate. | expo-router (file-based, typed routes) |
| Redux / Redux Toolkit | Massive boilerplate for what this app needs. Actions, reducers, selectors -- all unnecessary when Zustand does it in 5 lines. | Zustand |
| Styled Components / Emotion | Runtime CSS-in-JS has performance overhead in React Native. Not utility-first. | NativeWind (compile-time, utility-first) |
| Realm | Heavy native dependency, complex setup, MongoDB-specific sync. | expo-sqlite (lighter, Expo-native, SQL queries) |
| Socket.IO / custom WebSockets | Building your own realtime layer when Supabase provides it for free. | Supabase Realtime (Broadcast + Presence) |
| NativeWind v5 | Pre-release, explicitly marked "not intended for production use". | NativeWind v4.1 (stable, production-ready) |
## Stack Patterns by Variant
- Supabase Broadcast may not suffice -- consider a dedicated WebSocket server (e.g., Hono on Cloudflare Workers)
- For this app's quiz format (turn-based, not twitch), Supabase Broadcast's sub-100ms is more than adequate
- expo-sqlite local cache needs pagination strategy -- don't load entire DB onto device
- Prefetch by category on demand, cache recent 1000 questions
- Server-side: PostgreSQL with proper indexes handles millions of rows without issue
- Add a sync layer: download question packs to expo-sqlite
- Track answered-question IDs locally, sync to server when online
- TanStack Query's `networkMode: 'offlineFirst'` handles this pattern
- Supabase RLS can gate premium content per user subscription tier
- Use RevenueCat for IAP/subscription management (adds ~$0 until revenue, then %)
- Do NOT build your own subscription validation -- App Store/Play Store rules are complex
## Version Compatibility
| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Expo SDK 55 | React Native 0.83, React 19.2 | Always use `npx expo install` to get compatible versions |
| react-native-reanimated 4.x | Expo SDK 55 (New Architecture required) | Does NOT work with old architecture. Expo 55 enables New Architecture by default. |
| NativeWind 4.1 | Tailwind CSS 3.x | Do NOT use Tailwind CSS 4.x -- NativeWind 4.1 is built on Tailwind 3.x |
| react-native-mmkv 4.x | Expo SDK 55 | Requires dev client (not Expo Go) |
| @tanstack/react-query 5.x | React 18+ | Compatible with React 19.2 in Expo 55 |
| Zustand 5.x | React 18+ | Compatible with React 19.2 in Expo 55 |
| supabase-js 2.x | Any JS runtime | Isomorphic, works in React Native without polyfills |
## Key Challenge: React Context vs Zustand
- Quiz screen re-renders when ANY context value changes (timer tick, score update, answer selection)
- Multiple nested providers for different state domains = "provider hell"
- No built-in devtools, no persistence middleware, no computed values
- Components subscribe to specific slices: `const score = useQuizStore(s => s.score)` -- only re-renders when score changes
- Single store, no providers needed
- Built-in `persist` middleware works with MMKV for state persistence across sessions
- 2KB gzipped -- barely heavier than using Context
## Sources
- [Expo SDK 55 changelog](https://expo.dev/changelog) -- SDK version, React Native 0.83 confirmation (HIGH confidence)
- [Expo Router docs](https://docs.expo.dev/router/introduction/) -- file-based routing, guarded groups (HIGH confidence)
- [supabase-js npm](https://www.npmjs.com/package/@supabase/supabase-js) -- v2.101.1 confirmed (HIGH confidence)
- [Supabase Realtime docs](https://supabase.com/docs/guides/realtime) -- Broadcast + Presence features (HIGH confidence)
- [TanStack Query npm](https://www.npmjs.com/package/@tanstack/react-query) -- v5.96.2 confirmed (HIGH confidence)
- [Zustand npm](https://www.npmjs.com/package/zustand) -- v5.0.12 confirmed (HIGH confidence)
- [react-native-reanimated npm](https://www.npmjs.com/package/react-native-reanimated) -- v4.3.0, New Architecture required (HIGH confidence)
- [NativeWind v4.1 announcement](https://www.nativewind.dev/blog/announcement-nativewind-v4-1) -- production-ready confirmation (HIGH confidence)
- [react-native-mmkv npm](https://www.npmjs.com/package/react-native-mmkv) -- v4.3.0 confirmed (HIGH confidence)
- [Moti npm](https://www.npmjs.com/package/moti) -- v0.30.0, no updates in 12+ months (HIGH confidence, abandonment flag)
- [Claude Code Scheduled Tasks docs](https://code.claude.com/docs/en/scheduled-tasks) -- cloud scheduling feature (MEDIUM confidence -- API stability issues reported)
- [Claude Code scheduled triggers bug](https://github.com/anthropics/claude-code/issues/43438) -- HTTP 500 errors on triggers API (HIGH confidence -- active issue)
- [Supabase PostgREST v14](https://github.com/orgs/supabase/discussions/41796) -- 20% throughput improvement (MEDIUM confidence)
- [NativeWind v5 docs](https://www.nativewind.dev/v5) -- pre-release, not for production (HIGH confidence)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
