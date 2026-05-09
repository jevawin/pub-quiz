#!/usr/bin/env node
/**
 * Phase 999.23 Wave 2 — seed mistag worklist.
 *
 * Runs four heuristic queries against `question_categories` joined to
 * `questions` and `categories` to surface candidate mis-tagged questions,
 * then merges in the 7 explicit Q ids called out in
 * `.planning/phases/999.22-chain-tagging-architecture/PROGRESS.md`.
 *
 * Output:
 *   .planning/phases/999.23-cousin-cat-audit/data/mistag-worklist.json
 *
 * Schema per CONTEXT.md D1:
 *   { question_id, question_text, current_slugs[{slug, estimate_score}],
 *     flag_reason, suggested_action, decision: null, source }
 *
 * Read-only DB access; no writes. Subsequent waves consume this file.
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import { writeFileSync, mkdirSync } from 'node:fs';
import { createSupabaseClient } from '../lib/supabase.js';

const PAGE = 1000;
const OUT_PATH =
  '/Users/jamiepersonal/Developer/pub-quiz/.claude/worktrees/agent-a0a80156392f75c13/.planning/phases/999.23-cousin-cat-audit/data/mistag-worklist.json';

type Source =
  | 'heuristic-90s'
  | 'heuristic-sitcoms'
  | 'heuristic-pubgames'
  | 'heuristic-cuisine'
  | 'progress-manual';

interface WorklistEntry {
  question_id: string;
  question_text: string;
  current_slugs: { slug: string; estimate_score: number }[];
  flag_reason: string;
  suggested_action: string;
  decision: null | 'fix' | 'keep' | 'defer';
  source: Source;
}

interface HeuristicSpec {
  slug: string;
  source: Source;
  /** Heuristic kind: 'mismatch' flags Qs whose text MATCHES the regex (wrong tag).
   *  'missing' flags Qs whose text does NOT match the allow-list (off-topic). */
  kind: 'mismatch' | 'missing';
  regex: RegExp;
  flag_template: (matched: string) => string;
  suggested_action: string;
}

const HEURISTICS: HeuristicSpec[] = [
  {
    slug: '90s-music-hits',
    source: 'heuristic-90s',
    kind: 'mismatch',
    regex:
      /aphex twin|madeon|alunageorge|monstercat|sukiyaki|skrillex|deadmau5|odesza/i,
    flag_template: (m) =>
      `tagged 90s-music-hits but Q references "${m}" (not a 90s artist/track)`,
    suggested_action:
      'remove 90s-music-hits; consider electronic-music or relevant decade slug',
  },
  {
    slug: 'classic-sitcoms',
    source: 'heuristic-sitcoms',
    kind: 'mismatch',
    regex:
      /black mirror|rick and morty|m\*?a\*?s\*?h|inspector morse|breaking bad|game of thrones/i,
    flag_template: (m) =>
      `tagged classic-sitcoms but Q references "${m}" (not a sitcom)`,
    suggested_action:
      'remove classic-sitcoms; add the correct genre tag (drama / animation / detective etc.)',
  },
  {
    slug: 'traditional-pub-games',
    source: 'heuristic-pubgames',
    kind: 'mismatch',
    regex:
      /bowling|monopoly|video game|playstation|xbox|nintendo/i,
    flag_template: (m) =>
      `tagged traditional-pub-games but Q references "${m}" (not a pub game)`,
    suggested_action:
      'remove traditional-pub-games; add board-games / video-games / sports as appropriate',
  },
  {
    slug: 'world-cuisine',
    source: 'heuristic-cuisine',
    kind: 'missing',
    regex:
      /food|dish|cuisine|recipe|drink|beverage|cocktail|wine|beer|cheese|bread|meat|fish|sauce|soup|dessert|pastry|fruit|vegetable|spice|coffee|tea|chef|restaurant|menu|kitchen|bake|cook|eat|sushi|pasta|pizza|curry|rice/i,
    flag_template: () =>
      'tagged world-cuisine but question_text contains no food / dish / drink keyword',
    suggested_action:
      'remove world-cuisine; re-tag against the actual subject of the Q',
  },
];

/**
 * The 7 short-prefix Q ids surfaced in 999.22 PROGRESS.md.
 * Each entry carries a verbatim flag_reason taken from the PROGRESS.md
 * "Subagent observations to feed 999.23" section, plus a suggested_action.
 */
const PROGRESS_MANUAL: Array<{
  prefix: string;
  flag_reason: string;
  suggested_action: string;
}> = [
  {
    prefix: 'df69b35a',
    flag_reason: 'AlunaGeorge — tagged 90s-music-hits but is 2010s',
    suggested_action: 'remove 90s-music-hits; add electronic-music or 2010s-music',
  },
  {
    prefix: 'ea75c41d',
    flag_reason:
      'tagged 90s-music-hits but Q covers Aphex Twin / Monstercat / Madeon / Sukiyaki — wrong cat',
    suggested_action: 'remove 90s-music-hits; add electronic-music',
  },
  {
    prefix: '8257670d',
    flag_reason:
      'tagged 90s-music-hits but Q covers Aphex Twin / Monstercat / Madeon / Sukiyaki — wrong cat',
    suggested_action: 'remove 90s-music-hits; add electronic-music',
  },
  {
    prefix: 'a685aa9c',
    flag_reason:
      'tagged 90s-music-hits but Q covers Aphex Twin / Monstercat / Madeon / Sukiyaki — wrong cat',
    suggested_action: 'remove 90s-music-hits; add electronic-music',
  },
  {
    prefix: '82fbbb7d',
    flag_reason:
      'tagged 90s-music-hits but Q covers Aphex Twin / Monstercat / Madeon / Sukiyaki — wrong cat',
    suggested_action: 'remove 90s-music-hits; add electronic-music',
  },
  {
    prefix: '7ab8a974',
    flag_reason:
      'Ouagadougou — existing world-capitals score 45 may be too low for capitals-pill audience',
    suggested_action: 'raise world-capitals estimate_score (60–75) to match audience expectation',
  },
  {
    prefix: '3ab0252a',
    flag_reason:
      'bowling Turkey — gaming parent feels weak (bowling closer to sports)',
    suggested_action:
      'remove gaming chain; add sports chain (bowling sits under sports)',
  },
];

interface CategoryRow {
  id: string;
  slug: string;
}

interface QuestionRow {
  id: string;
  question_text: string;
}

interface QcRow {
  question_id: string;
  category_id: string;
  estimate_score: number;
}

async function main(): Promise<void> {
  const sb = createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // 1. Categories — slug → id and id → slug.
  const { data: cats, error: catErr } = await sb
    .from('categories')
    .select('id, slug');
  if (catErr) throw new Error(`categories: ${catErr.message}`);
  const catRows = (cats ?? []) as CategoryRow[];
  const slugToId = new Map(catRows.map((c) => [c.slug, c.id]));
  const idToSlug = new Map(catRows.map((c) => [c.id, c.slug]));

  // 2. All qc rows (paged) — used for current_slugs lookup.
  const qcByQ = new Map<string, QcRow[]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('question_categories')
      .select('question_id, category_id, estimate_score')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`qc page: ${error.message}`);
    const rows = (data ?? []) as QcRow[];
    if (!rows.length) break;
    for (const r of rows) {
      const arr = qcByQ.get(r.question_id) ?? [];
      arr.push(r);
      qcByQ.set(r.question_id, arr);
    }
    if (rows.length < PAGE) break;
  }
  console.log(`Loaded: ${catRows.length} cats, ${qcByQ.size} Qs with qc rows`);

  // Helper: build current_slugs[] for a given question id.
  function currentSlugsFor(qid: string): { slug: string; estimate_score: number }[] {
    const rows = qcByQ.get(qid) ?? [];
    return rows
      .map((r) => {
        const slug = idToSlug.get(r.category_id);
        return slug ? { slug, estimate_score: r.estimate_score } : null;
      })
      .filter((x): x is { slug: string; estimate_score: number } => x !== null)
      .sort((a, b) => b.estimate_score - a.estimate_score);
  }

  // 3. Run the four heuristics.
  const heuristicEntries: WorklistEntry[] = [];
  const perHeuristicCounts: Record<string, number> = {
    'heuristic-90s': 0,
    'heuristic-sitcoms': 0,
    'heuristic-pubgames': 0,
    'heuristic-cuisine': 0,
  };

  for (const h of HEURISTICS) {
    const catId = slugToId.get(h.slug);
    if (!catId) {
      console.warn(`WARN: slug "${h.slug}" not found in categories table — skipping`);
      continue;
    }

    // Find qids tagged with this slug.
    const qids: string[] = [];
    for (const [qid, rows] of qcByQ.entries()) {
      if (rows.some((r) => r.category_id === catId)) qids.push(qid);
    }
    console.log(`  ${h.slug}: ${qids.length} Qs currently tagged`);

    // Page through questions to get question_text for these qids.
    const qTextById = new Map<string, string>();
    for (let i = 0; i < qids.length; i += 200) {
      const slice = qids.slice(i, i + 200);
      const { data, error } = await sb
        .from('questions')
        .select('id, question_text')
        .in('id', slice);
      if (error) throw new Error(`questions ${h.slug}: ${error.message}`);
      for (const q of (data ?? []) as QuestionRow[]) qTextById.set(q.id, q.question_text);
    }

    // Apply heuristic.
    for (const qid of qids) {
      const text = qTextById.get(qid);
      if (!text) continue;
      const m = text.match(h.regex);
      const matched = m?.[0] ?? '';
      const isFlag =
        h.kind === 'mismatch' ? !!m : !m;
      if (!isFlag) continue;

      heuristicEntries.push({
        question_id: qid,
        question_text: text,
        current_slugs: currentSlugsFor(qid),
        flag_reason: h.flag_template(matched),
        suggested_action: h.suggested_action,
        decision: null,
        source: h.source,
      });
      perHeuristicCounts[h.source]++;
    }
  }

  // 4. Resolve the 7 short-prefix manual Q ids → full UUIDs.
  // Postgres uuid type does not accept `ilike`, so we page all ids once and
  // match prefixes in memory.
  const allIds: QuestionRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('questions')
      .select('id, question_text')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`questions page (manual): ${error.message}`);
    const rows = (data ?? []) as QuestionRow[];
    if (!rows.length) break;
    allIds.push(...rows);
    if (rows.length < PAGE) break;
  }
  console.log(`  manual: scanned ${allIds.length} questions for 7 prefix matches`);

  const manualEntries: WorklistEntry[] = [];
  for (const m of PROGRESS_MANUAL) {
    const matches = allIds.filter((q) => q.id.startsWith(m.prefix));
    if (matches.length === 0) {
      console.warn(`WARN: prefix ${m.prefix} matched 0 questions — skipping`);
      continue;
    }
    if (matches.length > 1) {
      console.warn(
        `WARN: prefix ${m.prefix} matched ${matches.length} questions — picking first (${matches[0].id})`,
      );
    }
    const q = matches[0];
    manualEntries.push({
      question_id: q.id,
      question_text: q.question_text,
      current_slugs: currentSlugsFor(q.id),
      flag_reason: m.flag_reason,
      suggested_action: m.suggested_action,
      decision: null,
      source: 'progress-manual',
    });
  }

  // 5. Merge with manual-wins de-duplication.
  const byId = new Map<string, WorklistEntry>();
  for (const e of heuristicEntries) byId.set(e.question_id, e);
  for (const e of manualEntries) byId.set(e.question_id, e); // overwrites
  const merged = Array.from(byId.values()).sort((a, b) => {
    if (a.source === b.source) return a.question_id.localeCompare(b.question_id);
    return a.source.localeCompare(b.source);
  });

  // 6. Write output.
  mkdirSync(OUT_PATH.replace(/\/[^/]+$/, ''), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(merged, null, 2));

  // 7. Summary.
  const summary = {
    heuristic_90s: perHeuristicCounts['heuristic-90s'],
    heuristic_sitcoms: perHeuristicCounts['heuristic-sitcoms'],
    heuristic_pubgames: perHeuristicCounts['heuristic-pubgames'],
    heuristic_cuisine: perHeuristicCounts['heuristic-cuisine'],
    manual: manualEntries.length,
    total_unique: merged.length,
  };
  console.log('Summary:', summary);
  console.log(`Wrote ${merged.length} entries → ${OUT_PATH}`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
