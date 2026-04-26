# Quick Task 260419-pma: Tighten Category + Questions Agent prompts - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Task Boundary

Tighten pipeline/src/agents/category.ts and pipeline/src/agents/questions.ts system prompts for pub quiz suitability. Closes backlog 999.3 (Category Agent) and 999.4 (Questions Agent). No schema changes, no agent pipeline structure changes — prompt text only.

</domain>

<decisions>
## Implementation Decisions

### Tone reference
- Target: **Classic UK pub quiz**. Generalist, conversational, answer-first phrasing. Questions Agent must avoid "according to the source text" / comprehension-test framing. Example-driven prompt (e.g. "Who scored England's 1966 World Cup hat-trick?") over abstract rules.

### Breadth rule ("3+ at a pub table would have a chance")
- **Prompt guidance only.** Questions Agent told to favour broad-appeal questions. No hard rejection criterion added. QA Agent existing downscore mechanism is sufficient feedback loop.

### Niche category stance
- **Keep as opt-in specialist.** Category Agent may still generate niche branches (Quidditch-level). Matches PROJECT.md core value ("deeply nested categories down to niche topics"). Niche categories are gated behind explicit user category selection at quiz-time — no prompt changes needed for gating, it's already the default behaviour (you only play what you pick).
- Category Agent prompt should NOT prune niches — but SHOULD prune academic/technical-feeling categories at the top/mid levels (e.g. "Thermodynamics" as a pub-quiz root = bad; "Science > Famous Experiments" = fine).

### Verification method
- **Dry-run + eyeball 20 samples.** Run Questions Agent against one seed category branch before and after the prompt change. Compare 20 outputs side-by-side qualitatively. Capture both sets in SUMMARY.md for the record.

### Claude's Discretion
- Exact prompt wording, structure (bullet rules vs. examples vs. counter-examples)
- Choice of seed category for dry-run (pick one with mixed quality historically if findable, else a general-knowledge branch)
- Whether to add 3-5 few-shot good/bad pairs inline in prompt (cheap quality boost if token budget allows)

</decisions>

<specifics>
## Specific Ideas

- Good: "Who scored England's 1966 World Cup hat-trick?" — broad appeal, answer-first, conversational
- Bad: "According to the reference material, what does paragraph 3 say about Geoff Hurst's achievements?" — Wikipedia comprehension
- Bad category at root: "Thermodynamics"
- OK category nested: "Science > Famous Experiments" or "Science > Discoveries"
- Niche category example (keep as opt-in specialist): "Harry Potter > Quidditch"

</specifics>

<canonical_refs>
## Canonical References

- .planning/PROJECT.md — core value, niche topics philosophy
- .planning/ROADMAP.md Phase 999.3 (line 303) and Phase 999.4 (line 312) — original backlog entries
- pipeline/src/agents/category.ts — current Category Agent system prompt
- pipeline/src/agents/questions.ts — current Questions Agent system prompt

</canonical_refs>
