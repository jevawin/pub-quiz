import { GENERAL_KNOWLEDGE_SLUG } from '../general-knowledge-guard.js';
import { subtreeSlugs } from './tree.js';
import { flaggedMatch } from './flags.js';
import { MAX_DEPTH, type Rejection, type TaxPlan, type TaxTree } from './types.js';

/**
 * General Knowledge (and anything beneath it) is out of scope for the taxonomy job, always: the generator tags every
 * question with it and treats a hidden/merged GK as unknown, so one accepted change to it stops ALL generation.
 * Enforced in code (here, in validatePlan, and again in the apply engine), never via the DB `protected` flag.
 */
export function isGeneralKnowledgeOrUnder(tree: TaxTree, slug: string): boolean {
  if (slug === GENERAL_KNOWLEDGE_SLUG) return true;
  let node = tree.bySlug.get(slug);
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    if (node.slug === GENERAL_KNOWLEDGE_SLUG) return true;
    seen.add(node.id);
    node = node.parentId ? tree.byId.get(node.parentId) : undefined;
  }
  return false;
}

/** A top-level category (the web app hardcodes one pill per root, so a root must never be merged away or hidden). */
export function isRoot(tree: TaxTree, slug: string): boolean {
  const n = tree.bySlug.get(slug);
  return !!n && (n.parentId === null || n.depth === 0);
}

/**
 * Confine one root's plan to the subtree that root's assessor was shown. Merges and hides may only name slugs in
 * the subtree; a create's parent must be in the subtree (the root itself counts, as a reference-only parent) or be
 * created earlier in the same plan. Anything else is rejected as 'outside assessed subtree' (e.g. a guessed slug
 * from another root). Rehomes/duplicates are not produced by the assessor and pass through untouched.
 */
export function confineToSubtree(tree: TaxTree, root: string, plan: TaxPlan): { plan: TaxPlan; rejected: Rejection[] } {
  const inSubtree = new Set(subtreeSlugs(tree, root));
  const rejected: Rejection[] = [];
  const out: TaxPlan = { merges: [], hides: [], creates: [], rehomes: [...plan.rehomes], duplicates: [...plan.duplicates] };
  const outside = (slugs: string[]): string[] => slugs.filter((s) => !inSubtree.has(s));
  const reason = (bad: string[]) => `outside assessed subtree ${root}: ${bad.join(', ')}`;
  for (const m of plan.merges) {
    const bad = outside([m.survivor, ...m.absorbed]);
    if (bad.length) rejected.push({ kind: 'merges', item: m, reason: reason(bad) });
    else out.merges.push(m);
  }
  for (const h of plan.hides) {
    if (!inSubtree.has(h.slug)) rejected.push({ kind: 'hides', item: h, reason: reason([h.slug]) });
    else out.hides.push(h);
  }
  const created = new Set<string>();
  for (const c of plan.creates) {
    if (!inSubtree.has(c.parent) && !created.has(c.parent)) {
      rejected.push({ kind: 'creates', item: c, reason: reason([c.parent]) });
      continue;
    }
    created.add(c.slug);
    out.creates.push(c);
  }
  return { plan: out, rejected };
}

const JUNK_SUFFIX = /-(quiz|quizzes|trivia|subcategor(y|ies)|questions)$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isJunkSlug(slug: string): boolean {
  return !KEBAB.test(slug) || JUNK_SUFFIX.test(slug);
}

/** True if the node, or any ancestor of it, is protected. Unknown slug -> false. */
export function isProtectedOrUnder(tree: TaxTree, slug: string): boolean {
  let node = tree.bySlug.get(slug);
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    if (node.protected) return true;
    seen.add(node.id);
    node = node.parentId ? tree.byId.get(node.parentId) : undefined;
  }
  return false;
}

/** True if the node itself or any descendant is protected. Unknown slug -> false. */
export function subtreeHasProtected(tree: TaxTree, slug: string): boolean {
  const root = tree.bySlug.get(slug);
  if (!root) return false;
  const stack = [root];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    if (n.protected) return true;
    for (const id of n.childIds) {
      const c = tree.byId.get(id);
      if (c) stack.push(c);
    }
  }
  return false;
}

function isAncestorOf(tree: TaxTree, ancestorSlug: string, slug: string): boolean {
  const anc = tree.bySlug.get(ancestorSlug);
  let node = tree.bySlug.get(slug);
  const seen = new Set<string>();
  while (anc && node && node.parentId && !seen.has(node.id)) {
    seen.add(node.id);
    if (node.parentId === anc.id) return true;
    node = tree.byId.get(node.parentId);
  }
  return false;
}

/** Most distinct published questions; tie -> shorter slug; then alphabetical. Slugs must be in the tree. */
export function chooseSurvivor(tree: TaxTree, slugs: string[]): string {
  const n = (s: string) => tree.bySlug.get(s)?.distinctPublished ?? 0;
  return [...slugs].sort((a, b) => n(b) - n(a) || a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))[0];
}

export function validatePlan(
  tree: TaxTree,
  plan: TaxPlan,
  opts: { maxActions: number; allowedQuestionIds: Set<string> },
): { plan: TaxPlan; rejected: Rejection[] } {
  const out: TaxPlan = { merges: [], hides: [], creates: [], rehomes: [], duplicates: [] };
  const rejected: Rejection[] = [];
  let accepted = 0;

  const reject = (kind: keyof TaxPlan, item: unknown, reason: string) => rejected.push({ kind, item, reason });
  /** Returns true if the item may be accepted (budget left); otherwise records the overflow. */
  const take = (kind: keyof TaxPlan, item: unknown): boolean => {
    if (accepted >= opts.maxActions) {
      reject(kind, item, 'over action cap');
      return false;
    }
    accepted++;
    return true;
  };
  const known = (slug: string) => tree.bySlug.has(slug);
  const ids = opts.allowedQuestionIds; // required: an empty set rejects every question id

  // Created in this plan: slug -> depth
  const created = new Map<string, number>();
  const absorbedSoFar = new Set<string>();
  const survivorsSoFar = new Set<string>();

  // 1. merges
  for (const m of plan.merges) {
    const unknown = [m.survivor, ...m.absorbed].filter((s) => !known(s));
    if (unknown.length) {
      reject('merges', m, `unknown slug: ${unknown.join(', ')}`);
      continue;
    }
    const gk = [m.survivor, ...m.absorbed].filter((s) => isGeneralKnowledgeOrUnder(tree, s));
    if (gk.length) {
      reject('merges', m, `${GENERAL_KNOWLEDGE_SLUG} is out of scope (never merged): ${gk.join(', ')}`);
      continue;
    }
    const roots = [m.survivor, ...m.absorbed].filter((s) => isRoot(tree, s));
    if (roots.length) {
      reject('merges', m, `root category cannot be merged: ${roots.join(', ')}`);
      continue;
    }
    const prot = [m.survivor, ...m.absorbed].filter((s) => isProtectedOrUnder(tree, s));
    if (prot.length) {
      reject('merges', m, `protected category: ${prot.join(', ')}`);
      continue;
    }
    // The survivor may have protected descendants; an absorbed node must have none in its subtree.
    const protBelow = m.absorbed.filter((s) => s !== m.survivor && subtreeHasProtected(tree, s));
    if (protBelow.length) {
      reject('merges', m, `absorbed subtree contains a protected category: ${protBelow.join(', ')}`);
      continue;
    }
    const absorbed = [...new Set(m.absorbed.filter((s) => s !== m.survivor))];
    if (absorbed.length === 0) {
      reject('merges', m, 'nothing to absorb');
      continue;
    }
    const reused = absorbed.filter((s) => absorbedSoFar.has(s));
    if (reused.length || absorbedSoFar.has(m.survivor)) {
      reject('merges', m, `already absorbed earlier in this plan: ${[...reused, m.survivor].filter((s) => absorbedSoFar.has(s)).join(', ')}`);
      continue;
    }
    // Checked against the model's own survivor first, so an override cannot launder an ancestor merge.
    const ancOrig = absorbed.filter((s) => isAncestorOf(tree, s, m.survivor));
    if (ancOrig.length) {
      reject('merges', m, `cannot absorb an ancestor of the survivor: ${ancOrig.join(', ')}`);
      continue;
    }
    const usedAsSurvivor = absorbed.filter((s) => survivorsSoFar.has(s));
    if (usedAsSurvivor.length) {
      reject('merges', m, `already a survivor of an earlier merge in this plan: ${usedAsSurvivor.join(', ')}`);
      continue;
    }
    const survivor = chooseSurvivor(tree, [m.survivor, ...absorbed]);
    const finalAbsorbed = survivor === m.survivor ? absorbed : [m.survivor, ...absorbed].filter((s) => s !== survivor);
    // Re-check every FINAL absorbed node: an override can turn the model's survivor into an absorbed node.
    const protFinal = finalAbsorbed.filter((s) => isProtectedOrUnder(tree, s) || subtreeHasProtected(tree, s));
    if (protFinal.length) {
      reject('merges', m, `absorbed subtree contains a protected category: ${protFinal.join(', ')}`);
      continue;
    }
    const survivorsHit = finalAbsorbed.filter((s) => survivorsSoFar.has(s));
    if (survivorsHit.length) {
      reject('merges', m, `already a survivor of an earlier merge in this plan: ${survivorsHit.join(', ')}`);
      continue;
    }
    // NOTE: Task 4's apply engine must re-check merge depth/subtree consequences (e.g. children of absorbed nodes).
    const anc = finalAbsorbed.filter((s) => isAncestorOf(tree, s, survivor));
    if (anc.length) {
      reject('merges', m, `cannot absorb an ancestor of the survivor: ${anc.join(', ')}`);
      continue;
    }
    if (!take('merges', m)) continue;
    if (survivor !== m.survivor) {
      reject('merges', m, `survivor overridden: ${m.survivor} -> ${survivor}`);
    }
    for (const s of finalAbsorbed) absorbedSoFar.add(s);
    survivorsSoFar.add(survivor);
    out.merges.push({ survivor, absorbed: finalAbsorbed, why: m.why });
  }

  // 2. hides
  for (const h of plan.hides) {
    if (!known(h.slug)) {
      reject('hides', h, `unknown slug: ${h.slug}`);
      continue;
    }
    if (isGeneralKnowledgeOrUnder(tree, h.slug)) {
      reject('hides', h, `${GENERAL_KNOWLEDGE_SLUG} is out of scope (never hidden): ${h.slug}`);
      continue;
    }
    if (isRoot(tree, h.slug)) {
      reject('hides', h, `root category cannot be hidden: ${h.slug}`);
      continue;
    }
    if (isProtectedOrUnder(tree, h.slug) || subtreeHasProtected(tree, h.slug)) {
      reject('hides', h, `protected category in subtree: ${h.slug}`);
      continue;
    }
    if (take('hides', h)) out.hides.push(h);
  }

  // 3. creates
  for (const c of plan.creates) {
    if (isJunkSlug(c.slug)) {
      reject('creates', c, `junk slug: ${c.slug}`);
      continue;
    }
    if (known(c.slug) || tree.aliases.has(c.slug) || created.has(c.slug)) {
      reject('creates', c, `slug already exists or is an alias: ${c.slug}`);
      continue;
    }
    const flagged = flaggedMatch(tree, c.name, c.slug);
    if (flagged) {
      reject('creates', c, `recreates a flagged category: ${flagged}`);
      continue;
    }
    if (isGeneralKnowledgeOrUnder(tree, c.parent)) {
      reject('creates', c, `${GENERAL_KNOWLEDGE_SLUG} is out of scope (no children created under it): ${c.parent}`);
      continue;
    }
    const parentDepth = tree.bySlug.get(c.parent)?.depth ?? created.get(c.parent);
    if (parentDepth === undefined) {
      reject('creates', c, `unknown parent slug: ${c.parent}`);
      continue;
    }
    if (parentDepth >= MAX_DEPTH) {
      reject('creates', c, `parent ${c.parent} is already at max depth ${MAX_DEPTH}`);
      continue;
    }
    if (!take('creates', c)) continue;
    created.set(c.slug, parentDepth + 1);
    out.creates.push(c);
  }

  // 4. rehomes
  for (const r of plan.rehomes) {
    if (!ids.has(r.questionId)) {
      reject('rehomes', r, `unknown question id: ${r.questionId}`);
      continue;
    }
    if (!known(r.from)) {
      reject('rehomes', r, `unknown slug: ${r.from}`);
      continue;
    }
    // NOTE: Task 4's apply engine must enforce that `to` is not hidden/absorbed and that the question is actually linked to `from`.
    if (!known(r.to) && !created.has(r.to)) {
      reject('rehomes', r, `unknown target slug: ${r.to}`);
      continue;
    }
    const gkEnd = [r.from, r.to].filter((s) => isGeneralKnowledgeOrUnder(tree, s));
    if (gkEnd.length) {
      reject('rehomes', r, `${GENERAL_KNOWLEDGE_SLUG} is out of scope (never a re-home end): ${gkEnd.join(', ')}`);
      continue;
    }
    if (r.from === r.to) {
      reject('rehomes', r, 'from and to are the same');
      continue;
    }
    if (isProtectedOrUnder(tree, r.from)) {
      reject('rehomes', r, `protected category: ${r.from}`);
      continue;
    }
    if (take('rehomes', r)) out.rehomes.push(r);
  }

  // 5. duplicates
  for (const d of plan.duplicates) {
    const bad = [d.keep, d.flag].filter((q) => !ids.has(q));
    if (bad.length) {
      reject('duplicates', d, `unknown question id: ${bad.join(', ')}`);
      continue;
    }
    if (d.keep === d.flag) {
      reject('duplicates', d, 'keep and flag are the same question');
      continue;
    }
    if (take('duplicates', d)) out.duplicates.push(d);
  }

  return { plan: out, rejected };
}
