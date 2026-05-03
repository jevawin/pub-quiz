---
phase: quick-260503-rmp
status: complete
completed_date: 2026-05-03
tags: [docs, roadmap, restructure]
---

# Quick Task 260503-rmp: restructure ROADMAP into three tracks

Reorganised `.planning/ROADMAP.md` into four labelled sections so prototype-phase work doesn't drown in long-game build context. No content cut — all entries preserved, just relocated.

## Sections

- **A. Build Path — Long Game.** Phases 1-8 + 2.x inserts. Unchanged content.
- **B. Post-Launch Backlog.** 999.2, 999.6, 999.7, 999.9b, 999.12, 999.14. Items that need play volume / launched app / mature pipeline before they earn a slot. Each got a `Why post-launch:` line explaining the gating dependency.
- **C. Prototype Iteration Backlog.** Current-state work.
  - **C1.** Active quick tasks (260427-prm, 260428-fact, 260426-bkf).
  - **C2.** Sequenced library quality work (999.18 → 999.19 → 999.16) with rationale for the order.
  - **C3.** Convention block for adding new items (date-prefix slugs for tactical, 999.x for phase-sized, B for system-level).
- **D. Archive.** Preserved resolved / promoted / superseded entries (999.3, .4, .5, .10, .11, .17 resolved; 999.8 → 2.4 promoted; 999.13 → 2.5 promoted; 999.15 / 999.15-original superseded; resolved quick-task specs).

## Side-effects

- Updated **Progress** table to reflect actual phase status (Phase 1, 2, 2.1 = "Shipped", not "Planning complete"; Phase 2.2 = "Active — prototype phase"; Phase 2.4 plan count corrected to 4/5).
- Pre-restructure, several quick-task specs in the inline list were marked PENDING but actually shipped weeks ago (260427-spt via 260426-ow2; 260427-dup via 260426-pxh; 260427-end via 260427-uf1; 260426-fct via 260426-czq). Moved to D4 with correct RESOLVED markers + closing commit/quick-task references.
- Replaced the stale "Active Quick Tasks (prioritised 2026-04-28)" Done/Tier-1/Tier-2 list with C1's current-state pending-only set.

## Why

User clarified mid-session: ROADMAP was conflating (a) the long-game build, (b) future post-launch ideas, and (c) current prototype iterations from feedback. Three separate tracks make it cleaner to add new feedback items, and easier to defer post-launch work without losing it.
