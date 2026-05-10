-- 260510-slg: Slug-tree extension — 4 leaves surfaced as gaps during 999.23 mistag review.
-- Single-parent tree, depth=1 under existing roots/sub-roots.
-- Scope-reduced from 6 originally-proposed leaves; alternative-medicine + fashion-and-clothing
-- deferred to 260510-fas-altmed (their 1+2 candidate Qs parked via 00036).

BEGIN;

INSERT INTO categories (slug, name, parent_id)
SELECT v.slug, v.name, p.id
FROM (VALUES
  ('board-games',      'Board Games',      'gaming'),
  ('electronic-music', 'Electronic Music', 'music'),
  ('2010s-music',      '2010s Music',      'music'),
  ('pizza',            'Pizza',            'food-and-drink')
) AS v(slug, name, parent_slug)
JOIN categories p ON p.slug = v.parent_slug
ON CONFLICT (slug) DO NOTHING;

COMMIT;
