# Pitfalls Research

**Domain:** AI-powered pub quiz / trivia app (React Native + Expo, Supabase, Claude agent pipeline)
**Researched:** 2026-04-04
**Confidence:** HIGH (core pitfalls well-documented across multiple sources)

## Critical Pitfalls

### Pitfall 1: AI-Generated Questions Ship Incorrect Answers

**What goes wrong:**
Claude (and all LLMs) hallucinate 3-18% of the time, and hallucinated content is often delivered with *higher* confidence language than accurate content. For trivia, this is catastrophic -- a single confidently wrong answer destroys user trust in the entire question bank. Users who spot a wrong answer assume all answers are suspect. Niche categories (deep subcategories like "Quidditch rules" or "17th century Dutch painters") are especially vulnerable because the model has less training data to draw from.

**Why it happens:**
LLMs are statistical prediction engines, not knowledge bases. They fill gaps with plausible-sounding fabrication. The four-agent pipeline (Category -> Knowledge -> Questions -> Fact-Check) can create a false sense of security -- the Fact-Check Agent uses the same type of model with the same fundamental limitations. One LLM checking another LLM is correlated failure, not independent verification.

**How to avoid:**
- The Fact-Check Agent must use retrieval-augmented generation (RAG) against authoritative sources, not just LLM parametric knowledge. Require the agent to cite a specific source URL for each verified answer.
- Assign a `verification_strength` score (0-1) to each question. Only surface questions above a threshold (e.g., 0.7) to users.
- For the first release, restrict to categories where verification is tractable (well-known facts, not obscure trivia). Expand depth after the pipeline is proven.
- Implement user reporting ("This answer is wrong") with a fast review loop. Flag reported questions immediately and remove from rotation until reviewed.
- Track per-category error rates. If a category's reported-wrong rate exceeds a threshold, pause question generation for that category.

**Warning signs:**
- No external source citations in the Fact-Check Agent's output
- Fact-Check Agent approving > 95% of questions (too permissive)
- User reports clustering in specific categories
- Questions about recent events (post-training-data cutoff) being generated

**Phase to address:**
Phase 1 (Agent Pipeline). This must be built into the pipeline from day one. Retrofitting verification is much harder than building it in.

---

### Pitfall 2: Supabase RLS Disabled or Misconfigured, Exposing the Entire Database

**What goes wrong:**
Row Level Security (RLS) is disabled by default on new Supabase tables. In January 2025, 170+ apps were found with fully exposed databases because developers forgot to enable RLS. For a quiz app, this means: anyone can read all questions (including answers), modify scores, impersonate users, or delete content. The questions table is your core IP -- exposing it trivially enables scraping.

**Why it happens:**
RLS is opt-in per table. Developers create tables, build features against them, everything works in development (SQL Editor bypasses RLS), and they never notice the gap. The second failure mode: enabling RLS but forgetting to create policies, which makes all queries return empty results with no error message -- so the app appears broken, and developers disable RLS "temporarily."

**How to avoid:**
- Create a migration checklist: every new table gets `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in the same migration that creates it. No exceptions.
- Write RLS policies before writing application code that touches the table.
- Test from the client SDK (anon key), never rely on SQL Editor testing alone.
- Questions table: users should only read questions (not answers) until they've submitted their response. Use a server-side function (Edge Function) to check answers rather than exposing the `correct_answer` column to the client.
- Index all columns referenced in RLS policies -- missing indexes are the top RLS performance killer.
- Use `security_invoker` (not `security_definer`) for functions unless specifically needed, and never expose security-definer functions in public schemas.

**Warning signs:**
- Tables without RLS in `pg_tables` where `rowsecurity = false`
- Application working in SQL Editor but returning empty results from client
- Supabase dashboard showing "RLS disabled" warnings (they flag this)
- Client-side code that reads `correct_answer` directly from the questions table

**Phase to address:**
Phase 1 (Database Schema). Establish the RLS pattern on the very first tables. Create a linting step or CI check that verifies RLS is enabled on all public tables.

---

### Pitfall 3: Anonymous-to-Authenticated User Migration Loses Data

**What goes wrong:**
Anonymous-first auth means users accumulate scores, quiz history, and preferences before creating an account. When they finally sign up, the anonymous session data must transfer seamlessly to their new authenticated identity. If this is handled incorrectly, users lose all progress -- the single worst UX failure for a freemium app trying to convert anonymous users to registered ones.

**Why it happens:**
Supabase's anonymous auth creates a real `auth.users` row with a UUID. When linking to an email/password identity, the user ID is preserved *if* you use `updateUser()` to link an identity rather than creating a new account. But many developers implement "sign up" as a fresh `signUp()` call, which creates a new user ID and orphans all the anonymous user's data. Edge cases compound: what if the user already has an account and tries to link an email that's taken?

**How to avoid:**
- Use Supabase's identity linking (`updateUser()`) exclusively for anonymous-to-authenticated conversion. Never call `signUp()` for users who are already anonymously authenticated.
- Enable "Manual Linking" in Supabase Auth settings (required for identity linking to work).
- Design all user-facing tables with `user_id` foreign keys from day one. When the anonymous user links an identity, the UUID stays the same, so all data follows automatically.
- Handle the "email already exists" edge case gracefully: prompt the user to sign in to their existing account, then offer to merge anonymous session data.
- Write integration tests that simulate the full anonymous -> play quiz -> sign up -> verify data persists flow.

**Warning signs:**
- Using `signUp()` anywhere in the "create account" flow for existing anonymous users
- No integration tests covering the anonymous-to-authenticated flow
- User complaints about lost progress after creating an account
- Foreign key design that doesn't use `auth.users.id` as the reference

**Phase to address:**
Phase 1 (Auth). The anonymous auth pattern must be correct from the start because it determines the entire user data model. Fixing this later requires data migrations.

---

### Pitfall 4: Question Deduplication Fails at Scale, Users See Repeats

**What goes wrong:**
With an AI pipeline continuously generating questions, semantic duplicates accumulate rapidly. "What is the capital of France?" and "Which city serves as France's capital?" are different strings but the same question. Users encountering repeats in a single session destroys the experience. This gets worse as users play more -- high-engagement users exhaust unique questions in their preferred categories faster than the pipeline generates them.

**Why it happens:**
Text-matching deduplication (exact or fuzzy string matching) misses semantic duplicates. The generation pipeline has no memory of what it previously created without explicit dedup infrastructure. At 10,000+ questions, manual review becomes impossible.

**How to avoid:**
- Generate and store embeddings for each question at creation time. Before inserting a new question, compute cosine similarity against existing questions in the same category. Reject above a threshold (e.g., 0.85 similarity).
- Supabase supports pgvector for vector similarity search -- use it.
- Track which questions each user has seen (a `user_question_history` table). Never serve a question the user has already answered.
- For the Daily Challenge, use a deterministic selection (e.g., seeded by date) so all users get the same questions, but ensure the selection draws from unseen questions for repeat daily players by supplementing with alternates.
- Monitor questions-per-category counts. Alert when a category is running low relative to user demand.

**Warning signs:**
- No embedding column on the questions table
- User-facing queries that don't filter by "not already seen"
- Categories with < 50 questions being served to active users
- Pipeline generating questions without checking existing inventory

**Phase to address:**
Phase 1 (Agent Pipeline + Database Schema). Embedding-based dedup must be part of the question insertion flow from the beginning. The `user_question_history` tracking should ship with the first playable quiz.

---

### Pitfall 5: Cross-Platform UI Breaks Silently on Web vs. Native

**What goes wrong:**
React Native + Expo targets iOS, Android, and Web from one codebase, but many components behave differently across platforms. Animations that look smooth on iOS stutter on Android. Touch handling differs. Web has no `SafeAreaView`. Navigation patterns that feel native on mobile feel wrong on web. The "editorial, minimal" design philosophy makes these differences *more* visible, not less -- when the UI is sparse, every misaligned element or janky transition stands out.

**Why it happens:**
Developers test primarily on one platform (usually iOS simulator) and assume the others match. Expo's web support uses react-native-web, which reimplements React Native primitives for the browser -- but coverage isn't 100%. Some libraries have no web support. Expo SDK upgrades can introduce cross-platform regressions, and React Native version mismatches cause build failures.

**How to avoid:**
- Test on all three platforms from the first week. Set up a CI matrix (iOS simulator, Android emulator, web browser) in EAS Build.
- Use `Platform.select()` and `.web.tsx` / `.native.tsx` file extensions for platform-specific code rather than runtime conditionals scattered throughout components.
- Stick to Expo's SDK-provided components over third-party libraries where possible -- they have the best cross-platform testing.
- For the editorial design: use `react-native-reanimated` for animations (better cross-platform consistency than Animated API). Use Expo's `expo-haptics` for native feedback (gracefully no-ops on web).
- Pin Expo SDK version and follow `expo install --check` strictly. Never manually override React or React Native versions.
- Consider web as a separate "good enough" experience rather than pixel-perfect parity. A responsive web layout is more important than matching the mobile app exactly.

**Warning signs:**
- Only testing on iOS simulator during development
- Third-party libraries without explicit web support in their docs
- Expo SDK upgrade without running full platform matrix tests
- Layout issues reported only by web or Android users

**Phase to address:**
Phase 1 (UI Foundation). Establish the cross-platform testing pipeline before building any UI. Every component should be verified on all platforms before merging.

---

### Pitfall 6: Supabase Realtime Costs Explode During Multiplayer

**What goes wrong:**
For the Kahoot-style multiplayer mode, every player subscribes to game state changes via Supabase Realtime. The cost scales as `changes x subscribers` -- a single insert with 100 subscribers triggers 100 "reads" (each subscriber's RLS policy is checked). At 10K concurrent premium players, Realtime costs alone can reach $11K/month. A viral moment or popular daily challenge could spike costs catastrophically.

**Why it happens:**
Developers build multiplayer using Postgres Changes (subscribe to table changes), which is the most expensive Realtime mode because every event is checked against every subscriber's RLS policy. Broadcast and Presence channels are much cheaper but less intuitive to use.

**How to avoid:**
- Use Supabase Broadcast (not Postgres Changes) for multiplayer game state. Broadcast sends messages directly to channel subscribers without touching the database or evaluating RLS. Write game results to the database only at game end.
- Use Presence for player join/leave tracking rather than polling a "players" table.
- Debounce state updates. In a quiz, state changes are discrete (question revealed, answer submitted, scores updated) -- batch them rather than streaming continuously.
- Set up Supabase cost alerts. Model expected costs before launching multiplayer: `(avg_players_per_game * avg_games_per_day * messages_per_game * cost_per_message)`.
- Consider multiplayer as a later phase with its own cost validation. Don't architect the whole app around Realtime if solo play is the primary mode.

**Warning signs:**
- Multiplayer prototype using `supabase.channel().on('postgres_changes', ...)` for game state
- No cost modelling before multiplayer launch
- Realtime usage spiking on the Supabase dashboard during testing
- Game state updates firing on every keystroke or timer tick

**Phase to address:**
Late phase (Multiplayer). Do not build multiplayer in Phase 1. Solo play and the question pipeline are the priority. When multiplayer ships, it needs its own cost analysis and architecture review.

---

### Pitfall 7: Difficulty Calibration Creates a Frustration Cliff

**What goes wrong:**
AI-assigned difficulty ratings are unreliable because "difficulty" is subjective and audience-dependent. A question rated "Medium" by the model might be trivially easy for a subject expert or impossibly hard for a casual player. If the app surfaces questions at the wrong difficulty, casual users churn (too hard) or enthusiasts get bored (too easy). The project plan mentions "crowd-sourced difficulty calibration" but this chicken-and-egg problem means early users get the worst experience.

**Why it happens:**
LLMs estimate difficulty based on how obscure the knowledge is in their training data, not based on actual human performance. There's no ground truth until real users answer questions. Early-stage apps have no crowd data, so they rely entirely on AI estimates which are systematically biased.

**How to avoid:**
- Treat AI-assigned difficulty as a rough initial estimate (display as a range, not a precise level).
- Implement Elo-style or Item Response Theory (IRT) calibration: each question gets a difficulty score that adjusts based on actual answer rates. After ~30 responses, the crowd-calibrated score replaces the AI estimate.
- For launch, bias toward "easier" questions in quick play. Users who find questions too easy are less likely to churn than users who find them too hard.
- Show difficulty as a relative indicator ("Easier" / "Harder") rather than an absolute scale until calibration data exists.
- In custom quiz builder, let users set difficulty preference as a spectrum, not discrete levels.

**Warning signs:**
- Displaying "Easy / Medium / Hard" labels backed only by AI estimates
- No tracking of per-question answer rates
- User feedback mentioning "questions are too hard" or "too random"
- No mechanism to update difficulty after launch

**Phase to address:**
Phase 1 (Data Model) for the schema; Phase 2 (Quiz Play) for the initial UI; ongoing calibration as a background process once users are playing.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Storing correct answer in same row as question, exposed to client | Simple queries | Users can inspect network tab to see answers before responding | Never -- use an Edge Function to check answers server-side |
| Skipping embeddings for dedup, using text matching only | Faster pipeline setup | Semantic duplicates accumulate, eventually thousands of near-identical questions | MVP only if question count < 500, must add embeddings before scaling |
| Using AsyncStorage for offline cache | Quick to implement | 6MB limit on Android, no query capability, no migration path | Acceptable for settings/preferences; use expo-sqlite for question cache |
| Hardcoding category tree in the app | No API call needed | Every category change requires an app update | Never -- categories are dynamic, fetch from Supabase |
| Single "difficulty" integer column (1-5) | Simple schema | Cannot capture calibration data, confidence intervals, or per-audience difficulty | MVP only, must migrate to calibration model before crowd-sourcing |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Supabase Auth (Anonymous) | Calling `signUp()` for anonymous users who want to create an account | Use `updateUser()` with identity linking to preserve the anonymous user's UUID |
| Supabase Edge Functions | Returning the Supabase service role key to the client in error responses | Use environment variables in Edge Functions; never log or return the service key |
| Claude API (Agent Pipeline) | No rate limiting or cost controls on agent runs | Set per-agent daily spend caps; use Remote Trigger schedules to control frequency |
| Supabase Realtime | Subscribing to Postgres Changes for high-frequency multiplayer updates | Use Broadcast channels for game state; reserve Postgres Changes for low-frequency admin events |
| pgvector (Question Embeddings) | Computing embeddings at query time for similarity search | Pre-compute and store embeddings at question insertion; index with HNSW for fast approximate search |
| Expo EAS Build | Building for all platforms on every commit | Build web on every push (fast); build native only on release branches or manually (slow, costs build minutes) |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unindexed RLS policy columns | Queries slow down as tables grow; quiz loading takes > 1s | Add indexes on all columns used in RLS `USING` clauses | > 10K rows in questions table |
| Fetching full category tree on every app open | Slow cold start, unnecessary bandwidth | Cache category tree locally with a `last_updated` timestamp; refresh only on change | > 200 categories |
| N+1 queries in category browsing | Each subcategory triggers a separate query to count questions | Use a materialized view or `question_count` column updated by trigger | > 50 categories with nested children |
| Loading all questions for a quiz upfront | Memory spike, slow quiz start | Fetch questions one at a time or in small batches (5-10) | > 50 questions per quiz session |
| No pagination on leaderboards | Query scans entire scores table | Use keyset pagination (cursor-based, not OFFSET) | > 1K users with scores |
| Realtime subscriptions not cleaned up | Memory leaks, phantom subscriptions accumulating | Unsubscribe in component cleanup / navigation listeners | After navigating away from multiplayer 10+ times |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Exposing `correct_answer` column to client via Supabase API | Users inspect network requests to cheat | Create a `check_answer` Edge Function; RLS policy hides `correct_answer` from `anon` and `authenticated` roles |
| No rate limiting on answer submission | Brute-force all multiple choice options (only 4 choices) | Rate limit to 1 submission per question per user; server-side answer checking with cooldown |
| Leaderboard score manipulation | Users POST fake scores directly to Supabase | Calculate scores server-side in Edge Functions; never trust client-submitted scores |
| Anonymous user enumeration | Attackers discover how many anonymous users exist | Don't expose user counts; RLS policies should prevent listing other users |
| Agent pipeline keys in client code | API keys for Claude or admin Supabase operations leaked | Agent pipeline runs server-side only (Remote Triggers); client never touches agent infrastructure |
| Daily Challenge answers leaked via timezone exploitation | Users in earlier timezones share answers | Generate Daily Challenge questions server-side with timezone-aware unlock; or accept this as a social feature |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing "Loading..." for every question | Breaks flow; quiz feels slow and disconnected | Prefetch next 2-3 questions while current one is displayed; show skeleton only on first load |
| Deep category tree requires too many taps to start playing | Users abandon before reaching a quiz | "Quick Play" as the primary action (zero taps to start); category browsing is secondary exploration |
| Explanation shown before user processes their answer | Spoils the learning moment; feels rushed | Show correct/incorrect state first, pause, then reveal explanation on tap or after 2 seconds |
| No feedback on answer correctness beyond text | Minimal design feels cold and unresponsive | Subtle color shift (green/red), gentle haptic on native, brief animation -- all within the editorial aesthetic |
| Forcing account creation for any feature | Contradicts anonymous-first promise; users feel bait-and-switched | Only gate leaderboards and cross-device sync behind accounts; everything else works anonymously |
| Category tree shows empty categories | Pipeline generates categories before questions exist; users tap in and find nothing | Hide categories with < N questions (e.g., 10); show a "Coming soon" indicator for categories in progress |

## "Looks Done But Isn't" Checklist

- [ ] **Offline mode:** Often missing conflict resolution when user answers questions offline then reconnects -- verify that offline answers sync without duplicating scores
- [ ] **Question pipeline:** Often missing the feedback loop -- verify that user reports of wrong answers actually reach the pipeline and trigger re-verification
- [ ] **Anonymous auth:** Often missing the edge case where user installs on a second device -- verify that without an account, there's no expectation of cross-device sync (and clear messaging about this)
- [ ] **Daily Challenge:** Often missing timezone handling -- verify that "daily" means the same set of questions regardless of when/where the user opens the app
- [ ] **Category tree:** Often missing the "go back up" navigation -- verify breadcrumbs work at every level and "back" returns to parent, not app home
- [ ] **Leaderboards:** Often missing score recalculation after a question is flagged as incorrect -- verify that invalidated questions retroactively update affected scores
- [ ] **Multiplayer:** Often missing the "host disconnects" scenario -- verify that games gracefully handle host departure (promote another player or end cleanly)
- [ ] **Search:** Often missing search across questions -- verify users can find "that question about X" they remember from a previous session

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wrong answers in question bank | LOW | Flag question, remove from rotation, notify affected Daily Challenge scores, re-verify via pipeline |
| RLS not enabled on a table | MEDIUM | Enable RLS + add policies (immediate); audit all queries to ensure they still work; check for data already leaked |
| Anonymous data lost on sign-up | HIGH | Cannot recover lost data; must fix the auth flow and rebuild trust with affected users via communication |
| Semantic duplicates at scale | MEDIUM | Batch-compute embeddings for all existing questions; deduplicate in a one-time migration; add embedding check to pipeline |
| Realtime cost spike | LOW | Switch from Postgres Changes to Broadcast (architecture change but localized to multiplayer module); retroactive billing is the real cost |
| Difficulty calibration off | LOW | Reset all AI-assigned difficulties to "uncalibrated"; implement IRT scoring; recalibrate from existing answer data |
| Cross-platform UI regression | MEDIUM | Add platform-specific test matrix to CI; fix regressions per-platform; may require `.web.tsx` overrides for affected components |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| AI hallucination in questions | Phase 1: Agent Pipeline | Fact-Check Agent cites sources; verification_strength scores exist; < 2% user-reported error rate |
| RLS misconfiguration | Phase 1: Database Schema | CI check confirms RLS enabled on all public tables; client SDK tests return expected results |
| Anonymous-to-auth data loss | Phase 1: Auth | Integration test: anonymous user plays quiz, links email, all history preserved |
| Question deduplication failure | Phase 1: Pipeline + Schema | Embeddings column exists; similarity threshold enforced; no user reports of duplicates in first 1K plays |
| Cross-platform UI breakage | Phase 1: UI Foundation | CI builds and tests on iOS, Android, Web; visual regression tests on each platform |
| Realtime cost explosion | Phase N: Multiplayer | Cost model documented before launch; Broadcast used (not Postgres Changes); cost alerts configured |
| Difficulty miscalibration | Phase 1: Schema + Phase 2: Play | `difficulty_score` column supports calibration updates; answer rates tracked; AI estimate treated as provisional |
| Correct answer exposed to client | Phase 1: Database + API | Network tab inspection shows no `correct_answer` in client responses; Edge Function handles answer checking |
| Leaderboard score manipulation | Phase N: Leaderboards | Scores calculated server-side only; no client-submitted score endpoint exists |
| Empty categories shown to users | Phase 1: Pipeline + UI | Categories with < N questions are hidden or marked "Coming soon" |

## Sources

- [Supabase RLS Documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Anonymous Sign-Ins Documentation](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase Identity Linking Documentation](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Supabase Realtime Benchmarks](https://supabase.com/docs/guides/realtime/benchmarks)
- [Supabase API Security Guide](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase Realtime Multiplayer Cost Discussion](https://github.com/orgs/supabase/discussions/39653)
- [Supabase Anonymous User Identity Linking Issue](https://github.com/supabase/auth/issues/1525)
- [AI Hallucination Statistics 2026](https://suprmind.ai/hub/insights/ai-hallucination-statistics-research-report-2026/)
- [Expo Performance Best Practices](https://expo.dev/blog/best-practices-for-reducing-lag-in-expo-apps)
- [PostgreSQL ltree Documentation](https://www.postgresql.org/docs/current/ltree.html)
- [Hierarchical Models in PostgreSQL](https://www.ackee.agency/blog/hierarchical-models-in-postgresql)
- [VibeAppScanner: Supabase RLS Testing](https://vibeappscanner.com/supabase-row-level-security) (170+ apps with exposed databases)
- [OpenFactCheck: LLM Factuality Framework](https://openfactcheck.com/)
- [Expo for React Native in 2025](https://hashrocket.com/blog/posts/expo-for-react-native-in-2025-a-perspective)

---
*Pitfalls research for: AI-powered pub quiz app*
*Researched: 2026-04-04*
