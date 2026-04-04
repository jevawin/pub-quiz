# Feature Research

**Domain:** Pub quiz / trivia app (mobile + web)
**Researched:** 2026-04-04
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Multiple choice questions | Universal trivia format; every competitor uses it | LOW | 4 options is standard. Must include plausible distractors -- weak wrong answers are the #1 quality complaint across competitors |
| Category selection | Users expect to play topics they care about. Trivia Crack's random-only approach is a top complaint | MEDIUM | Deep hierarchy (4 levels) is a differentiator; flat category list is table stakes |
| Difficulty levels | Easy/Normal/Hard is baseline. QuizzLand, LearnClash, and Trivia Star all offer this | LOW | Agent-assigned initially, crowd-calibrated later per PROJECT.md |
| Answer explanations | QuizzLand proved this is expected -- "not just the answer but why" is a retention driver. Users learn, not just score | LOW | Short (2-3 sentences). Every question needs one. Critical for "respect the user" philosophy |
| Score tracking / progress | Users need to see how they did. Per-session results and historical performance | MEDIUM | Session summary screen + lifetime stats. No account required for session stats |
| Quick play (one-tap start) | Friction kills casual play. Users expect to be playing within 2 taps of opening the app | LOW | Random category, mixed difficulty, 10 questions. PROJECT.md already specifies this |
| Solo play mode | The default mode. Most trivia app sessions are solo | LOW | Foundation for everything else |
| Timer per question | Creates tension and prevents overthinking. Standard across Trivia Crack, QuizUp, Kahoot | LOW | 15-20 seconds default. Consider optional "relaxed mode" with no timer |
| Cross-platform (iOS + Android + Web) | Users expect to play on their device of choice | HIGH | React Native + Expo handles this. Web is lower priority per PROJECT.md |
| Free to start playing | No trivia app succeeds behind a hard paywall at launch. Users expect to try before paying | LOW | Anonymous-first auth handles this perfectly |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Editorial design (anti-gamification) | THE core differentiator. Every competitor is either ugly, ad-ridden, or gamification-heavy. Dark Sky / Unsplash quality design is unoccupied territory in trivia | HIGH | Not a feature users search for, but the reason they stay and recommend. Design IS the product |
| Deep nested categories (4 levels) | Sporcle has breadth but flat structure. No competitor offers Entertainment > Books > Harry Potter > Quidditch depth with clean navigation | HIGH | Breadcrumb nav, play-at-any-level. Enables niche obsessives -- the most passionate users |
| AI-generated question pipeline | Enables massive question volume without manual curation. LearnClash does this for 1v1; no solo-focused app does it well at scale | HIGH | 4-agent pipeline (Category, Knowledge, Questions, Fact-Check). The engine that makes deep categories viable |
| Ad-free / minimal-ad experience | Trivia Crack's #1 complaint is ads. QuizzLand forces ad views. An ad-free trivia app is genuinely rare | LOW | Monetize through premium features, not interruptions. This is a positioning statement |
| Daily challenge (same Qs for everyone) | Creates shared experience and daily habit. Wordle proved this model. Most trivia apps don't do "same questions for all" | MEDIUM | 10 questions, rotating categories. Compare with friends. Strong retention mechanic without gamification |
| Offline question caching | Most trivia apps require connectivity. Offline play respects users on commutes, flights, or poor connections | MEDIUM | Pre-cache N questions per favourite category. Sync scores when back online |
| Crowd-sourced difficulty calibration | Questions get smarter over time. No competitor does this transparently. "78% of players got this right" adds context | MEDIUM | Track correct/incorrect per question, adjust difficulty rating. Display accuracy stats post-answer |
| Custom quiz builder | Pick categories, difficulty range, question count. More control than competitors offer | LOW | Builds on category tree + difficulty system. Low marginal complexity once foundations exist |
| No-account play (anonymous-first) | Zero friction. Most competitors force signup before first question. QuizUp required Facebook login originally | LOW | Play immediately, optionally create account to persist stats. Huge conversion advantage |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems. These are deliberate exclusions.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Streak rewards / daily login bonuses | Standard retention mechanic; every competitor uses them | Creates obligation, not enjoyment. Users feel punished for missing a day. This is the gamification this app exists to reject | Daily challenge provides daily reason to return without punishment mechanics. Intrinsic motivation > extrinsic |
| Loot boxes / random rewards | Proven monetization in games | Gambling-adjacent, exploitative, violates design philosophy. Trivia Crack's "spin the wheel" is a slot machine wearing a trivia hat | Offer content packs or subscription with clear value |
| Interstitial ads between questions | High revenue per impression | Destroys flow state. #1 user complaint across every ad-supported trivia app. "15-45 seconds between turns" is cited repeatedly | Monetize via premium tier or content packs. Never interrupt gameplay |
| Real-time chat | Social engagement metric | High complexity, moderation burden, rarely used in practice. No trivia app has made this work well | Async social (share results, challenge friends) is sufficient |
| Leaderboards as primary motivation | Competitive users want rankings | Global leaderboards reward volume over skill. Demotivating for casual players. Creates toxic competition | Friend-only comparisons, personal bests, daily challenge rankings (opt-in). ELO-style skill rating if multiplayer grows |
| Push notification spam | Re-engagement metric | Users uninstall over aggressive notifications. Trivia Crack complaints cite "constant notifications suggesting you should show friends you're smarter" | Minimal: daily challenge reminder (opt-in). Nothing else |
| Pay-to-win mechanics | Revenue from whales | Trivia Crack lets users buy advantages and watch ads for second chances. "Players who watch the most ads have the best chance of winning" -- this destroys fairness | All players have the same quiz experience. Premium adds convenience/content, never advantage |
| Video questions | Rich media engagement | Storage/bandwidth costs are prohibitive. Production quality requirements are high. Defer indefinitely | Image-based questions are feasible later. Text + optional static image is sufficient |
| User-generated questions (open) | Free content at scale | Kahoot's biggest problem: "inconsistent quality of user-generated quizzes." Moderation is expensive and never-ending | AI-generated + fact-checked pipeline produces higher, more consistent quality |
| Speed-as-primary-mechanic | Excitement, competitive tension | Kahoot research found "speed emphasis undermined student engagement and pushed students to answer quickly rather than accurately." Rewards reflexes over knowledge | Timer exists but is generous (15-20s). Accuracy matters more than speed |

## Feature Dependencies

```
[AI Question Pipeline]
    |-- generates --> [Questions with Explanations]
    |                    |-- displayed in --> [Solo Play Mode]
    |                    |-- displayed in --> [Daily Challenge]
    |                    |-- displayed in --> [Multiplayer Mode]
    |-- populates --> [Deep Category Tree]
    |                    |-- navigated via --> [Category Browser + Breadcrumbs]
    |                    |-- filtered by --> [Custom Quiz Builder]
    |
[Category Tree]
    |-- requires --> [Category Agent (pipeline stage 1)]
    |-- browsed via --> [Category Selection UI]
    |
[Solo Play Mode]
    |-- requires --> [Questions DB + Category Tree + Scoring]
    |-- enhanced by --> [Offline Caching]
    |-- enhanced by --> [Difficulty Selection]
    |
[Daily Challenge]
    |-- requires --> [Solo Play Mode + Scheduling Logic]
    |-- enhanced by --> [Leaderboard (daily-scoped)]
    |-- enhanced by --> [Social Sharing]
    |
[Anonymous Auth]
    |-- enables --> [Zero-friction Play]
    |-- upgradeable to --> [Account Creation]
    |                          |-- enables --> [Persistent Stats]
    |                          |-- enables --> [Leaderboards]
    |                          |-- enables --> [Cross-device Sync]
    |
[Multiplayer]
    |-- requires --> [Account Creation (at least for host)]
    |-- requires --> [Realtime Infrastructure (Supabase Realtime)]
    |-- mode 1 --> [Join-via-Code (Kahoot-style)]
    |-- mode 2 --> [Pass-and-Play (single device)]
    |
[Crowd Difficulty Calibration]
    |-- requires --> [Sufficient Play Data (thousands of answers per question)]
    |-- enhances --> [Difficulty Selection accuracy]
    |-- enhances --> [Question quality over time]
    |
[Offline Caching]
    |-- requires --> [Local DB (expo-sqlite)]
    |-- requires --> [Sync Logic]
    |-- enhances --> [Solo Play Mode]
```

### Dependency Notes

- **Solo Play requires Question Pipeline:** Without AI-generated questions, there is no product. Pipeline is phase 1.
- **Daily Challenge requires Solo Play:** It is solo play with constraints (fixed questions, fixed schedule). Build solo first, daily is a thin layer on top.
- **Multiplayer requires Realtime:** Supabase Realtime handles this, but it is a separate infrastructure concern from the core quiz experience.
- **Crowd Calibration requires Scale:** Meaningless with <1000 users. Defer until post-launch data accumulates.
- **Custom Quiz Builder requires Category Tree:** Must have browsable categories before users can compose custom quizzes from them.
- **Pass-and-Play is independent of network:** Can ship before join-via-code multiplayer since it requires no realtime infrastructure.

## MVP Definition

### Launch With (v1)

Minimum viable product -- validate that people want a clean, well-designed trivia app.

- [ ] AI question pipeline (at least Questions Agent + Fact-Check Agent running) -- without questions, nothing works
- [ ] Seed question database (1000+ questions across seed categories) -- enough for initial play
- [ ] Solo play with category and difficulty selection -- the core loop
- [ ] Multiple choice with explanations -- the experience that distinguishes from competitors
- [ ] Quick play (one-tap, random category) -- lowest friction entry point
- [ ] Score tracking (per-session) -- users need feedback
- [ ] Anonymous-first auth -- zero friction to start
- [ ] Editorial UI (clean, typographic, spacious) -- the design IS the differentiator; shipping ugly defeats the purpose
- [ ] Timer per question -- creates appropriate tension
- [ ] Basic category browser (2 levels deep minimum) -- users must be able to pick what they care about

### Add After Validation (v1.x)

Features to add once core loop is validated and users are retained.

- [ ] Deep category tree (3-4 levels) with breadcrumb navigation -- expand once Category Agent is running well
- [ ] Daily challenge -- add once there are enough questions and a small user base to create shared experience
- [ ] Offline question caching -- add once users report wanting it (commuters, travellers)
- [ ] Custom quiz builder -- add once category tree is deep enough to make composition interesting
- [ ] Account creation (optional upgrade from anonymous) -- add once there is something worth persisting
- [ ] Personal stats / history -- requires account, adds retention value
- [ ] Pass-and-play multiplayer -- low complexity, no network infra needed, great for actual pub settings

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] Join-via-code multiplayer (Kahoot-style) -- requires realtime infra, host/player UX, lobby management
- [ ] Leaderboards (daily + all-time) -- requires accounts + sufficient user base
- [ ] Crowd-sourced difficulty calibration -- requires thousands of data points per question
- [ ] Social sharing (share results, challenge friends) -- requires account system + deep links
- [ ] Monetization implementation -- research model during v1.x, implement in v2. QuizUp's lesson: premature monetization kills; no monetization also kills
- [ ] TV/presentation mode -- large-screen display for pub quiz hosting

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| AI question pipeline | HIGH | HIGH | P1 |
| Solo play mode | HIGH | MEDIUM | P1 |
| Multiple choice + explanations | HIGH | LOW | P1 |
| Quick play (one-tap) | HIGH | LOW | P1 |
| Category selection (basic) | HIGH | MEDIUM | P1 |
| Editorial design system | HIGH | HIGH | P1 |
| Anonymous auth | HIGH | LOW | P1 |
| Timer per question | MEDIUM | LOW | P1 |
| Score tracking (session) | MEDIUM | LOW | P1 |
| Deep category tree (4 levels) | HIGH | MEDIUM | P2 |
| Daily challenge | HIGH | LOW | P2 |
| Offline caching | MEDIUM | MEDIUM | P2 |
| Custom quiz builder | MEDIUM | LOW | P2 |
| Pass-and-play multiplayer | MEDIUM | MEDIUM | P2 |
| Account creation + persistence | MEDIUM | MEDIUM | P2 |
| Personal stats / history | MEDIUM | LOW | P2 |
| Join-via-code multiplayer | MEDIUM | HIGH | P3 |
| Leaderboards | LOW | MEDIUM | P3 |
| Crowd difficulty calibration | MEDIUM | MEDIUM | P3 |
| Social sharing | LOW | MEDIUM | P3 |
| Monetization | HIGH | HIGH | P3 |
| TV/presentation mode | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch -- the core quiz experience
- P2: Should have, add after core is validated
- P3: Nice to have, requires user base or infrastructure investment

## Competitor Feature Analysis

| Feature | Trivia Crack | QuizzLand | LearnClash | Sporcle | Kahoot | Our Approach |
|---------|-------------|-----------|------------|---------|--------|-------------|
| **Design quality** | Playful, cartoonish, ad-heavy | Basic, "faceless avatars" | Clean, modern | Functional, dated | Bold, classroom-oriented | Editorial, typographic, Apple Design Award quality. Unoccupied territory |
| **Question source** | Community + editorial | 40K curated questions | AI-generated per topic | User-generated (900K+ quizzes) | User/teacher-generated | AI pipeline with fact-checking. Scale of AI + quality of curation |
| **Explanations** | No | Yes (key differentiator for them) | No | No | No | Yes, every question. Learning is a feature |
| **Categories** | 6 fixed categories | Flat list | Any topic (AI) | Flat with user tags | User-created | Deep 4-level hierarchy. Niche depth no one else offers |
| **Ads** | Aggressive (15-45s interstitials, pay-to-win via ad watching) | Frequent (ad to continue) | None (subscription) | Moderate | Freemium (limited free plays) | None in gameplay. Ever. Monetize via premium tier |
| **Offline play** | No | Limited | No | No | No | Yes, cached questions for favourite categories |
| **Daily challenge** | No (random matches) | No | No | "Quiz of the Day" | No | Yes, same 10 questions for everyone. Wordle model |
| **Multiplayer** | Async 1v1 | No | Real-time 1v1 (ELO) | Party mode (separate app) | Live group (host-driven) | Pass-and-play first, join-via-code later |
| **Monetization** | Ads + IAP (pay-to-win) | Ads + premium | Subscription (no ads any tier) | Ads + subscription | Freemium + subscription | TBD. Likely freemium with content packs or subscription. No pay-to-win |
| **Difficulty** | Fixed | Easy/Normal/Hard | ELO-matched | Varies by quiz | Host-set | Agent-assigned, crowd-calibrated over time |

### Competitor Strengths to Learn From

- **QuizzLand:** Proved explanations matter. Users cite them as primary reason to play.
- **LearnClash:** Proved AI question generation works at scale. Zero-ads-at-any-tier is possible with subscription.
- **Sporcle:** Proved niche topic depth creates passionate users. "Harry Potter" to "Quidditch" is exactly the depth model.
- **Kahoot:** Proved join-via-code multiplayer is magical for groups. The "game show in a room" feeling.
- **QuizUp (RIP):** Proved 1200+ niche topics create addictive browsing. Also proved that failing to monetize kills even an 80M-user app.

### Competitor Weaknesses to Exploit

- **Every ad-supported app:** Users hate interstitial ads in trivia. This is the widest-open opportunity.
- **Trivia Crack:** Pay-to-win mechanics and ad-watching-for-advantages destroy fairness. Users resent it.
- **Kahoot:** Speed-over-accuracy emphasis "undermined student engagement." Thoughtful trivia is underserved.
- **QuizzLand:** Ugly design, repeat questions. Content quality ceiling without AI pipeline.
- **Sporcle:** User-generated content means wildly inconsistent quality. Functional but dated UI.
- **All competitors:** None combine editorial design + deep categories + explanations + ad-free. The intersection is empty.

## Sources

- [LearnClash - Best Trivia Apps Ranking 2026](https://learnclash.com/blog/best-trivia-apps)
- [Water Cooler Trivia - Best Quizzing Apps 2025](https://www.watercoolertrivia.com/blog/best-quizzing-apps)
- [Quizzy Blog - Best QuizUp Alternatives 2025](https://joinquizzy.com/blog/best-quizup-alternatives-2025/)
- [Quizzy Blog - Best Trivia Crack Alternatives 2025](https://joinquizzy.com/blog/best-trivia-crack-alternatives-2025/)
- [Quizzy Blog - What Happened to QuizUp](https://joinquizzy.com/blog/what-happened-to-quizup/)
- [Buildd - What Happened to QuizUp](https://buildd.co/startup/failure-stories/what-happened-to-quizup)
- [ComplaintsBoard - Trivia Crack Reviews](https://www.complaintsboard.com/trivia-crack-no-ads-b150091)
- [Trivia App Reviews - QuizzLand](https://trivia-app-reviews.com/quizzland/)
- [Adapty - Freemium Monetization Strategies](https://adapty.io/blog/freemium-app-monetization-strategies/)
- [Sporcle Categories](https://www.sporcle.com/categories/)
- [Alternative.me - Kahoot Alternatives](https://alternative.me/kahoot)
- [Mission.io - Kahoot Alternatives](https://mission.io/blog/kahoot-alternatives)

---
*Feature research for: pub quiz / trivia app*
*Researched: 2026-04-04*
