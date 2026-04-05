# Pub Quiz

## What This Is

A clean, beautifully designed pub quiz app with a massive AI-generated question database spanning deeply nested categories — from general knowledge down to niche topics like Quidditch. Runs on iOS, Android, and Web from a single React Native + Expo codebase. A pipeline of Claude-powered agents continuously builds, verifies, and expands the question library autonomously.

## Core Value

Great questions delivered through a clean, effortless interface — the content is the star, not the chrome around it.

## Design Philosophy

**Editorial, not playful.** Inspired by Dark Sky, Unsplash, Lucide, and Apple Design Award winners. Understated, typographic, spacious, content-first. No gradients, no glossy buttons, no bouncing animations. Muted palette, strong typography hierarchy, generous whitespace, subtle transitions.

Anti-gamification: no sparkles, no daily boosts, no gambling-inspired mechanics. The UI itself is a statement against the ad-ridden, gamification-bloated competitors.

**Interaction principles:**
- One-tap to play — visible options over hidden menus
- Open, single-tap actions preferred over tap-to-open-menu-then-tap-item
- Friendly, fun, real tone of voice
- Options reveal themselves as you explore deeper
- Crafted using established patterns from component.gallery, Stitch, and Figma

## Requirements

### Validated

- [x] AI agent pipeline that continuously generates, verifies, and expands questions — *Validated in Phase 1: Question Pipeline -- Agents & Schema*

### Active
- [ ] Clean, minimal UI with one-tap quick play
- [ ] Deep category tree (up to 4 levels, breadcrumb navigation)
- [ ] Solo quiz play with category/difficulty selection
- [ ] Multiple choice questions with plausible wrong answers and explanations
- [ ] Anonymous-first auth, optional account creation
- [ ] Daily challenge (same questions for all users each day)
- [ ] Cross-platform: iOS, Android, Web from single codebase
- [ ] Offline question caching for play without connectivity
- [ ] Multiplayer: join-via-code (Kahoot-style) and shared-screen/pass-and-play
- [ ] Custom quiz builder (pick categories, difficulty, count)
- [ ] Leaderboards (requires account)
- [ ] Crowd-sourced difficulty calibration
- [ ] Monetization model (research needed — options: paid app, freemium with packs/sub, or minimal ads)

### Out of Scope

- Aggressive ads or ad-heavy monetization — violates core design philosophy
- Gamification mechanics (streaks as rewards, daily boosts, loot boxes, sparkle effects) — the whole point is to not be this
- Real-time chat — high complexity, not core to quiz value
- Video questions — storage/bandwidth costs, defer to future
- OAuth login for v1 — email/anonymous sufficient
- Native mobile app stores for MVP — web-first, mobile later

## Context

**Problem:** Every pub quiz app falls into one of two camps — terrible UI with gamification garbage, or ad-ridden experiences that interrupt gameplay. There's a gap for a well-designed, content-rich quiz app that respects users.

**Agent pipeline:** Four Claude-powered agents run on staggered schedules via Remote Triggers:
1. Category Agent — discovers and proposes new categories/subcategories
2. Knowledge Agent — finds quality reference material per category
3. Questions Agent — generates questions with answers, explanations, difficulty ratings
4. Fact-Check Agent — independently verifies answers, builds verification strength

**Category structure:** Hierarchical up to 4 levels deep (e.g., Entertainment > Books > Harry Potter > Quidditch). Users can start a quiz at any level or go deeper. Breadcrumbs for navigation.

**Seed categories:** Science, History, Geography, Movies & TV, Music, Gaming, Sports, Food & Drink, Literature, Art & Design, Technology, Nature & Animals.

**Priority stack:** Question pipeline → Clean UI → Rich categories → Social features (multiplayer, leaderboards, TV mode)

## Constraints

- **Tech stack**: React Native + Expo (cross-platform), Supabase (PostgreSQL + Auth + Realtime + Edge Functions), Claude Code Remote Triggers (agent pipeline)
- **Design tools**: Google Stitch or Figma for UI design, component.gallery for pattern inspiration
- **State management**: React Context + TanStack Query for server state
- **Offline cache**: expo-sqlite or AsyncStorage
- **Build/Deploy**: Expo EAS
- **Auth model**: Anonymous-first, optional account creation for persistence
- **Difficulty**: Agent-assigned initially, refined by crowd data over time
- **Monetization**: TBD — requires research. Quality app > revenue. Options under consideration: paid app (£2.99), freemium with packs/subscription (£1/mo), pay-per-pack, or minimal non-intrusive ads

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| React Native + Expo | Single codebase for iOS, Android, Web | — Pending |
| Supabase over custom backend | Auth, realtime, edge functions, PostgreSQL — all-in-one, no infra management | — Pending |
| Claude Remote Triggers for agents | Runs on Anthropic's cloud, no infra to manage, staggered schedules | — Pending |
| Anonymous-first auth | Lowest friction to play — no signup wall | — Pending |
| Agent-generated questions | Enables massive question volume and niche depth without manual curation | — Pending |
| Anti-gamification design | Core differentiator — the app IS the statement against competitor garbage | — Pending |
| Category depth cap at 4 levels | Keeps navigation manageable while allowing niche exploration | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-05 after Phase 2 completion — Seed pipeline infrastructure complete (threshold check, category selection, GitHub Actions workflow). Human verification pending for live database seed count.*
