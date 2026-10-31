import type { TypedSupabaseClient } from './supabase.js';
import { block, neutralise } from './data-block.js';
import { log } from './logger.js';

// The admin tables are newer than the generated types; loose access keeps this file independent of them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = (sb: TypedSupabaseClient): any => sb;

export const MAX_RULES = 20;
export const MAX_NOTES_PER_TARGET = 5;
export const MAX_ITEM_CHARS = 300;
/** Cap on category-note lines in one taxonomy assess prompt. */
export const MAX_CATEGORY_NOTE_LINES = 40;
const MAX_ROWS = 5000;

export interface TaxGuidance {
  rules: string[];
  categoryNotes: Map<string, string[]>;
}
export interface OwnerGuidance extends TaxGuidance {
  questionNotes: Map<string, string[]>;
}

/** Owner text -> one safe line: no delimiters, no control chars, collapsed whitespace, capped. */
export function sanitiseItem(s: unknown): string {
  const t = neutralise(String(s ?? '')).replace(/[\u0000-\u001f\u007f\u2028\u2029\s]+/g, ' ').trim();
  return t.length > MAX_ITEM_CHARS ? `${t.slice(0, MAX_ITEM_CHARS - 1)}…` : t;
}

/** DATA block listing the items; empty list -> ''. */
export function renderGuidanceBlock(token: string, label: string, items: string[]): string {
  const keep = items.filter((i) => i.length > 0);
  return keep.length ? block(token, label, keep.join('\n')) : '';
}

// Guidance FAILS OPEN on a read error: it improves prompts, it is not a safety gate.
export async function loadRules(sb: TypedSupabaseClient): Promise<string[]> {
  try {
    const { data, error } = await loose(sb)
      .from('question_rules')
      .select('id, body, created_at')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(0, MAX_RULES - 1);
    if (error) throw new Error(error.message);
    return ((data ?? []) as { body: string }[]).map((r) => sanitiseItem(r.body)).filter(Boolean).slice(0, MAX_RULES);
  } catch (e) {
    log('warn', 'owner guidance: rules unreadable, continuing without', { error: (e as Error).message });
    return [];
  }
}

async function loadNotes(sb: TypedSupabaseClient, type: 'category' | 'question', ids?: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  try {
    if (ids && ids.length === 0) return out;
    let q = loose(sb).from('admin_notes').select('target_id, body, created_at, id').eq('target_type', type);
    if (ids) q = q.in('target_id', ids);
    const { data, error } = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, MAX_ROWS - 1);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { target_id: string; body: string }[]) {
      const list = out.get(r.target_id) ?? [];
      const t = sanitiseItem(r.body);
      if (t && list.length < MAX_NOTES_PER_TARGET) list.push(t);
      out.set(r.target_id, list);
    }
    return out;
  } catch (e) {
    log('warn', `owner guidance: ${type} notes unreadable, continuing without`, { error: (e as Error).message });
    return new Map();
  }
}

export const loadQuestionNotes = (sb: TypedSupabaseClient, ids: string[]): Promise<Map<string, string[]>> => loadNotes(sb, 'question', ids);
export const loadCategoryNotes = (sb: TypedSupabaseClient): Promise<Map<string, string[]>> => loadNotes(sb, 'category');

/** Rules + category notes only (the weekly taxonomy review has no use for question notes). */
export async function loadTaxGuidance(sb: TypedSupabaseClient): Promise<TaxGuidance> {
  const [rules, categoryNotes] = await Promise.all([loadRules(sb), loadCategoryNotes(sb)]);
  return { rules, categoryNotes };
}

export async function loadOwnerGuidance(sb: TypedSupabaseClient): Promise<OwnerGuidance> {
  const [rules, categoryNotes, questionNotes] = await Promise.all([loadRules(sb), loadCategoryNotes(sb), loadNotes(sb, 'question')]);
  return { rules, categoryNotes, questionNotes };
}
