export const GENERAL_KNOWLEDGE_SLUG = 'general-knowledge';
export const GENERAL_KNOWLEDGE_JSON_KEY = 'general_knowledge';

/** Returns true when `general_knowledge` (JSON key) is present in scores object. */
export function validateHasGeneralKnowledge(scores: Record<string, number>): boolean {
  return GENERAL_KNOWLEDGE_JSON_KEY in scores;
}

/** Throws if general_knowledge missing. Use before any DB write. */
export function assertGeneralKnowledge(scores: Record<string, number>): void {
  if (!validateHasGeneralKnowledge(scores)) {
    throw new Error(
      `Question output missing required 'general_knowledge' score. Got keys: ${Object.keys(scores).join(', ')}`,
    );
  }
}

/** Throws if agent proposes 'general-knowledge' or 'general_knowledge' as a non-GK extra (D-13). */
export function assertNoGeneralKnowledgeInExtras(slugs: string[]): void {
  for (const s of slugs) {
    if (s === GENERAL_KNOWLEDGE_SLUG || s === GENERAL_KNOWLEDGE_JSON_KEY) {
      throw new Error(
        `'general-knowledge' is a protected category and must not appear in category_slugs extras`,
      );
    }
  }
}
