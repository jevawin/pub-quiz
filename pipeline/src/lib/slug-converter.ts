export function jsonKeyToSlug(key: string): string {
  return key.replace(/_/g, '-');
}

export function slugToJsonKey(slug: string): string {
  return slug.replace(/-/g, '_');
}
