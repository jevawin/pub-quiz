---
date: "2026-04-17 12:00"
promoted: false
---

Pipeline bug: medium difficulty count is 0 across all 12 root categories (verified via count_available_questions RPC on 2026-04-17). Only easy and hard are being produced. Investigate why the pipeline (Questions Agent / difficulty assignment / publish threshold) is not emitting medium-difficulty questions. Check difficulty enum, generator prompts, and publish gating.
