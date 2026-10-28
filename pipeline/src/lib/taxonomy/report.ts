import type { ApplySummary } from './apply.js';

export const REPORT_MAX_CHARS = 3500;
const LIST_MAX_CHARS = 1100;

/** DB-sourced text is untrusted for Telegram: drop control characters and line separators. */
export function stripControl(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '').trim();
}

/** Join items with ", " up to maxChars, ending with "+N more" at an item boundary. */
function renderList(items: string[], maxChars: number): string {
  const out: string[] = [];
  let len = 0;
  for (let i = 0; i < items.length; i++) {
    const rest = items.length - i - 1;
    const add = (out.length ? 2 : 0) + items[i].length;
    // Keep room for a "+N more" tail computed for the items that would remain.
    const tail = rest > 0 ? ` +${rest} more`.length + 1 : 0;
    if (len + add + tail > maxChars && !(rest === 0 && len + add <= maxChars)) {
      const left = items.length - i;
      return (out.length ? out.join(', ') + ' ' : '') + `+${left} more`;
    }
    out.push(items[i]);
    len += add;
  }
  return out.join(', ');
}

export interface ReportOpts {
  /** slug -> display name for new categories (DB names; sanitised here). */
  names?: Record<string, string>;
  /** Extra one-line notes (run id, backup, stop reason); sanitised here. */
  notes?: string[];
  /** Replaces the first line (dry-run previews). */
  title?: string;
  /** Merges whose survivor the code changed from the model's/plan's choice, as 'model's -> code's'. */
  overrides?: string[];
  /** Extra labelled lists (dry-run previews), each truncated like the other lists. */
  lists?: { label: string; items: string[] }[];
}

const OVERRIDES_MAX_CHARS = 500;
const EXTRA_LIST_MAX_CHARS = 500;

export function buildReport(
  summary: ApplySummary,
  newlyVisible: string[],
  questionsAdded: number | null,
  mode: 'cleanup' | 'weekly',
  opts: ReportOpts = {},
): string {
  const lines: string[] = [opts.title ? stripControl(opts.title) : mode === 'weekly' ? 'Category review (weekly)' : 'Category cleanup (one-off)'];
  const changes = summary.merged + summary.hidden + summary.created.length + summary.rehomed + summary.flagged;
  const na0 = summary.notApplied;
  const notApplied = na0 ? na0.hidden + na0.created + na0.rehomed : 0;
  if (changes === 0 && notApplied === 0) {
    lines.push(mode === 'weekly' ? 'No category changes this week.' : 'No category changes.');
  } else {
    const na = summary.notApplied;
    const failed = (n: number | undefined): string => (n ? ` (+${n} logged but NOT applied, see errors)` : '');
    lines.push(
      `Merged: ${summary.merged}`,
      `Hidden: ${summary.hidden}${failed(na?.hidden)}`,
      `New: ${summary.created.length}${failed(na?.created)}`,
      `Re-homed: ${summary.rehomed}${failed(na?.rehomed)}`,
      `Duplicates flagged: ${summary.flagged}`,
    );
  }
  if (questionsAdded !== null && Number.isFinite(questionsAdded)) lines.push(`Questions added: ${questionsAdded}`);

  if (summary.created.length) {
    const names = summary.created.map((slug) => stripControl(opts.names?.[slug] ?? slug) || stripControl(slug));
    lines.push(`New categories: ${renderList(names, LIST_MAX_CHARS)}`);
  }
  if (newlyVisible.length) {
    lines.push(`Now visible: ${renderList(newlyVisible.map(stripControl).filter(Boolean), LIST_MAX_CHARS)}`);
  }
  if (opts.overrides?.length) {
    lines.push(`Survivor overridden (plan -> applied): ${renderList(opts.overrides.map(stripControl), OVERRIDES_MAX_CHARS)}`);
  }
  for (const l of opts.lists ?? []) {
    if (l.items.length) lines.push(`${stripControl(l.label)} (${l.items.length}): ${renderList(l.items.map((x) => stripControl(x).slice(0, 200)), EXTRA_LIST_MAX_CHARS)}`);
  }
  if (summary.errors.length) {
    lines.push(`Errors: ${summary.errors.length}`);
    for (const e of summary.errors.slice(0, 3)) lines.push(`- ${stripControl(e).slice(0, 150)}`);
  }
  for (const n of opts.notes ?? []) lines.push(stripControl(n).slice(0, 200));
  const text = lines.join('\n');
  return text.length <= REPORT_MAX_CHARS ? text : text.slice(0, REPORT_MAX_CHARS - 1) + '…';
}
